"""
Limit Order Trigger Service - consumer "market.prices" / producer "orders.executed"

Role (cf. docs/architecture.md, sections 1 et 4.2, US-26 a US-29) :
    Ce service consomme en continu le topic "market.prices". Pour chaque
    mise a jour de cours recue, il evalue les ordres "a cours limite"
    actuellement "en_attente" sur l'instrument concerne, et declenche leur
    execution (publication sur "orders.executed") lorsque le seuil de prix
    est atteint :

      - achat (sens = "achat")  : declenchement si dernier_prix <= prix_limite
      - vente (sens = "vente")  : declenchement si dernier_prix >= prix_limite

    IMPORTANT (squelette) :
    En production, la liste des ordres "a cours limite" "en_attente" serait
    lue depuis PostgreSQL (table ordres.ordres, filtre
    `type_ordre = 'limite' AND statut = 'en_attente' AND instrument_id = ...`,
    cf. index idx_ordres_limite_en_attente dans db/init.sql), et chaque
    declenchement mettrait a jour PostgreSQL dans une transaction atomique
    (ordres.ordres.statut = 'execute', ordres.executions, mise a jour du
    solde/positions dans portefeuille.*, et insertion dans
    historique.mouvements_compte), comme decrit en architecture.md section
    4.2 ("Limit Order Trigger Service", etape 3).

    Dans ce squelette, ces ordres sont simules par une liste en memoire
    (ORDRES_LIMITES_SIMULES) afin d'illustrer le mecanisme de declenchement
    sans necessiter de connexion PostgreSQL. Chaque ordre declenche et
    execute est retire de la liste en memoire (equivalent du passage a
    statut = 'execute' en base).

    Verifie egalement (de maniere simplifiee, via le champ "marche_ouvert"
    du message "market.prices") que l'execution n'a lieu que pendant les
    horaires d'ouverture du marche (architecture.md section 4.2, derniere
    puce) - en production ce controle s'appuierait sur
    marche.parametres_marche.

    Format des messages consommes ("market.prices") et publies
    ("orders.executed") : cf. producer_market_prices.py et
    producer_consumer_orders_executed.py (enveloppe commune,
    architecture.md section 4.3).
"""

import json
import uuid
from datetime import datetime, timezone

from confluent_kafka import Consumer, KafkaError, KafkaException, Producer


# ----------------------------------------------------------------------
# Configuration Kafka
# ----------------------------------------------------------------------
KAFKA_CONFIG_CONSUMER = {
    "bootstrap.servers": "localhost:9092",
    # Groupe de consommateurs dedie au Limit Order Trigger Service
    "group.id": "limit-order-trigger-service",
    "auto.offset.reset": "earliest",
    "enable.auto.commit": True,
}

KAFKA_CONFIG_PRODUCER = {
    "bootstrap.servers": "localhost:9092",
    "client.id": "limit-order-trigger-service-producer",
}

TOPIC_MARKET_PRICES = "market.prices"
TOPIC_ORDERS_EXECUTED = "orders.executed"


# ----------------------------------------------------------------------
# SIMULATION EN MEMOIRE des ordres "a cours limite" en attente
# ----------------------------------------------------------------------
# En production, ces donnees proviendraient de PostgreSQL :
#   SELECT * FROM ordres.ordres
#   WHERE type_ordre = 'limite' AND statut = 'en_attente'
#     AND instrument_id = <instrument du message recu>;
# (cf. index idx_ordres_limite_en_attente, db/init.sql)
#
# Chaque entree simule une ligne de ordres.ordres avec les colonnes
# pertinentes pour l'evaluation du declenchement (US-26 a US-29).
ORDRES_LIMITES_SIMULES = [
    {
        "id_ordre": str(uuid.uuid4()),
        "id_compte": str(uuid.uuid4()),
        "code_instrument": "AAPL",
        "sens": "achat",       # declenche si dernier_prix <= prix_limite
        "type_ordre": "limite",
        "quantite": 5,
        "prix_limite": 99.00,
        "statut": "en_attente",
    },
    {
        "id_ordre": str(uuid.uuid4()),
        "id_compte": str(uuid.uuid4()),
        "code_instrument": "AAPL",
        "sens": "vente",       # declenche si dernier_prix >= prix_limite
        "type_ordre": "limite",
        "quantite": 3,
        "prix_limite": 101.00,
        "statut": "en_attente",
    },
    {
        "id_ordre": str(uuid.uuid4()),
        "id_compte": str(uuid.uuid4()),
        "code_instrument": "MSFT",
        "sens": "achat",
        "type_ordre": "limite",
        "quantite": 2,
        "prix_limite": 98.50,
        "statut": "en_attente",
    },
]


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


def ordre_doit_se_declencher(ordre: dict, dernier_prix: float) -> bool:
    """
    Determine si un ordre "a cours limite" doit etre execute compte tenu
    du dernier cours connu, selon la regle metier US-26/US-27/US-28 :

      - achat : declenche si dernier_prix <= prix_limite
                (le cours est descendu au niveau ou sous le prix maximal vise)
      - vente : declenche si dernier_prix >= prix_limite
                (le cours a atteint ou depasse le prix minimal vise)
    """
    prix_limite = ordre["prix_limite"]

    if ordre["sens"] == "achat":
        return dernier_prix <= prix_limite
    elif ordre["sens"] == "vente":
        return dernier_prix >= prix_limite

    return False


