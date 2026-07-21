"""
GET /api/market/orderbook/{ticker}

Retourne le carnet d'ordres BVC temps réel (top of book) pour un ticker.

Flux :
  1. Récupère le buildId Next.js BVC (cache 10 min)
  2. Scrape la page instrument pour extraire l'UUID market_watch (cache 30 s / ticker)
  3. Appelle api.casablanca-bourse.com/fr/api/bourse_data/market_watch/{uuid}
  4. Retourne bid/ask + 10 dernières transactions

Sans authentification BVC requise.
"""

import asyncio
import re
import time
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/market", tags=["Market BVC"])

BVC_HOST = "https://www.casablanca-bourse.com"
BVC_API  = "https://api.casablanca-bourse.com"
HEADERS  = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124",
    "Accept-Language": "fr-FR,fr;q=0.9",
}

# ── Cache ────────────────────────────────────────────────────────────────────
_build_id_cache:  dict[str, Any] = {"value": None, "at": 0.0}
_uuid_cache:      dict[str, dict[str, Any]] = {}  # ticker → {uuid, at}
_BUILD_ID_TTL = 600   # 10 min
_UUID_TTL     = 30    # 30 s


async def _get_build_id(client: httpx.AsyncClient) -> str:
    now = time.time()
    if _build_id_cache["value"] and (now - _build_id_cache["at"]) < _BUILD_ID_TTL:
        return _build_id_cache["value"]
    r = await client.get(f"{BVC_HOST}/fr/live-market/overview", timeout=15)
    r.raise_for_status()
    m = re.search(r'"buildId":"([^"]+)"', r.text)
    if not m:
        raise RuntimeError("buildId BVC introuvable")
    _build_id_cache["value"] = m.group(1)
    _build_id_cache["at"]    = now
    return _build_id_cache["value"]


async def _get_market_watch_uuid(client: httpx.AsyncClient, ticker: str) -> str:
    now    = time.time()
    cached = _uuid_cache.get(ticker)
    if cached and (now - cached["at"]) < _UUID_TTL:
        return cached["uuid"]

    build_id = await _get_build_id(client)
    url = f"{BVC_HOST}/_next/data/{build_id}/fr/live-market/instruments/{ticker}.json"
    r = await client.get(url, timeout=12)

    # buildId périmé → forcer refresh et réessayer une fois
    if r.status_code == 404:
        _build_id_cache["value"] = None
        build_id = await _get_build_id(client)
        url = f"{BVC_HOST}/_next/data/{build_id}/fr/live-market/instruments/{ticker}.json"
        r = await client.get(url, timeout=12)

    r.raise_for_status()
    data = r.json()

    paras = (
        data.get("pageProps", {})
            .get("node", {})
            .get("field_vactory_paragraphs", [])
    )
    for p in paras:
        c  = p.get("field_vactory_component", {})
        wd = c.get("widget_data", "{}")
        if "instrument-data" not in c.get("widget_id", ""):
            continue
        import json as _json
        w = _json.loads(wd) if isinstance(wd, str) else wd
        for comp in w.get("components", []):
            cd = comp.get("collection", {}).get("data", {})
            items = cd.get("data", [])
            if items and items[0].get("type") == "market_watch":
                uuid = items[0]["id"]
                _uuid_cache[ticker] = {"uuid": uuid, "at": now}
                return uuid

    raise RuntimeError(f"UUID market_watch introuvable pour {ticker}")


@router.get("/orderbook/{ticker}")
async def get_orderbook(ticker: str) -> dict:
    """Carnet d'ordres BVC temps réel pour un ticker (ex: ATW, IAM, BCP)."""
    ticker = ticker.upper().strip()

    async with httpx.AsyncClient(
        headers=HEADERS, verify=False, timeout=15,
        follow_redirects=True,
    ) as client:
        try:
            uuid = await _get_market_watch_uuid(client, ticker)
        except Exception as exc:
            raise HTTPException(status_code=404, detail=f"Ticker {ticker} introuvable : {exc}")

        r = await client.get(f"{BVC_API}/fr/api/bourse_data/market_watch/{uuid}")
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail="Erreur API BVC market_watch")

        data = r.json()
        a    = data.get("data", {}).get("attributes", {})

        def _f(v: Any) -> float | None:
            return float(v) if v is not None else None

        last_tx = [
            {
                "time":  tx.get("transactTime", ""),
                "price": _f(tx.get("executedPrice")),
                "qty":   _f(tx.get("executedSize")),
            }
            for tx in a.get("lastTransactions", [])
        ]

        return {
            "ticker":               ticker,
            "bestBidPrice":         _f(a.get("bestBidPrice")),
            "bestBidSize":          _f(a.get("bestBidSize")),
            "bestAskPrice":         _f(a.get("bestAskPrice")),
            "bestAskSize":          _f(a.get("bestAskSize")),
            "lastTradedPrice":      _f(a.get("lastTradedPrice")),
            "lastTradedTime":       a.get("lastTradedTime"),
            "etatCotVal":           a.get("etatCotVal"),
            "totalTrades":          a.get("totalTrades"),
            "varVeille":            _f(a.get("varVeille")),
            "openingPrice":         _f(a.get("openingPrice")),
            "highPrice":            _f(a.get("highPrice")),
            "lowPrice":             _f(a.get("lowPrice")),
            "staticReferencePrice": _f(a.get("staticReferencePrice")),
            "pto":                  _f(a.get("pto")),
            "cumulTitresEchanges":  _f(a.get("cumulTitresEchanges")),
            "cumulVolumeEchange":   _f(a.get("cumulVolumeEchange")),
            "instrumentVarYear":    a.get("instrumentVarYear"),
            "capitalisation":       _f(a.get("capitalisation")),
            "lastTransactions":     last_tx,
        }
