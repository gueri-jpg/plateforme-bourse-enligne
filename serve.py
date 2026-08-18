"""
Relais local BVC — proxy CORS pour la Bourse de Casablanca.

Usage :
    python serve.py

Ce relais s'exécute sur http://localhost:8765 et est appelé par
Nginx via proxy_pass (location /api/ dans frontend/nginx.conf).

Méthode : extraction du drupalSettings dans le HTML des pages
  /live-market/actions  (titres + session)
  /live-market/indices  (MASI et autres indices)
Ces URLs sont accessibles sans protection WAF (contrairement aux URLs /fr/*).

Endpoints exposés :
    GET /api/overview  → {masi, session, vol_total, capi_total}
    GET /api/stocks    → {actions: [...]}
    GET /api/snapshot  → snapshot complet (format identique au message Kafka)
"""

import json
import re
import ssl
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen

PORT     = 8765
BVC_HOST = "https://www.casablanca-bourse.com"
UA       = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 Chrome/124 Safari/537.36"
)

SSL_CTX = ssl._create_unverified_context()

_cache: dict = {"data": None, "at": 0.0}
_cache_lock = threading.Lock()
CACHE_TTL = 25  # secondes — légèrement sous l'intervalle du producer (30s)


def _http_get(path: str, timeout: int = 20) -> str:
    req = Request(
        BVC_HOST + path,
        headers={
            "User-Agent":      UA,
            "Accept":          "text/html,*/*",
            "Accept-Language": "fr-MA,fr;q=0.9",
        },
    )
    with urlopen(req, timeout=timeout, context=SSL_CTX) as r:
        return r.read().decode("utf-8", errors="replace")


def _extract_drupal_settings(html: str) -> dict:
    for script in re.findall(
        r"<script(?:\s[^>]*)?>([^<]{500,})</script>", html, re.DOTALL
    ):
        sc = script.strip()
        if sc.startswith("{") and '"live_market"' in sc:
            return json.loads(sc)
    raise RuntimeError("drupalSettings introuvable dans la page BVC")


def _fetch_snapshot() -> dict:
    """Construit le snapshot complet depuis les deux pages BVC."""
    html_actions = _http_get("/live-market/actions")
    html_indices = _http_get("/live-market/indices")

    lm_actions = _extract_drupal_settings(html_actions).get("live_market", {})
    lm_indices = _extract_drupal_settings(html_indices).get("live_market", {})

    actions_raw = lm_actions.get("actions", [])
    actions = []
    for a in actions_raw:
        actions.append({
            "symbol":       (a.get("symbol") or "").strip(),
            "name":         (a.get("emetteur", {}).get("fr") or "").strip(),
            "sector":       (a.get("secteur", {}).get("fr") or "").strip(),
            "compartiment": (a.get("compartiment", {}).get("fr") or "").strip(),
            "status":       (a.get("statut", {}).get("fr") or "").strip(),
            "price":        a.get("dernierCours"),
            "reference":    a.get("reference"),
            "open":         a.get("ouverture"),
            "high":         a.get("plusHaut"),
            "low":          a.get("plusBas"),
            "variation":    a.get("variation"),
            "volume":       a.get("volume"),
            "quantity":     a.get("quantite"),
            "trades":       a.get("nbTransactions"),
            "capi":         a.get("capitalisation"),
            "bid_price":    (a.get("achat") or {}).get("prix"),
            "bid_qty":      (a.get("achat") or {}).get("quantite"),
            "ask_price":    (a.get("vente") or {}).get("prix"),
            "ask_qty":      (a.get("vente") or {}).get("quantite"),
        })

    principaux = lm_indices.get("indices", {}).get("principaux", [])
    masi = {"value": None, "change_pct": None, "change_ytd": None}
    for idx in principaux:
        if idx.get("code") == "MASI":
            masi = {
                "value":      idx.get("value"),
                "change_pct": idx.get("change_pct"),
                "change_ytd": idx.get("change_ytd"),
            }
            break

    session = lm_actions.get("session", {}).get("status", "unknown")
    vol_total  = sum(a["volume"] for a in actions if a["volume"] is not None) or None
    capi_total = sum(a["capi"]   for a in actions if a["capi"]   is not None) or None

    return {
        "evenement":  "bvc_snapshot",
        "horodatage": datetime.now(timezone.utc).isoformat(),
        "session":    session,
        "masi":       masi,
        "vol_total":  vol_total,
        "capi_total": capi_total,
        "actions":    actions,
    }


def _get_cached_snapshot() -> dict:
    with _cache_lock:
        now = time.time()
        if _cache["data"] and (now - _cache["at"]) < CACHE_TTL:
            return _cache["data"]
        data = _fetch_snapshot()
        _cache["data"] = data
        _cache["at"]   = now
        return data


class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def _send(self, code: int, body, ctype: str = "application/json; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type",   ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control",  "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path == "/api/snapshot":
            try:
                snap = _get_cached_snapshot()
                return self._send(200, json.dumps(snap, ensure_ascii=False))
            except Exception as e:
                return self._send(502, json.dumps({"error": str(e)}))

        if path == "/api/overview":
            try:
                snap = _get_cached_snapshot()
                return self._send(200, json.dumps({
                    "masi":       snap["masi"],
                    "session":    snap["session"],
                    "vol_total":  snap["vol_total"],
                    "capi_total": snap["capi_total"],
                    "horodatage": snap["horodatage"],
                }, ensure_ascii=False))
            except Exception as e:
                return self._send(502, json.dumps({"error": str(e)}))

        if path == "/api/stocks":
            try:
                snap = _get_cached_snapshot()
                return self._send(200, json.dumps({
                    "actions":    snap["actions"],
                    "horodatage": snap["horodatage"],
                }, ensure_ascii=False))
            except Exception as e:
                return self._send(502, json.dumps({"error": str(e)}))

        return self._send(404, json.dumps({"error": "not found"}))


def main():
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"BVC relay → http://localhost:{PORT}/  (Ctrl+C pour arrêter)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()


if __name__ == "__main__":
    main()
