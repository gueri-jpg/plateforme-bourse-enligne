"""
Consumer Kafka - Topic "market.prices"

Role (cf. docs/architecture.md, sections 1 et 4) :
    Ce script simule la consommation du topic "market.prices" par
    l'API Gateway / Backend, qui s'en sert pour :
        - mettre a jour la table marche.cours_actuels en PostgreSQL
          (non implemente ici, voir TODO),
        - repercuter le cours en temps reel vers le frontend (push),
        - alimenter l'Order Execution Service avec le dernier cours connu
          (US-11, US-12 : execution au meilleur prix disponible).

    Chaque message recu correspond a l'enveloppe definie en
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
"""

import json

from confluent_kafka import Consumer, KafkaError, KafkaException


# ----------------------------------------------------------------------
# Configuration du consumer Kafka
# ----------------------------------------------------------------------
KAFKA_CONFIG = {
    "bootstrap.servers": "localhost:9092",

    # Identifiant du groupe de consommateurs : tous les consumers partageant
    # le meme group.id se repartissent les partitions du topic
    "group.id": "api-gateway-market-prices",

    # "earliest" : si aucun offset n'a encore ete commite pour ce groupe,
    # on commence la lecture depuis le debut du topic (utile pour les tests)
    "auto.offset.reset": "earliest",

    # Validation automatique des offsets consommes (simplifie le squelette ;
    # une implementation production pourrait preferer un commit manuel
    # apres traitement effectif du message)
    "enable.auto.commit": True,
}

TOPIC_MARKET_PRICES = "market.prices"


def traiter_message_cours(message_json: dict) -> None:
    """
    Traite un message de mise a jour de cours recu sur "market.prices".

    Dans ce squelette, le traitement se limite a un affichage console.

    TODO (evolutions futures, hors perimetre de ce squelette) :
        - UPSERT dans PostgreSQL marche.cours_actuels (instrument_id,
          dernier_prix, horodatage_maj, variation_pct) en resolvant
          l'instrument_id a partir du code_instrument.
        - INSERT dans marche.historique_cours pour conserver l'historique.
        - Push du cours vers le frontend via le canal applicatif (websocket
          ou autre mecanisme cote backend, hors stack Keycloak/PostgreSQL/Kafka).
    """
    donnees = message_json.get("donnees", {})
    code_instrument = donnees.get("code_instrument")
    dernier_prix = donnees.get("dernier_prix")
    variation_pct = donnees.get("variation_pct")
    marche_ouvert = donnees.get("marche_ouvert")
    horodatage = message_json.get("horodatage")

    print(
        f"[market.prices] {horodatage} - {code_instrument} : "
        f"prix={dernier_prix} | variation={variation_pct}% | "
        f"marche_ouvert={marche_ouvert}"
    )


def main():
    """
    Boucle principale du consumer : s'abonne au topic "market.prices"
    et traite chaque message recu jusqu'a interruption (Ctrl+C).
    """
    consommateur = Consumer(KAFKA_CONFIG)
    consommateur.subscribe([TOPIC_MARKET_PRICES])

    print(f"Abonnement au topic '{TOPIC_MARKET_PRICES}' "
          f"(group.id='{KAFKA_CONFIG['group.id']}'). Ctrl+C pour arreter.")

    try:
        while True:
            # Attente d'un message pendant au maximum 1 seconde
            message = consommateur.poll(timeout=1.0)

            if message is None:
                # Aucun message recu pendant le timeout : on reboucle
                continue

            if message.error():
                # Fin de partition atteinte : information, pas une erreur bloquante
                if message.error().code() == KafkaError._PARTITION_EOF:
                    continue
                else:
                    raise KafkaException(message.error())

            try:
                contenu = json.loads(message.value().decode("utf-8"))
                traiter_message_cours(contenu)
            except (json.JSONDecodeError, UnicodeDecodeError) as erreur:
                print(f"[ERREUR] Message illisible (JSON invalide) : {erreur}")

    except KeyboardInterrupt:
        print("\nArret demande par l'utilisateur.")

    finally:
        # Ferme proprement le consumer : libere les partitions et
        # commite les offsets en attente
        print("Fermeture du consumer...")
        consommateur.close()


if __name__ == "__main__":
    main()
