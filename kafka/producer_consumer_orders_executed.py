"""
Producer / Consumer Kafka - Topic "orders.executed"

Role (cf. docs/architecture.md, sections 1 et 4) :
    Ce topic represente le resultat d'execution d'un ordre, qu'il s'agisse :
      - d'un ordre "au marche" execute immediatement par l'**Order Execution
        Service**, ou
      - d'un ordre "a cours limite" dont le seuil de prix vient d'etre
        atteint, declenche par le **Limit Order Trigger Service**
        (cf. limit_order_trigger.py, US-26 a US-29).

    - Producer : simule l'Order Execution Service / Limit Order Trigger
      Service, qui publient le resultat d'execution apres mise a jour de
      PostgreSQL (ordres.ordres, ordres.executions, portefeuille.comptes,
      portefeuille.positions, historique.mouvements_compte).
    - Consumer : simule l'**API Gateway**, qui consomme ces messages pour
      notifier le frontend en temps reel (US-15, US-28) et tenir a jour les
      vues de portefeuille.

    Format du message (JSON), conforme a l'enveloppe commune definie en
    architecture.md section 4.3 :

    {
        "evenement": "ordre_execute",
        "horodatage": "<ISO 8601>",
        "id_correlation": "<UUID de l'ordre>",
        "donnees": {
            "id_ordre": "<UUID>",
            "id_compte": "<UUID>",
            "code_instrument": "AAPL",
            "sens": "achat" | "vente",
            "type_ordre": "marche" | "limite",
            "prix_execution": 95.00,
            "quantite_executee": 5,
            "montant_total": 475.00,
            "statut": "execute"
        }
    }

    Cle de partition Kafka = identifiant du compte (id_compte), afin de
    garantir l'ordre des evenements relatifs a un meme compte
    (architecture.md section 4.3).

    NB : Dans une implementation complete, ce producer serait declenche par
    l'Order Execution Service (ordres au marche) ou par le Limit Order
    Trigger Service (ordres a cours limite declenches), juste apres la
    transaction PostgreSQL de mise a jour du portefeuille. Ce squelette
    simule un evenement de demonstration pour illustrer le format des
    messages.
"""

import json
import sys
import uuid
from datetime import datetime, timezone

from confluent_kafka import Consumer, KafkaError, KafkaException, Producer


# ----------------------------------------------------------------------
# Configuration commune Kafka
# ----------------------------------------------------------------------
KAFKA_CONFIG_PRODUCER = {
    "bootstrap.servers": "localhost:9092",
    "client.id": "order-execution-service-orders-executed-producer",
}

KAFKA_CONFIG_CONSUMER = {
    "bootstrap.servers": "localhost:9092",
    # Groupe de consommateurs simulant l'"API Gateway" (notification frontend)
    "group.id": "api-gateway-orders-executed",
    "auto.offset.reset": "earliest",
    "enable.auto.commit": True,
}

TOPIC_ORDERS_EXECUTED = "orders.executed"


def callback_envoi(erreur, message):
    """
    Callback de livraison asynchrone (succes/echec) pour le producer.
    """
    if erreur is not None:
        print(f"[ERREUR] Echec d'envoi du message sur {message.topic()} : {erreur}")
    else:
        print(
            f"[OK] Message envoye sur {message.topic()} "
            f"[partition {message.partition()}] offset {message.offset()}"
        )


def construire_message_ordre_execute(
    id_ordre: str,
    id_compte: str,
    code_instrument: str,
    sens: str,
    type_ordre: str,
    prix_execution: float,
    quantite_executee: float,
) -> dict:
    """
    Construit le message JSON publie sur "orders.executed", selon
    l'enveloppe commune definie en architecture.md section 4.3.
    """
    montant_total = round(prix_execution * quantite_executee, 2)

    return {
        "evenement": "ordre_execute",
        "horodatage": datetime.now(timezone.utc).isoformat(),
        "id_correlation": id_ordre,
        "donnees": {
            "id_ordre": id_ordre,
            "id_compte": id_compte,
            "code_instrument": code_instrument,
            "sens": sens,
            "type_ordre": type_ordre,
            "prix_execution": round(prix_execution, 4),
            "quantite_executee": quantite_executee,
            "montant_total": montant_total,
            "statut": "execute",
        },
    }


