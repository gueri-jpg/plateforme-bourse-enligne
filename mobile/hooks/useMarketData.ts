// ============================================================================
// useMarketData.ts — Cotations BVC en temps réel
//
// Avant : hook local avec useState → WebSocket fermé à chaque unmount
// Maintenant : store Zustand singleton + WS module-level permanent
// Les données restent disponibles sur tous les onglets sans rechargement.
// ============================================================================

import { create } from 'zustand';
import { CONFIG } from '../constants/config';

// ── Types (inchangés — rétrocompatibilité totale) ────────────────────────────
export interface Stock {
  name: string; ticker: string; sector: string;
  price: number; pct: number;
  open: number; high: number; low: number;
  bid: number; ask: number;
  volMAD: number; volQty: number;
  refPrice: number;    // cours de référence (clôture veille)
  bidSize: number;     // quantité disponible au bid
  askSize: number;     // quantité disponible au ask
  totalTrades: number; // nombre de transactions séance
  stockCapi: number;   // capitalisation boursière de l'action
  etat: string;        // état : T=Trading R=Réservé S=Suspendu
}

export interface Overview {
  masi: number | null;
  masiOpen: number | null;
  masiVarJ: number | null;
  masiHigh: number | null;
  masiLow: number | null;
  vol: number | null;
  capi: number | null;
  ts: string | null;
}

export type WsStatus = 'connecting' | 'connected' | 'disconnected';

// ── Parsers — format bvc_snapshot v2 (drupalSettings HTML) ──────────────────
function asNum(x: unknown): number {
  if (x === null || x === undefined) return NaN;
  const n = typeof x === 'number' ? x : parseFloat(String(x).replace(/[\s%]/g, '').replace(',', '.'));
  return isNaN(n) ? NaN : n;
}

function parseOverview(doc: Record<string, unknown>): Overview {
  const out: Overview = {
    masi: null, masiOpen: null, masiVarJ: null,
    masiHigh: null, masiLow: null, vol: null, capi: null, ts: null,
  };
  try {
    const masi = (doc as any)?.masi;
    if (masi?.value != null) out.masi     = asNum(masi.value);
    if (masi?.change_pct != null) out.masiVarJ = asNum(masi.change_pct);
    if ((doc as any)?.vol_total  != null) out.vol  = asNum((doc as any).vol_total);
    if ((doc as any)?.capi_total != null) out.capi = asNum((doc as any).capi_total);
    if ((doc as any)?.horodatage) out.ts = (doc as any).horodatage;
  } catch {}
  return out;
}

function parseStocks(doc: Record<string, unknown>): Stock[] {
  const out: Stock[] = [];
  try {
    const actions: any[] = (doc as any)?.actions ?? [];
    for (const a of actions) {
      out.push({
        sector:      a.sector      ?? '—',
        name:        a.name        ?? '—',
        ticker:      a.symbol      ?? '',
        price:       asNum(a.price),
        pct:         asNum(a.variation),
        open:        asNum(a.open),
        high:        asNum(a.high),
        low:         asNum(a.low),
        bid:         asNum(a.bid_price),
        ask:         asNum(a.ask_price),
        volMAD:      asNum(a.volume),
        volQty:      asNum(a.quantity),
        refPrice:    asNum(a.reference),
        bidSize:     asNum(a.bid_qty),
        askSize:     asNum(a.ask_qty),
        totalTrades: typeof a.trades === 'number' ? a.trades : asNum(a.trades),
        stockCapi:   asNum(a.capi),
        etat:        typeof a.status === 'string' ? a.status : '',
      });
    }
  } catch {}
  return out;
}

// ── Store Zustand singleton ──────────────────────────────────────────────────
const EMPTY_OVERVIEW: Overview = {
  masi: null, masiOpen: null, masiVarJ: null,
  masiHigh: null, masiLow: null, vol: null, capi: null, ts: null,
};

const useMarketStore = create<{
  stocks:     Stock[];
  overview:   Overview;
  status:     WsStatus;
  lastUpdate: Date | null;
}>(() => ({
  stocks: [], overview: EMPTY_OVERVIEW, status: 'connecting', lastUpdate: null,
}));

// ── WebSocket module-level (ne se ferme jamais) ──────────────────────────────
let wsInited    = false;
let reconnDelay = 2000;

function connectWs() {
  useMarketStore.setState({ status: 'connecting' });
  const ws = new WebSocket(CONFIG.WS_MARKET_URL);

  ws.onopen = () => {
    useMarketStore.setState({ status: 'connected' });
    reconnDelay = 2000;
  };

  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.evenement === 'bvc_snapshot') {
        useMarketStore.setState({
          overview:   parseOverview(data),
          stocks:     parseStocks(data),
          lastUpdate: new Date(),
        });
      }
    } catch {}
  };

  ws.onclose = () => {
    useMarketStore.setState({ status: 'disconnected' });
    setTimeout(connectWs, reconnDelay);
    reconnDelay = Math.min(reconnDelay * 2, 30000);
  };

  ws.onerror = () => {};
}

// Appelé une seule fois depuis MainTabs au montage de l'app authentifiée
export function startMarketWs() {
  if (wsInited) return;
  wsInited = true;
  connectWs();
}

// ── Hook (API identique — aucun changement dans les écrans) ──────────────────
export function useMarketData() {
  return useMarketStore();
}
