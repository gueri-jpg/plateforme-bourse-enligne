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

// ── Parsers (inchangés) ──────────────────────────────────────────────────────
function asNum(x: unknown): number {
  if (x === null || x === undefined) return NaN;
  const n = typeof x === 'number' ? x : parseFloat(String(x).replace(/[\s%]/g, '').replace(',', '.'));
  return isNaN(n) ? NaN : n;
}

function parseOverview(doc: Record<string, unknown>): Overview {
  const out: Overview = { masi: null, masiOpen: null, masiVarJ: null, masiHigh: null, masiLow: null, vol: null, capi: null, ts: null };
  try {
    const node = (doc as any)?.pageProps?.node;
    for (const p of node?.field_vactory_paragraphs ?? []) {
      const c = p?.field_vactory_component;
      if (!c?.widget_id?.includes('marches-overview')) continue;
      const wd = typeof c.widget_data === 'string' ? JSON.parse(c.widget_data) : c.widget_data;
      for (const comp of (Array.isArray(wd?.components) ? wd.components : [wd?.components].filter(Boolean))) {
        if (comp?.capitalisation?.value) out.capi = asNum(comp.capitalisation.value);
        if (comp?.volume?.volume)        out.vol  = asNum(comp.volume.volume);
        const coll = comp?.collection?.data?.data;
        if (Array.isArray(coll) && coll.length) {
          const series = coll
            .map((it: any) => ({ v: asNum(it?.attributes?.indexValue), t: it?.attributes?.transactTime }))
            .filter(p => !isNaN(p.v) && p.t)
            .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
          if (series.length) {
            const last = series[series.length - 1], first = series[0];
            out.masi     = last.v;
            out.masiOpen = first.v;
            out.masiHigh = Math.max(...series.map(p => p.v));
            out.masiLow  = Math.min(...series.map(p => p.v));
            out.masiVarJ = first.v ? (last.v - first.v) / first.v * 100 : null;
            out.ts       = last.t;
          }
        }
      }
    }
  } catch {}
  return out;
}

function parseStocks(doc: Record<string, unknown>): Stock[] {
  const out: Stock[] = [];
  try {
    const node = (doc as any)?.pageProps?.node;
    for (const p of node?.field_vactory_paragraphs ?? []) {
      const c = p?.field_vactory_component;
      if (!c?.widget_id?.includes('marches-actions')) continue;
      const wd = typeof c.widget_data === 'string' ? JSON.parse(c.widget_data) : c.widget_data;
      for (const sec of (wd?.extra_field?.data ?? [])) {
        for (const it of (sec.items ?? [])) {
          out.push({
            sector:      sec.title ?? '—',
            name:        it?.instrument?.label ?? '—',
            ticker:      (it?.instrument?.url ?? '').split('/').pop() ?? '',
            price:       asNum(it?.field_cours_courant),
            pct:         asNum(it?.field_var_veille),
            open:        asNum(it?.field_opening_price),
            high:        asNum(it?.field_high_price),
            low:         asNum(it?.field_low_price),
            bid:         asNum(it?.field_best_bid_price),
            ask:         asNum(it?.field_best_ask_price),
            volMAD:      asNum(it?.field_cumul_volume_echange),
            volQty:      asNum(it?.field_cumul_titres_echanges),
            refPrice:    asNum(it?.field_static_reference_price),
            bidSize:     asNum(it?.field_best_bid_size),
            askSize:     asNum(it?.field_best_ask_size),
            totalTrades: typeof it?.field_total_trades === 'number' ? it.field_total_trades : asNum(it?.field_total_trades),
            stockCapi:   asNum(it?.field_capitalisation),
            etat:        typeof it?.field_etat_cot_val === 'string' ? it.field_etat_cot_val : '',
          });
        }
      }
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
      if (data.evenement === 'bvc_snapshot' && data.donnees) {
        useMarketStore.setState({
          overview:   parseOverview(data.donnees.overview),
          stocks:     parseStocks(data.donnees.stocks),
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
