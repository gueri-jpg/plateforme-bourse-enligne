"""
Producer BVC → Kafka — topic "market.prices"

Scrape la Bourse de Casablanca toutes les INTERVAL secondes et publie
un snapshot complet sur le topic Kafka "market.prices".

Méthode : extraction du bloc drupalSettings embarqué dans le HTML des pages
  /live-market/actions  → liste des 82 titres (OHLC, volume, bid/ask, secteur)
  /live-market/indices  → indices principaux (MASI, MASI ESG…)
Ces URLs ne sont pas protégées par le WAF F5 (contrairement aux URLs /fr/*).

Format du message :
{
    "evenement": "bvc_snapshot",
    "horodatage": "<ISO 8601>",
    "session":    "open" | "closed",
    "masi": {
        "value":      <float>,
        "change_pct": <float>,   % vs clôture veille
        "change_ytd": <float>    % depuis début d'année
    },
    "vol_total":  <float | null>,   volume total en MAD (somme des titres traités)
    "capi_total": <float | null>,   capitalisation totale en MAD
    "actions": [
        {
            "symbol":      "ATW",
            "name":        "ATTIJARIWAFA BANK",
            "sector":      "Banques",
            "compartiment":"Principal A",
            "status":      "T",
            "price":       704.0,
            "reference":   705.0,   cours de référence (clôture veille)
            "open":        704.5,
            "high":        706.0,
            "low":         703.0,
            "variation":   -0.14,   % par rapport à la référence
            "volume":      123456.0,
            "quantity":    175,
            "trades":      12,
            "capi":        1.23e11,
            "bid_price":   703.9,
            "bid_qty":     50,
            "ask_price":   704.0,
            "ask_qty":     30
        },
        ...
    ]
}

Variables d'environnement :
    KAFKA_BOOTSTRAP_SERVERS  (défaut : localhost:9092)
    BVC_INTERVAL_SECONDS     (défaut : 30)
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timezone

import requests

try:
    from confluent_kafka import Producer
except ImportError as err:
    Producer = None
    _IMPORT_ERROR = err

BVC_HOST = "https://www.casablanca-bourse.com"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 Chrome/124 Safari/537.36"
)
KAFKA_CONFIG = {
    "bootstrap.servers": os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092"),
    "client.id": "bvc-market-data-producer",
}
TOPIC    = "market.prices"
INTERVAL = int(os.getenv("BVC_INTERVAL_SECONDS", "30"))

_session = requests.Session()
_session.headers.update({
    "User-Agent":      UA,
    "Accept":          "text/html,*/*",
    "Accept-Language": "fr-MA,fr;q=0.9",
})
_session.verify = False
requests.packages.urllib3.disable_warnings(
    requests.packages.urllib3.exceptions.InsecureRequestWarning
)


def _fetch_html(path: str, timeout: int = 20) -> str:
    r = _session.get(BVC_HOST + path, timeout=timeout)
    r.raise_for_status()
    return r.text


def _extract_drupal_settings(html: str) -> dict:
    """
    Extrait le JSON drupalSettings embarqué dans la page Drupal BVC.
    Les données live_market y sont injectées côté serveur (SSR).
    """
    for script in re.findall(
        r'<script(?:\s[^>]*)?>([^<]{500,})</script>', html, re.DOTALL
    ):
        sc = script.strip()
        if sc.startswith('{') and '"live_market"' in sc:
            return json.loads(sc)
    raise RuntimeError("drupalSettings introuvable dans la page BVC")


def fetch_actions() -> list[dict]:
    """Retourne la liste des actions depuis /live-market/actions."""
    html = _fetch_html("/live-market/actions")
    settings = _extract_drupal_settings(html)
    actions_raw = settings.get("live_market", {}).get("actions", [])
    result = []
    for a in actions_raw:
        result.append({
            "symbol":      (a.get("symbol") or "").strip(),
            "name":        (a.get("emetteur", {}).get("fr") or "").strip(),
            "sector":      (a.get("secteur", {}).get("fr") or "").strip(),
            "compartiment":(a.get("compartiment", {}).get("fr") or "").strip(),
            "status":      (a.get("statut", {}).get("fr") or "").strip(),
            "price":       a.get("dernierCours"),
            "reference":   a.get("reference"),
            "open":        a.get("ouverture"),
            "high":        a.get("plusHaut"),
            "low":         a.get("plusBas"),
            "variation":   a.get("variation"),
            "volume":      a.get("volume"),
            "quantity":    a.get("quantite"),
            "trades":      a.get("nbTransactions"),
            "capi":        a.get("capitalisation"),
            "bid_price":   (a.get("achat") or {}).get("prix"),
            "bid_qty":     (a.get("achat") or {}).get("quantite"),
            "ask_price":   (a.get("vente") or {}).get("prix"),
            "ask_qty":     (a.get("vente") or {}).get("quantite"),
        })
    return result


def fetch_masi() -> dict:
    """Retourne les données MASI depuis /live-market/indices."""
    html = _fetch_html("/live-market/indices")
    settings = _extract_drupal_settings(html)
    principaux = (
        settings.get("live_market", {})
                .get("indices", {})
                .get("principaux", [])
    )
    for idx in principaux:
        if idx.get("code") == "MASI":
            return {
                "value":      idx.get("value"),
                "change_pct": idx.get("change_pct"),
                "change_ytd": idx.get("change_ytd"),
            }
    return {"value": None, "change_pct": None, "change_ytd": None}


def fetch_session_status() -> str:
    """Retourne 'open' ou 'closed' depuis /live-market/actions."""
    html = _fetch_html("/live-market/actions")
    settings = _extract_drupal_settings(html)
    return settings.get("live_market", {}).get("session", {}).get("status", "unknown")


def on_delivery(err, msg):
    if err:
        print(f"[ERREUR] Kafka delivery : {err}")
    else:
        print(
            f"[OK] Snapshot BVC → {msg.topic()} "
            f"partition={msg.partition()} offset={msg.offset()}"
        )


def main():
    producer = Producer(KAFKA_CONFIG)
    print(
        f"BVC Producer démarré — topic '{TOPIC}', intervalle {INTERVAL}s, "
        f"broker={KAFKA_CONFIG['bootstrap.servers']}. Ctrl+C pour arrêter."
    )

    while True:
        try:
            actions = fetch_actions()
            masi    = fetch_masi()

            vol_total  = sum(a["volume"] for a in actions if a["volume"] is not None) or None
            capi_total = sum(a["capi"]   for a in actions if a["capi"]   is not None) or None

            session = "open" if any(
                a["status"] == "T" for a in actions
            ) else "closed"

            payload = json.dumps(
                {
                    "evenement":  "bvc_snapshot",
                    "horodatage": datetime.now(timezone.utc).isoformat(),
                    "session":    session,
                    "masi":       masi,
                    "vol_total":  vol_total,
                    "capi_total": capi_total,
                    "actions":    actions,
                },
                ensure_ascii=False,
            )
            producer.produce(
                topic=TOPIC,
                key=b"BVC",
                value=payload.encode("utf-8"),
                callback=on_delivery,
            )
            producer.poll(0)
            n_traded = sum(1 for a in actions if a["status"] == "T")
            masi_v   = masi.get("value") or 0
            masi_p   = masi.get("change_pct") or 0
            print(
                f"[BVC] {datetime.now().strftime('%H:%M:%S')} — "
                f"MASI {masi_v:.2f} ({masi_p:+.2f}%) — "
                f"{n_traded}/{len(actions)} titres traités"
            )
        except Exception as e:
            print(f"[ERREUR] Scraping BVC : {e}")

        try:
            time.sleep(INTERVAL)
        except KeyboardInterrupt:
            break

    print("Flush du producer avant arrêt…")
    producer.flush()


if __name__ == "__main__":
    if Producer is None:
        print(
            "Erreur : confluent-kafka introuvable. "
            "Installez-le avec : pip install confluent-kafka"
        )
        sys.exit(1)
    main()
