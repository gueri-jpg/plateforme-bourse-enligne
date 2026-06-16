"""
Producer / Consumer Kafka - Topic "orders.created"

Role (cf. docs/architecture.md, sections 1 et 4) :
    Ce topic represente la demande de traitement d'un ordre, au marche
    (`type_ordre = "marche"`) ou a cours limite (`type_ordre = "limite"`,
    avec `prix_limite`), juste apres sa creation par l'API Gateway / Backend
    (statut initial "en_attente").

    - Producer : simule l'**API Gateway**, qui publie un message sur
      "orders.created" a chaque ordre valide syntaxiquement par
      `POST /api/ordres` (US-11, US-12, US-26, US-27).
    - Consumer : simule l'**Order Execution Service**, qui consomme ces
      messages pour appliquer les regles metier (verification solde/position,
      horaires de marche, execution immediate ou mise en attente selon
      `type_ordre` - cf. architecture.md section 4.2).

    Format du message (JSON), conforme a l'enveloppe commune definie en
    architecture.md section 4.3 :

    {
        "evenement": "ordre_cree",
        "horodatage": "<ISO 8601>",
        "id_correlation": "<UUID de l'ordre>",
        "donnees": {
            "id_ordre": "<UUID>",
            "id_compte": "<UUID>",
            "code_instrument": "AAPL",
            "sens": "achat" | "vente",
            "type_ordre": "marche" | "limite",
            "quantite": 10,
            "prix_limite": 95.50,           // present uniquement si type_ordre = "limite"
            "statut": "en_attente"
        }
    }

    Cle de partition Kafka = identifiant du compte (id_compte), afin de
    garantir l'ordre des evenements relatifs a un meme compte
    (architecture.md section 4.3).

    NB : Dans une implementation complete, le producer serait declenche par
    l'endpoint `POST /api/ordres` du backend juste apres l'enregistrement de
    l'ordre en PostgreSQL (ordres.ordres, statut = "en_attente"). Ce squelette
    simule un ordre de demonstration pour illustrer le format des messages.
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
    "client.id": "api-gateway-orders-created-producer",
}

KAFKA_CONFIG_CONSUMER = {
    "bootstrap.servers": "localhost:9092",
    # Groupe de consommateurs simulant l'"Order Execution Service"
    "group.id": "order-execution-service-orders-created",
    "auto.offset.reset": "earliest",
    "enable.auto.commit": True,
}

TOPIC_ORDERS_CREATED = "orders.created"


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


def construire_message_ordre_cree(
    id_ordre: str,
    id_compte: str,
    code_instrument: str,
    sens: str,
    type_ordre: str,
    quantite: float,
    prix_limite: float | None = None,
) -> dict:
    """
    Construit le message JSON publie sur "orders.created", selon
    l'enveloppe commune definie en architecture.md section 4.3.

    `prix_limite` n'est inclus dans "donnees" que si `type_ordre = "limite"`
    (US-26, US-27).
    """
    donnees = {
        "id_ordre": id_ordre,
        "id_compte": id_compte,
        "code_instrument": code_instrument,
        "sens": sens,
        "type_ordre": type_ordre,
        "quantite": quantite,
        "statut": "en_attente",
    }

    if type_ordre == "limite":
        if prix_limite is None:
            raise ValueError("prix_limite est obligatoire pour un ordre de type 'limite'")
        donnees["prix_limite"] = round(prix_limite, 4)

    return {
        "evenement": "ordre_cree",
        "horodatage": datetime.now(timezone.utc).isoformat(),
        "id_correlation": id_ordre,
        "donnees": donnees,
    }


def produire_ordre_demo(type_ordre: str = "limite") -> None:
    """
    Publie un ordre de demonstration sur "orders.created".

    `type_ordre` peut etre "marche" ou "limite" (par defaut "limite", pour
    illustrer le cas d'usage US-26/US-27 traite par
    `limit_order_trigger.py`).
    """
    producteur = Producer(KAFKA_CONFIG_PRODUCER)

    id_ordre = str(uuid.uuid4())
    id_compte = str(uuid.uuid4())

    if type_ordre == "limite":
        message = construire_message_ordre_cree(
            id_ordre=id_ordre,
            id_compte=id_compte,
            code_instrument="AAPL",
            sens="achat",
            type_ordre="limite",
            quantite=5,
            prix_limite=95.00,
        )
    else:
        message = construire_message_ordre_cree(
            id_ordre=id_ordre,
            id_compte=id_compte,
            code_instrument="AAPL",
            sens="achat",
            type_ordre="marche",
            quantite=5,
        )

    print(f"Publication d'un ordre de demonstration ({type_ordre}) : {message}")

    producteur.produce(
        topic=TOPIC_ORDERS_CREATED,
        # Cle de partition = id_compte, pour garantir l'ordre des evenements
        # relatifs a un meme compte (architecture.md section 4.3)
        key=id_compte.encode("utf-8"),
        value=json.dumps(message).encode("utf-8"),
        callback=callback_envoi,
    )

    producteur.flush()


def traiter_message_ordre_cree(message_json: dict) -> None:
    """
    Traite un message recu sur "orders.created" (cote Order Execution Service).

    Dans ce squelette, le traitement se limite a un affichage console.

    TODO (evolutions futures, hors perimetre de ce squelette) :
        - Resoudre l'ordre en base (ordres.ordres) a partir de "id_ordre".
        - Verifier les horaires de marche (marche.parametres_marche).
        - Verifier le solde (achat) ou la position (vente) -
          montant = quantite * prix_marche (au marche) ou
          quantite * prix_limite (a cours limite).
        - Si type_ordre = "marche" et valide : executer immediatement au
          dernier cours connu, publier sur "orders.executed".
        - Si type_ordre = "limite" et valide : laisser l'ordre en
          "en_attente" - l'execution est deleguee au
          Limit Order Trigger Service (cf. limit_order_trigger.py).
        - Si invalide : publier sur "orders.rejected" avec le motif adequat.
    """
    donnees = message_json.get("donnees", {})
    type_ordre = donnees.get("type_ordre")
    prix_limite = donnees.get("prix_limite")

    print(
        f"[orders.created] {message_json.get('horodatage')} - "
        f"ordre {donnees.get('id_ordre')} : "
        f"{donnees.get('sens')} {donnees.get('quantite')} "
        f"{donnees.get('code_instrument')} (type={type_ordre}"
        + (f", prix_limite={prix_limite}" if prix_limite is not None else "")
        + ")"
    )

    if type_ordre == "limite":
        print(
            "  -> Ordre a cours limite : enregistre en 'en_attente', "
            "execution deleguee au Limit Order Trigger Service."
        )
    else:
        print("  -> Ordre au marche : a executer immediatement au meilleur prix disponible.")


def consommer() -> None:
    """
    Boucle principale du consumer : s'abonne au topic "orders.created"
    et traite chaque message recu jusqu'a interruption (Ctrl+C).
    """
    consommateur = Consumer(KAFKA_CONFIG_CONSUMER)
    consommateur.subscribe([TOPIC_ORDERS_CREATED])

    print(f"Abonnement au topic '{TOPIC_ORDERS_CREATED}' "
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
                traiter_message_ordre_cree(contenu)
            except (json.JSONDecodeError, UnicodeDecodeError) as erreur:
                print(f"[ERREUR] Message illisible (JSON invalide) : {erreur}")

    except KeyboardInterrupt:
        print("\nArret demande par l'utilisateur.")

    finally:
        print("Fermeture du consumer...")
        consommateur.close()


if __name__ == "__main__":
    # Usage :
    #   python producer_consumer_orders_created.py produire [marche|limite]
    #   python producer_consumer_orders_created.py consommer
    if len(sys.argv) < 2 or sys.argv[1] not in ("produire", "consommer"):
        print("Usage : python producer_consumer_orders_created.py [produire [marche|limite]|consommer]")
        sys.exit(1)

    if sys.argv[1] == "produire":
        type_ordre_arg = sys.argv[2] if len(sys.argv) > 2 else "limite"
        produire_ordre_demo(type_ordre=type_ordre_arg)
    else:
        consommer()
