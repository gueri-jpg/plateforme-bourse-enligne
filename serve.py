"""
Relais local BVC — proxy CORS pour la Bourse de Casablanca.

Usage :
    python serve.py

Puis laissez Docker/Nginx tourner normalement sur le port 80.
Ce relais s'exécute sur http://localhost:8765 et est appelé par
Nginx via proxy_pass (location /api/ dans frontend/nginx.conf).

Endpoints exposés :
    GET /api/overview  -> pageProps overview (MASI, volume, capitalisation)
    GET /api/stocks    -> pageProps marche-actions (cotations par secteur)
    GET /api/buildId   -> {"buildId": "..."}
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error   import HTTPError
from pathlib        import Path
import json, re, ssl, time, threading

PORT = 8765
HOST = "https://www.casablanca-bourse.com"
UA   = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 Chrome/124 Safari/537.36")

SSL_CONTEXT = ssl._create_unverified_context()

_state = {"buildId": None, "buildIdAt": 0}
_lock  = threading.Lock()


def http_get(url: str, timeout: int = 15) -> str:
    req = Request(url, headers={
        "User-Agent":      UA,
        "Accept":          "*/*",
        "Accept-Language": "fr-FR,fr;q=0.9",
    })
    with urlopen(req, timeout=timeout, context=SSL_CONTEXT) as r:
        return r.read().decode("utf-8", errors="replace")


def discover_build_id(force: bool = False) -> str:
    with _lock:
        now = time.time()
        if not force and _state["buildId"] and (now - _state["buildIdAt"] < 600):
            return _state["buildId"]
        html = http_get(HOST + "/fr/live-market/overview")
        m = re.search(r'"buildId":"([^"]+)"', html)
        if not m:
            raise RuntimeError("buildId introuvable dans la page BVC")
        _state["buildId"]   = m.group(1)
        _state["buildIdAt"] = now
        return _state["buildId"]


def fetch_page_json(path: str) -> str:
    bid = discover_build_id()
    url = f"{HOST}/_next/data/{bid}/{path}.json"
    try:
        return http_get(url)
    except HTTPError as e:
        if e.code == 404:
            bid = discover_build_id(force=True)
            return http_get(f"{HOST}/_next/data/{bid}/{path}.json")
        raise


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

        if path == "/api/buildId":
            try:
                return self._send(200, json.dumps({"buildId": discover_build_id()}))
            except Exception as e:
                return self._send(502, json.dumps({"error": str(e)}))

        if path == "/api/overview":
            try:
                return self._send(200, fetch_page_json("fr/live-market/overview"))
            except Exception as e:
                return self._send(502, json.dumps({"error": str(e)}))

        if path == "/api/stocks":
            try:
                return self._send(200, fetch_page_json("fr/live-market/marche-actions-groupement"))
            except Exception as e:
                return self._send(502, json.dumps({"error": str(e)}))

        return self._send(404, json.dumps({"error": "not found"}))


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"BVC relay -> http://localhost:{PORT}/  (Ctrl+C pour arrêter)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()


if __name__ == "__main__":
    main()
