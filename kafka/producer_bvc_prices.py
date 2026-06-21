"""
Producer BVC → Kafka — topic "market.prices"

Scrape la Bourse de Casablanca toutes les INTERVAL secondes et publie
un snapshot complet sur le topic Kafka "market.prices".

Format du message :
{
    "evenement": "bvc_snapshot",
    "horodatage": "<ISO 8601>",
    "donnees": {
        "overview": { ...pageProps BVC... },
        "stocks":   { ...pageProps BVC... }
    }
}

Variable d'environnement :
    KAFKA_BOOTSTRAP_SERVERS  (défaut : localhost:9092)
    BVC_INTERVAL_SECONDS     (défaut : 30)
"""

import json
import os
import re
import sys
import threading
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
TOPIC = "market.prices"
INTERVAL = int(os.getenv("BVC_INTERVAL_SECONDS", "30"))

_build_id_cache: dict = {"value": None, "at": 0.0}
_lock = threading.Lock()

_session = requests.Session()
_session.headers.update({
    "User-Agent": UA,
    "Accept": "*/*",
    "Accept-Language": "fr-FR,fr;q=0.9",
})
# Le serveur BVC ne transmet pas sa chaîne intermédiaire depuis Linux —
# on désactive la vérification pour ce scraper de données publiques.
_session.verify = False
requests.packages.urllib3.disable_warnings(
    requests.packages.urllib3.exceptions.InsecureRequestWarning
)


def http_get(url: str, timeout: int = 15) -> str:
    r = _session.get(url, timeout=timeout)
    r.raise_for_status()
    return r.text


def get_build_id(force: bool = False) -> str:
    with _lock:
        now = time.time()
        if not force and _build_id_cache["value"] and (now - _build_id_cache["at"] < 600):
            return _build_id_cache["value"]
        html = http_get(BVC_HOST + "/fr/live-market/overview")
        m = re.search(r'"buildId":"([^"]+)"', html)
        if not m:
            raise RuntimeError("buildId introuvable dans la page BVC")
        _build_id_cache["value"] = m.group(1)
        _build_id_cache["at"] = now
        return _build_id_cache["value"]


def fetch_bvc_json(path: str) -> dict:
    bid = get_build_id()
    url = f"{BVC_HOST}/_next/data/{bid}/{path}.json"
    try:
        return _session.get(url, timeout=15).json()
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code == 404:
            bid = get_build_id(force=True)
            return _session.get(
                f"{BVC_HOST}/_next/data/{bid}/{path}.json", timeout=15
            ).json()
        raise


def on_delivery(err, msg):
    if err:
        print(f"[ERREUR] Kafka delivery : {err}")
    else:
        print(
            f"[OK] Snapshot BVC publié → {msg.topic()} "
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
            overview = fetch_bvc_json("fr/live-market/overview")
            stocks = fetch_bvc_json("fr/live-market/marche-actions-groupement")
            payload = json.dumps(
                {
                    "evenement": "bvc_snapshot",
                    "horodatage": datetime.now(timezone.utc).isoformat(),
                    "donnees": {"overview": overview, "stocks": stocks},
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
            print(f"[BVC] Snapshot envoyé à {datetime.now().strftime('%H:%M:%S')}")
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