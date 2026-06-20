"""
Producer Kafka - Topic "market.prices"

Role (cf. docs/architecture.md, sections 1 et 4) :
    Ce script simule le "Market Data Feed Service" : il publie periodiquement
    le cours d'instruments financiers sur le topic Kafka "market.prices".

    Format du message (JSON), conforme a l'enveloppe commune definie en
    architecture.md section 4.3 :

    {
        "evenement": "cours_maj",
        "horodatage": "<ISO 8601>",
        "id_correlation": "<code de l'instrument>",
        "donnees": {
            "code_instrument": "AAPL",
            "dernier_prix": 101.23,
            "variation_pct": 1.23,
            "marche_ouvert": true
        }
    }

    Cle de partition Kafka = code de l'instrument, afin de garantir l'ordre
    des cours pour un meme instrument (architecture.md section 4.3).

    NB : Dans une implementation complete, ce service persisterait egalement
    l'historique des cours dans PostgreSQL (marche.historique_cours) et
    mettrait a jour marche.cours_actuels. Cette persistance n'est pas
    incluse dans ce squelette (hors perimetre de ce livrable Kafka), mais
    le code est structure pour faciliter cet ajout ulterieur.
"""

import json
import random
import time
import sys
from datetime import datetime, timezone

try:
    from confluent_kafka import Producer
except ImportError as err:
    Producer = None
    IMPORT_CONFLUENT_KAFKA_ERROR = err


# ----------------------------------------------------------------------
# Configuration du producer Kafka
# ----------------------------------------------------------------------
# "bootstrap.servers" pointe vers le listener "PLAINTEXT_HOST" expose par
# le conteneur Kafka du docker-compose.yml (port 9092 sur l'hote).
KAFKA_CONFIG = {
    "bootstrap.servers": "localhost:9092",
    # Identifiant logique du client, utile pour le monitoring cote broker
    "client.id": "market-data-feed-producer",
}

TOPIC_MARKET_PRICES = "market.prices"

# Liste des instruments simules, alignee avec les donnees de demonstration
# inserees dans db/init.sql (schema marche.instruments)
INSTRUMENTS_DEMO = [
    {"code": "AAPL", "prix_initial": 100.00},
    {"code": "MSFT", "prix_initial": 100.00},
    {"code": "TTE", "prix_initial": 100.00},
]


def callback_envoi(erreur, message):
    """
    Callback appele de maniere asynchrone par le producer apres tentative
    d'envoi d'un message (succes ou echec). Permet de tracer les erreurs
    de livraison sans bloquer la boucle principale.
    """
    if erreur is not None:
        print(f"[ERREUR] Echec d'envoi du message sur {message.topic()} : {erreur}")
    else:
        print(
            f"[OK] Message envoye sur {message.topic()} "
            f"[partition {message.partition()}] offset {message.offset()}"
        )


def construire_message_cours(code_instrument: str, dernier_prix: float, variation_pct: float, marche_ouvert: bool) -> dict:
    """
    Construit le message JSON publie sur le topic "market.prices",
    selon l'enveloppe commune definie en architecture.md section 4.3.
    """
    return {
        "evenement": "cours_maj",
        "horodatage": datetime.now(timezone.utc).isoformat(),
        "id_correlation": code_instrument,
        "donnees": {
            "code_instrument": code_instrument,
            "dernier_prix": round(dernier_prix, 4),
            "variation_pct": round(variation_pct, 4),
            "marche_ouvert": marche_ouvert,
        },
    }


def simuler_evolution_prix(prix_courant: float) -> float:
    """
    Simule l'evolution du cours d'un instrument par une variation
    aleatoire de +/- 1% maximum, en empechant un prix negatif ou nul.
    """
    variation = random.uniform(-0.01, 0.01)
    nouveau_prix = max(0.01, prix_courant * (1 + variation))
    return nouveau_prix


def main():
    """
    Boucle principale du producer : publie un nouveau cours pour chaque
    instrument toutes les `intervalle_secondes` secondes.

    Dans ce squelette, le marche est considere "ouvert" en permanence
    (marche_ouvert=true) afin de simplifier la simulation. Une evolution
    future pourra interroger marche.parametres_marche (PostgreSQL) pour
    determiner l'etat reel du marche selon l'horodatage courant.
    """
    producteur = Producer(KAFKA_CONFIG)

    # Initialisation des prix courants en memoire (point de depart pour la simulation)
    prix_courants = {instrument["code"]: instrument["prix_initial"] for instrument in INSTRUMENTS_DEMO}

    intervalle_secondes = 5

    print(f"Demarrage du producer Kafka sur le topic '{TOPIC_MARKET_PRICES}' "
          f"(intervalle = {intervalle_secondes}s). Ctrl+C pour arreter.")

    try:
        while True:
            for instrument in INSTRUMENTS_DEMO:
                code = instrument["code"]
                ancien_prix = prix_courants[code]

                # Calcul du nouveau cours simule et de la variation associee
                nouveau_prix = simuler_evolution_prix(ancien_prix)
                variation_pct = ((nouveau_prix - ancien_prix) / ancien_prix) * 100
                prix_courants[code] = nouveau_prix

                message = construire_message_cours(
                    code_instrument=code,
                    dernier_prix=nouveau_prix,
                    variation_pct=variation_pct,
                    marche_ouvert=True,
                )

                # Envoi asynchrone : la cle de partition est le code de l'instrument
                # (garantit l'ordre des messages pour un meme instrument)
                producteur.produce(
                    topic=TOPIC_MARKET_PRICES,
                    key=code.encode("utf-8"),
                    value=json.dumps(message).encode("utf-8"),
                    callback=callback_envoi,
                )

            # Declenche l'envoi effectif des messages bufferises et execute
            # les callbacks de livraison en attente
            producteur.poll(0)

            time.sleep(intervalle_secondes)

    except KeyboardInterrupt:
        print("\nArret demande par l'utilisateur.")

    finally:
        # Vide le buffer interne et attend la confirmation de livraison
        # de tous les messages avant de quitter proprement
        print("Vidage du buffer du producer (flush)...")
        producteur.flush()


if __name__ == "__main__":
    if Producer is None:
        print(
            "Erreur: le module confluent_kafka est introuvable. "
            "Installez confluent-kafka et relancez le script."
        )
        sys.exit(1)

    main()
