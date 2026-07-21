// hooks/useOrderBook.ts — Carnet d'ordres BVC temps réel pour un ticker
// Interroge GET /api/market/orderbook/{ticker} toutes les 30 s quand actif.

import { useState, useEffect, useRef } from 'react';
import { apiClient } from '../src/api/client';

export interface LastTransaction {
  time:  string;
  price: number | null;
  qty:   number | null;
}

export interface OrderBook {
  ticker:               string;
  bestBidPrice:         number | null;
  bestBidSize:          number | null;
  bestAskPrice:         number | null;
  bestAskSize:          number | null;
  lastTradedPrice:      number | null;
  lastTradedTime:       string | null;
  etatCotVal:           string | null;
  totalTrades:          number | null;
  varVeille:            number | null;
  openingPrice:         number | null;
  highPrice:            number | null;
  lowPrice:             number | null;
  staticReferencePrice: number | null;
  pto:                  number | null;
  cumulTitresEchanges:  number | null;
  cumulVolumeEchange:   number | null;
  instrumentVarYear:    string | null;
  capitalisation:       number | null;
  lastTransactions:     LastTransaction[];
}

const POLL_MS = 30_000;

export function useOrderBook(ticker: string | null) {
  const [data,    setData]    = useState<OrderBook | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ticker) { setData(null); return; }

    let cancelled = false;

    async function fetch() {
      if (cancelled) return;
      setLoading(true);
      try {
        const res = await apiClient.get<OrderBook>(`/api/market/orderbook/${ticker}`);
        if (!cancelled) { setData(res.data); setError(null); }
      } catch (e: any) {
        if (!cancelled) setError(e?.response?.data?.detail ?? 'Erreur réseau');
      } finally {
        if (!cancelled) setLoading(false);
        timerRef.current = setTimeout(fetch, POLL_MS);
      }
    }

    void fetch();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [ticker]);

  return { data, loading, error };
}
