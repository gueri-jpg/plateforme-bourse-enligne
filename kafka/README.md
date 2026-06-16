# Kafka - Producers / Consumers Python

Ce dossier contient le squelette des producers/consumers Kafka en **Python**,
conforme aux topics definis dans `docs/architecture.md` (section 4).

## Contenu

- `producer_market_prices.py` : simule le "Market Data Feed Service" et
  publie periodiquement des cours simules sur le topic `market.prices`.
- `consumer_market_prices.py` : simule la consommation du topic
  `market.prices` cote API Gateway (affichage console dans ce squelette).
- `producer_consumer_orders_created.py` : simule la publication d'un ordre
  cree (au marche ou a cours limite, US-26/US-27) par l'API Gateway sur
  `orders.created`, et sa consommation par l'Order Execution Service.
- `producer_consumer_orders_executed.py` : simule la publication d'un
  resultat d'execution d'ordre sur `orders.executed` (Order Execution
  Service ou Limit Order Trigger Service), et sa consommation par l'API
  Gateway (notification frontend, US-15/US-28).
- `limit_order_trigger.py` : implemente le **"Limit Order Trigger Service"**
  (architecture.md section 4.2, US-26 a US-29) : consomme `market.prices` en
  continu et declenche l'execution des ordres a cours limite "en_attente"
  (simules en memoire dans ce squelette) en publiant sur `orders.executed`.
- `requirements.txt` : dependances Python (`confluent-kafka`).

## Topics couverts

| Topic | Statut dans ce livrable |
|---|---|
| `market.prices` | Producer + consumer fournis (`producer_market_prices.py` / `consumer_market_prices.py`), et consomme par `limit_order_trigger.py` |
| `orders.created` | Producer + consumer fournis (`producer_consumer_orders_created.py`), couvre ordres "au marche" et "a cours limite" |
| `orders.executed` | Producer + consumer fournis (`producer_consumer_orders_executed.py`), et produit par `limit_order_trigger.py` lors du declenchement d'un ordre a cours limite |
| `orders.cancelled` | A implementer (meme structure, voir architecture.md section 4.1) |
| `orders.rejected` | A implementer |

> `orders.cancelled` et `orders.rejected` suivront la meme structure de code
> (producer/consumer + enveloppe JSON commune decrite en architecture.md
> section 4.3) et pourront etre ajoutes sur demande.

## Mise en place de l'environnement Python

```bash
# Depuis le dossier kafka/
python -m venv .venv

# Activation (Windows PowerShell)
.venv\Scripts\Activate.ps1

# Activation (bash/zsh)
source .venv/bin/activate

pip install -r requirements.txt
```

## Execution

Pre-requis : Kafka doit etre demarre via `docker-compose up -d kafka`
(le port 9092 doit etre accessible depuis l'hote).

```bash
# Terminal 1 : producer (publie des cours simules toutes les 5 secondes)
python producer_market_prices.py

# Terminal 2 : consumer (affiche les cours recus)
python consumer_market_prices.py
```

### `orders.created` (ordres au marche et a cours limite, US-26/US-27)

```bash
# Publie un ordre de demonstration "a cours limite" (par defaut)
python producer_consumer_orders_created.py produire limite

# Publie un ordre de demonstration "au marche"
python producer_consumer_orders_created.py produire marche

# Consumer : affiche les ordres crees recus (simule l'Order Execution Service)
python producer_consumer_orders_created.py consommer
```

### `orders.executed` (resultats d'execution, US-15/US-28)

```bash
# Publie un evenement d'execution de demonstration
python producer_consumer_orders_executed.py produire limite

# Consumer : affiche les executions recues (simule l'API Gateway)
python producer_consumer_orders_executed.py consommer
```

### `limit_order_trigger.py` (Limit Order Trigger Service, US-26 a US-29)

Ce service consomme `market.prices` en continu et declenche l'execution
des ordres a cours limite "en_attente" (simules en memoire au demarrage du
script - liste `ORDRES_LIMITES_SIMULES`) lorsque le seuil de prix est
atteint, en publiant le resultat sur `orders.executed`.

```bash
# Terminal 1 : producer de cours (le Limit Order Trigger Service en a besoin
# pour evaluer les seuils de prix)
python producer_market_prices.py

# Terminal 2 : Limit Order Trigger Service
python limit_order_trigger.py

# Terminal 3 (optionnel) : consumer "orders.executed" pour observer les
# declenchements en temps reel
python producer_consumer_orders_executed.py consommer
```

> Les ordres simules portent sur les instruments `AAPL` et `MSFT` avec des
> prix limites proches du prix initial (100.00) defini dans
> `producer_market_prices.py`, afin que les declenchements surviennent
> rapidement lors de la simulation des variations de cours (+/- 1%).
