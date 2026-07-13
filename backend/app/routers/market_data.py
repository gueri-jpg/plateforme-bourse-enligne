"""
WebSocket endpoint — flux temps réel des marchés mondiaux (Twelve Data).

Interroge l'API Twelve Data à intervalle régulier et diffuse les résultats
à tous les clients WebSocket connectés, exactement comme ws_market.py le
fait pour les cotations BVC via Kafka.

Endpoint : ws://<host>/ws/market-global

Variables d'environnement :
    TWELVE_DATA_API_KEY      (requis)
    TWELVE_DATA_REFRESH_SEC  (défaut : 60 secondes)
"""

import asyncio
import json

import httpx
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import settings

router = APIRouter()

_clients: set[WebSocket] = set()
_latest: str | None = None

SYMBOLS = [
    ("QQQ",     "NASDAQ 100",    "Indice"),
    ("SPY",     "S&P 500",       "Indice"),
    ("EWQ",     "CAC 40",        "Indice"),
    ("USO",     "Pétrole",       "Matière 1ère"),
    ("XAU/USD", "Or / Dollar",   "Matière 1ère"),
    ("BTC/USD", "Bitcoin",       "Crypto"),
    ("ETH/USD", "Ethereum",      "Crypto"),
    ("EUR/USD", "Euro / Dollar", "Forex"),
]

_SYMBOL_LIST = ",".join(s[0] for s in SYMBOLS)
_SYMBOL_META = {s[0]: {"label": s[1], "type": s[2]} for s in SYMBOLS}


async def _broadcast(payload: str) -> None:
    global _latest
    _latest = payload
    dead: set[WebSocket] = set()
    for ws in _clients.copy():
        try:
            await ws.send_text(payload)
        except Exception:
            dead.add(ws)
    _clients.difference_update(dead)


async def poll_twelve_data() -> None:
    url = (
        "https://api.twelvedata.com/quote"
        f"?symbol={_SYMBOL_LIST}"
        f"&apikey={settings.TWELVE_DATA_API_KEY}"
    )
    print(f"[market_data] Démarrage du poll (intervalle={settings.TWELVE_DATA_REFRESH_SEC}s, {len(SYMBOLS)} symboles)")
    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            try:
                resp = await client.get(url)
                raw = resp.json()

                # 429 : quota journalier épuisé — on attend et on réessaie
                if resp.status_code == 429 or raw.get("code") == 429:
                    print(f"[market_data] Quota Twelve Data épuisé : {raw.get('message', '')} — prochain essai dans {settings.TWELVE_DATA_REFRESH_SEC}s")
                    await asyncio.sleep(settings.TWELVE_DATA_REFRESH_SEC)
                    continue

                # Erreur générique retournée dans le corps JSON
                if "code" in raw and raw.get("code") != 200:
                    print(f"[market_data] Erreur API ({raw.get('code')}) : {raw.get('message', '')}")
                    await asyncio.sleep(settings.TWELVE_DATA_REFRESH_SEC)
                    continue

                # Quand un seul symbole est demandé, l'API renvoie l'objet directement.
                # Avec plusieurs symboles elle renvoie un dict keyed par symbole.
                if "symbol" in raw:
                    raw = {raw["symbol"]: raw}

                items = []
                for sym, meta in _SYMBOL_META.items():
                    q = raw.get(sym, {})
                    if q.get("status") == "error" or not q.get("close"):
                        continue
                    pct = q.get("percent_change", 0)
                    items.append({
                        "symbol": sym,
                        "label":  meta["label"],
                        "type":   meta["type"],
                        "price":  float(q["close"]),
                        "change": float(q.get("change") or 0),
                        "pct":    float(pct or 0),
                        "open":   float(q.get("open") or 0),
                        "high":   float(q.get("high") or 0),
                        "low":    float(q.get("low") or 0),
                        "ts":     q.get("datetime", ""),
                    })

                if items:
                    payload = json.dumps({"type": "market_global", "data": items})
                    await _broadcast(payload)
                    print(f"[market_data] {len(items)} instruments diffusés ({len(_clients)} client(s))")
                else:
                    print(f"[market_data] Aucune donnée valide reçue de Twelve Data")

            except Exception as exc:
                print(f"[market_data] Erreur Twelve Data : {exc}")

            await asyncio.sleep(settings.TWELVE_DATA_REFRESH_SEC)


def start_polling() -> None:
    asyncio.create_task(poll_twelve_data())


@router.websocket("/ws/market-global")
async def ws_market_global(websocket: WebSocket) -> None:
    await websocket.accept()
    _clients.add(websocket)
    print(f"[market_data] Client connecté ({len(_clients)} connecté(s))")

    if _latest:
        await websocket.send_text(_latest)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        _clients.discard(websocket)
        print(f"[market_data] Client déconnecté ({len(_clients)} restant(s))")
