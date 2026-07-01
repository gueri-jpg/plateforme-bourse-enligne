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
from datetime import date, datetime, timedelta, timezone

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


_BVC_API = "https://api.casablanca-bourse.com/fr/api/bourse_data/index_watch"
_MASI_FIELDS = "fields[index_watch]=indexValue,transactTime"
_MASI_FILTER = (
    "filter[index][condition][path]=indexCode.field_code"
    "&filter[index][condition][value]=MASI"
    "&filter[indexValue][condition][path]=indexValue"
    "&filter[indexValue][condition][operator]=IS NOT NULL"
)

def _last_trading_day(ref: date) -> date:
    """Retourne le dernier jour ouvré avant ref (exclut sam/dim)."""
    d = ref - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d

def fetch_masi_tick(for_date: date) -> dict | None:
    """
    Appelle directement l'API BVC (api.casablanca-bourse.com) pour obtenir
    le dernier tick MASI d'une journée donnée.
    Retourne {"value": float, "time": str} ou None en cas d'erreur.
    """
    url = (
        f"{_BVC_API}?{_MASI_FIELDS}&{_MASI_FILTER}"
        f"&filter[seance][condition][path]=transactTime"
        f"&filter[seance][condition][operator]=STARTS_WITH"
        f"&filter[seance][condition][value]={for_date.isoformat()}"
        f"&sort=-transactTime&page[limit]=1"
    )
    try:
        r = _session.get(url, timeout=10)
        r.raise_for_status()
        data = r.json().get("data", [])
        if not data:
            return None
        attr = data[0].get("attributes", {})
        return {"value": float(attr["indexValue"]), "time": attr["transactTime"]}
    except Exception:
        return None


def _extract_masi_last_tick(overview: dict) -> str | None:
    """
    Extrait le transactTime du dernier tick MASI dans le JSON BVC.
    Sert à détecter si les données overview ont réellement changé.
    """
    try:
        node = overview["pageProps"]["node"]
        for p in node.get("field_vactory_paragraphs", []):
            c = p.get("field_vactory_component", {})
            if "marches-overview" not in c.get("widget_id", ""):
                continue
            wd = c.get("widget_data", "{}")
            w = json.loads(wd) if isinstance(wd, str) else wd
            for comp in w.get("components", []):
                coll = comp.get("collection", {}).get("data", {}).get("data", [])
                if coll:
                    times = [
                        it["attributes"]["transactTime"]
                        for it in coll
                        if "transactTime" in it.get("attributes", {})
                    ]
                    return max(times) if times else None
    except Exception:
        pass
    return None


def main():
    producer = Producer(KAFKA_CONFIG)
    print(
        f"BVC Producer démarré — topic '{TOPIC}', intervalle {INTERVAL}s, "
        f"broker={KAFKA_CONFIG['bootstrap.servers']}. Ctrl+C pour arrêter."
    )

    # Dernier tick MASI connu — détecte si l'endpoint BVC a été mis à jour
    _last_masi_tick: str | None = None
    _stale_count: int = 0

    while True:
        try:
            overview = fetch_bvc_json("fr/live-market/overview")
            stocks   = fetch_bvc_json("fr/live-market/marche-actions-groupement")

            masi_tick = _extract_masi_last_tick(overview)
            stale     = (masi_tick is not None and masi_tick == _last_masi_tick)

            if stale:
                _stale_count += 1
            else:
                _stale_count = 0
                _last_masi_tick = masi_tick

            # Récupération directe du vrai tick MASI via l'API BVC (évite le cache Next.js)
            today = date.today()
            masi_live = fetch_masi_tick(today)
            masi_ref  = fetch_masi_tick(_last_trading_day(today))

            payload = json.dumps(
                {
                    "evenement": "bvc_snapshot",
                    "horodatage": datetime.now(timezone.utc).isoformat(),
                    "_stale": stale,
                    "_stale_since": _last_masi_tick,
                    "_stale_count": _stale_count,
                    # Valeur MASI temps réel (API directe, non paginée)
                    "masi_live": masi_live,
                    # Clôture du dernier jour ouvré (pour calcul variation vs veille)
                    "masi_ref": masi_ref,
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
            status = f"⚠️  données gelées (×{_stale_count})" if stale else "✓ nouvelles données"
            print(f"[BVC] Snapshot à {datetime.now().strftime('%H:%M:%S')} — {status}")
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