def construire_message_ordre_execute(ordre: dict, prix_execution: float) -> dict:
    """
    Construit le message "orders.executed" pour un ordre a cours limite
    declenche, selon l'enveloppe commune definie en architecture.md
    section 4.3.

    Regle de meilleure execution (point ouvert specs section 7.9) : ce
    squelette retient le prix limite comme prix d'execution (hypothese la
    plus simple). Une evolution future pourrait retenir le dernier cours si
    celui-ci est plus favorable a l'investisseur.
    """
    quantite = ordre["quantite"]
    montant_total = round(prix_execution * quantite, 2)

    return {
        "evenement": "ordre_execute",
        "horodatage": datetime.now(timezone.utc).isoformat(),
        "id_correlation": ordre["id_ordre"],
        "donnees": {
            "id_ordre": ordre["id_ordre"],
            "id_compte": ordre["id_compte"],
            "code_instrument": ordre["code_instrument"],
            "sens": ordre["sens"],
            "type_ordre": "limite",
            "prix_execution": round(prix_execution, 4),
            "quantite_executee": quantite,
            "montant_total": montant_total,
            "statut": "execute",
        },
    }


def evaluer_ordres_limites(producteur: Producer, code_instrument: str, dernier_prix: float, marche_ouvert: bool) -> None:
    """
    Evalue tous les ordres "a cours limite" "en_attente" (simules en memoire)
    portant sur `code_instrument`, et declenche l'execution de ceux dont le
    seuil de prix est atteint, en publiant sur "orders.executed".

    L'execution n'a lieu que si le marche est ouvert (architecture.md
    section 4.2, derniere puce). Si le marche est ferme, les ordres restent
    "en_attente" meme si le seuil theorique est atteint.
    """
    if not marche_ouvert:
        print(f"[market.prices] {code_instrument} @ {dernier_prix} - marche ferme, "
              f"aucune execution d'ordre a cours limite.")
        return

    # Filtre les ordres en attente sur cet instrument
    # (en production : requete SQL sur ordres.ordres, cf. index dedie)
    candidats = [
        ordre for ordre in ORDRES_LIMITES_SIMULES
        if ordre["code_instrument"] == code_instrument and ordre["statut"] == "en_attente"
    ]

    if not candidats:
        return

    for ordre in candidats:
        if ordre_doit_se_declencher(ordre, dernier_prix):
            print(
                f"[DECLENCHEMENT] Ordre {ordre['id_ordre']} ({ordre['sens']} "
                f"{ordre['quantite']} {ordre['code_instrument']} @ limite "
                f"{ordre['prix_limite']}) declenche par dernier_prix={dernier_prix}"
            )

            # Determination du prix d'execution (cf. construire_message_ordre_execute)
            prix_execution = ordre["prix_limite"]

            message = construire_message_ordre_execute(ordre, prix_execution)

            producteur.produce(
                topic=TOPIC_ORDERS_EXECUTED,
                # Cle de partition = id_compte (architecture.md section 4.3)
                key=ordre["id_compte"].encode("utf-8"),
                value=json.dumps(message).encode("utf-8"),
                callback=callback_envoi,
            )

            # En production : transaction PostgreSQL mettant a jour
            # ordres.ordres (statut = 'execute'), ordres.executions,
            # portefeuille.comptes / positions, historique.mouvements_compte.
            # Ici, on retire simplement l'ordre de la liste en memoire pour
            # simuler le passage a statut = 'execute'.
            ordre["statut"] = "execute"

    producteur.poll(0)


def traiter_message_cours(producteur: Producer, message_json: dict) -> None:
    """
    Traite un message recu sur "market.prices" : extrait le cours et
    declenche l'evaluation des ordres a cours limite en attente sur
    l'instrument concerne.
    """
    donnees = message_json.get("donnees", {})
    code_instrument = donnees.get("code_instrument")
    dernier_prix = donnees.get("dernier_prix")
    marche_ouvert = donnees.get("marche_ouvert", True)

    if code_instrument is None or dernier_prix is None:
        print(f"[ERREUR] Message 'market.prices' incomplet, ignore : {message_json}")
        return

    print(f"[market.prices] {code_instrument} @ {dernier_prix} "
          f"(marche_ouvert={marche_ouvert}) - evaluation des ordres limites en attente...")

    evaluer_ordres_limites(producteur, code_instrument, dernier_prix, marche_ouvert)


def main():
    """
    Boucle principale du Limit Order Trigger Service :
    s'abonne au topic "market.prices" et, pour chaque cours recu, evalue les
    ordres a cours limite en attente sur l'instrument concerne, en publiant
    les declenchements sur "orders.executed" (Ctrl+C pour arreter).
    """
    consommateur = Consumer(KAFKA_CONFIG_CONSUMER)
    consommateur.subscribe([TOPIC_MARKET_PRICES])

    producteur = Producer(KAFKA_CONFIG_PRODUCER)

    print(f"Limit Order Trigger Service demarre : abonnement a '{TOPIC_MARKET_PRICES}' "
          f"(group.id='{KAFKA_CONFIG_CONSUMER['group.id']}'), "
          f"publication des declenchements sur '{TOPIC_ORDERS_EXECUTED}'. Ctrl+C pour arreter.")
    print(f"Ordres a cours limite simules en memoire au demarrage : {len(ORDRES_LIMITES_SIMULES)}")

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
                traiter_message_cours(producteur, contenu)
            except (json.JSONDecodeError, UnicodeDecodeError) as erreur:
                print(f"[ERREUR] Message illisible (JSON invalide) : {erreur}")

    except KeyboardInterrupt:
        print("\nArret demande par l'utilisateur.")

    finally:
        print("Vidage du buffer du producer (flush) et fermeture du consumer...")
        producteur.flush()
        consommateur.close()


if __name__ == "__main__":
    main()
