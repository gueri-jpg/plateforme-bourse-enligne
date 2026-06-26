// ============================================================================
// useMarketData.ts — Hook WebSocket pour les cotations BVC en temps réel
// Se reconnecte automatiquement si la connexion est perdue
// ============================================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { CONFIG } from '../constants/config';

export interface Stock {
  name: string; sector: string;
  price: number; pct: number;
  open: number; high: number; low: number;
  bid: number; ask: number;
  volMAD: number; volQty: number;
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
            sector: sec.title ?? '—',
            name:   it?.instrument?.label ?? '—',
            price:  asNum(it?.field_cours_courant),
            pct:    asNum(it?.field_var_veille),
            open:   asNum(it?.field_opening_price),
            high:   asNum(it?.field_high_price),
            low:    asNum(it?.field_low_price),
            bid:    asNum(it?.field_best_bid_price),
            ask:    asNum(it?.field_best_ask_price),
            volMAD: asNum(it?.field_cumul_volume_echange),
            volQty: asNum(it?.field_cumul_titres_echanges),
          });
        }
      }
    }
  } catch {}
  return out;
}

export function useMarketData() {
  const [stocks, setStocks]     = useState<Stock[]>([]);
  const [overview, setOverview] = useState<Overview>({ masi: null, masiOpen: null, masiVarJ: null, masiHigh: null, masiLow: null, vol: null, capi: null, ts: null });
  const [status, setStatus]     = useState<WsStatus>('connecting');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const wsRef       = useRef<WebSocket | null>(null);
  const reconnDelay = useRef(2000);

  const connect = useCallback(() => {
    setStatus('connecting');
    const ws = new WebSocket(CONFIG.WS_MARKET_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      reconnDelay.current = 2000;
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.evenement === 'bvc_snapshot' && data.donnees) {
          setOverview(parseOverview(data.donnees.overview));
          setStocks(parseStocks(data.donnees.stocks));
          setLastUpdate(new Date());
        }
      } catch {}
    };

    ws.onclose = () => {
      setStatus('disconnected');
      setTimeout(connect, reconnDelay.current);
      reconnDelay.current = Math.min(reconnDelay.current * 2, 30000);
    };

    ws.onerror = () => {};
  }, []);

  useEffect(() => {
    connect();
    return () => { wsRef.current?.close(); };
  }, [connect]);

  return { stocks, overview, status, lastUpdate };
}