def produire_execution_demo(type_ordre: str = "limite") -> None:
    """
    Publie un evenement d'execution de demonstration sur "orders.executed".
    """
    producteur = Producer(KAFKA_CONFIG_PRODUCER)

    id_ordre = str(uuid.uuid4())
    id_compte = str(uuid.uuid4())

    message = construire_message_ordre_execute(
        id_ordre=id_ordre,
        id_compte=id_compte,
        code_instrument="AAPL",
        sens="achat",
        type_ordre=type_ordre,
        prix_execution=95.00,
        quantite_executee=5,
    )

    print(f"Publication d'un evenement d'execution de demonstration ({type_ordre}) : {message}")

    producteur.produce(
        topic=TOPIC_ORDERS_EXECUTED,
        # Cle de partition = id_compte, pour garantir l'ordre des evenements
        # relatifs a un meme compte (architecture.md section 4.3)
        key=id_compte.encode("utf-8"),
        value=json.dumps(message).encode("utf-8"),
        callback=callback_envoi,
    )

    producteur.flush()


def traiter_message_ordre_execute(message_json: dict) -> None:
    """
    Traite un message recu sur "orders.executed" (cote API Gateway).

    Dans ce squelette, le traitement se limite a un affichage console.

    TODO (evolutions futures, hors perimetre de ce squelette) :
        - Push de l'evenement vers le frontend (canal applicatif backend),
          pour mise a jour temps reel du statut de l'ordre (US-15, US-28) et
          du portefeuille (US-18).
        - Mise a jour des vues de portefeuille en cache cote backend, si
          applicable.
    """
    donnees = message_json.get("donnees", {})

    print(
        f"[orders.executed] {message_json.get('horodatage')} - "
        f"ordre {donnees.get('id_ordre')} ({donnees.get('type_ordre')}) execute : "
        f"{donnees.get('sens')} {donnees.get('quantite_executee')} "
        f"{donnees.get('code_instrument')} @ {donnees.get('prix_execution')} "
        f"= {donnees.get('montant_total')}"
    )


def consommer() -> None:
    """
    Boucle principale du consumer : s'abonne au topic "orders.executed"
    et traite chaque message recu jusqu'a interruption (Ctrl+C).
    """
    consommateur = Consumer(KAFKA_CONFIG_CONSUMER)
    consommateur.subscribe([TOPIC_ORDERS_EXECUTED])

    print(f"Abonnement au topic '{TOPIC_ORDERS_EXECUTED}' "
          f"(group.id='{KAFKA_CONFIG_CONSUMER['group.id']}'). Ctrl+C pour arreter.")

    try:
        while True:
            message = consommateur.poll(timeout=1.0)

            if message is None:
                continue

            if message.error():
                if message.error().code() == KafkaError._PARTITION_EOF:
                    continue
                else:
                    raise KafkaException(message.error())

            try:
                contenu = json.loads(message.value().decode("utf-8"))
                traiter_message_ordre_execute(contenu)
            except (json.JSONDecodeError, UnicodeDecodeError) as erreur:
                print(f"[ERREUR] Message illisible (JSON invalide) : {erreur}")

    except KeyboardInterrupt:
        print("\nArret demande par l'utilisateur.")

    finally:
        print("Fermeture du consumer...")
        consommateur.close()


if __name__ == "__main__":
    # Usage :
    #   python producer_consumer_orders_executed.py produire [marche|limite]
    #   python producer_consumer_orders_executed.py consommer
    if len(sys.argv) < 2 or sys.argv[1] not in ("produire", "consommer"):
        print("Usage : python producer_consumer_orders_executed.py [produire [marche|limite]|consommer]")
        sys.exit(1)

    if sys.argv[1] == "produire":
        type_ordre_arg = sys.argv[2] if len(sys.argv) > 2 else "limite"
        produire_execution_demo(type_ordre=type_ordre_arg)
    else:
        consommer()
