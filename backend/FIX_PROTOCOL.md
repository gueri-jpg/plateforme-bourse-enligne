# FIX Protocol — Routage d'Ordres Boursiers

## Vue d'ensemble

Ce module implémente le **protocole FIX 5.0 / FIXT.1.1** (Financial Information eXchange) pour
le routage d'ordres boursiers, en suivant la spécification **MIT202 — FIX Trading Gateway
(FIX5.0)** du **London Stock Exchange (LSE) Millennium Exchange**, adapté aux **heures de
marché de la BVC (Casablanca)**.

Le "FIX" reste un format de message interne au process (pas de vraie session TCP entre deux
systèmes) : il n'y a donc pas de Logon/Logout/Heartbeat simulés — en revanche, les numéros de
séquence (`MsgSeqNum`, tag 34) se comportent comme de vrais compteurs monotones par sens
(section 4.2.1 de MIT202), et le header applicatif (`BeginString`, `ApplVerID`, `PartyID`,
`OrderCapacity`, `AccountType`, timestamps microseconde) suit fidèlement la spécification.

Seuls les messages de **gestion d'ordres actions** sont implémentés — Quotes, RFQ et Cross
Orders (sections 2.2/2.14/6.5 de MIT202) sont hors sujet pour un carnet d'ordres actions simple.

---

## Architecture

```
┌─────────────────┐     REST/JSON      ┌──────────────────────┐
│   App Mobile    │ ─────────────────▶ │  API FastAPI          │
│   (React Native)│                    │  POST /api/ordres     │
└─────────────────┘                    └──────────┬───────────┘
                                                   │
                                       ┌───────────▼───────────┐
                                       │  fix_messages.py       │
                                       │  build_new_order()     │
                                       │  "35=D|48=ATW|54=1|…" │
                                       └───────────┬───────────┘
                                                   │  FIX 5.0 (35=D)
                                       ┌───────────▼───────────┐
                                       │  fix_engine.py         │
                                       │  process_new_order()   │
                                       │  Moteur de matching    │
                                       │  Carnet d'ordres (RAM) │
                                       └───────────┬───────────┘
                                                   │  FIX 5.0 (35=8)
                                       ┌───────────▼───────────┐
                                       │  Execution Report      │
                                       │  ordres_bourse.py      │
                                       │  Mise à jour DB        │
                                       └───────────────────────┘
```

---

## Messages FIX implémentés

| Tag 35 | Type de message           | Sens              |
|--------|---------------------------|-------------------|
| `D`    | New Order Single          | App → Marché      |
| `F`    | Order Cancel Request      | App → Marché      |
| `G`    | Order Cancel/Replace Request | App → Marché   |
| `q`    | Order Mass Cancel Request | App → Marché      |
| `8`    | Execution Report          | Marché → App      |
| `9`    | Order Cancel Reject       | Marché → App      |
| `r`    | Order Mass Cancel Report  | Marché → App      |
| `j`    | Business Message Reject   | Marché → App (complétude — pas de point d'usage actif) |
| `3`    | Reject (session)          | Marché → App (complétude — pas de point d'usage actif, validation de forme faite en amont par Pydantic) |

---

## Tags FIX principaux

| Tag  | Nom               | Valeurs possibles                                             |
|------|-------------------|----------------------------------------------------------------|
| 8    | BeginString       | `FIXT.1.1`                                                     |
| 35   | MsgType           | D / F / G / q / 8 / 9 / r / j                                  |
| 49   | SenderCompID      | `CFC_BOURSE` (app→marché) / `LSE_GATEWAY` (marché→app)         |
| 56   | TargetCompID      | inverse de SenderCompID                                        |
| 34   | MsgSeqNum         | compteur monotone réel, indépendant par sens                   |
| 1128 | ApplVerID         | `9` = FIX50SP2                                                  |
| 11   | ClOrdID           | UUID unique par ordre/requête                                  |
| 37   | OrderID           | UUID attribué par le moteur                                    |
| 48   | SecurityID        | Code instrument (ex : `ATW`, `IAM`, `CIH`) — remplace Symbol(55) en FIX 5.0 |
| 22   | SecurityIDSource  | `8` = Exchange Symbol                                           |
| 453/448/447/452 | NoPartyIDs/PartyID/PartyIDSource/PartyRole | Trader Group(76)=compte, Client ID(3)/Investment Decision Maker(122)=`0` (None), Executing Trader(12)=`3` (CLIENT) |
| 54   | Side              | `1`=Achat, `2`=Vente                                            |
| 40   | OrdType           | `1`=Marché, `2`=Limite, `3`=Stop, `4`=Stop Limit, `P`=Pegged, `F`=Offset |
| 38   | OrderQty          | Quantité demandée                                               |
| 44   | Price             | Prix limite (Limit, Stop Limit, plafond optionnel Pegged/Offset) |
| 99   | StopPx            | Prix de déclenchement (Stop / Stop Limit uniquement)            |
| 1138 | DisplayQty        | Quantité affichée (= OrderQty sauf Iceberg/Hidden)               |
| 1084 | DisplayMethod     | `3`=Random Replenished Iceberg, `4`=Hidden (absent = Fixed Peak) |
| 110  | MinQty            | MES — quantité minimale d'exécution (ordres Pegged)             |
| 1091 | PreTradeAnonymity | `Y`=Anonyme (défaut), `N`=Named                                  |
| 126  | ExpireTime        | Heure d'expiration (TIF GTD, avec ExpireTime au lieu d'ExpireDate — usage "GTT") |
| 432  | ExpireDate        | Date d'expiration (TIF GTD)                                      |
| 27018| Offset            | Décalage en points de base vs Dynamic Reference Price (ordres Offset) |
| 336  | TradingSessionID  | `a` = session CPX (Closing Price Crossing), portée par un ordre DAY |
| 59   | TimeInForce       | `0`=Day, `2`=OPG, `3`=IOC, `4`=FOK, `6`=GTD, `7`=ATC, `8`=GFX, `9`=GFA, `C`=GFS (pas de `GTC` ni de valeur dédiée `GTT`/`CPX` — hors spec MIT202, voir plus bas) |
| 528  | OrderCapacity     | `A` = Any Other Trading Capacity (AOTC) — ordres clients retail |
| 581  | AccountType       | `1` = Client (pas de notion de compte "House")                  |
| 39   | OrdStatus         | `0`=New, `1`=PartialFill, `2`=Filled, `4`=Canceled, `8`=Rejected, `9`=Suspended, `C`=Expired |
| 150  | ExecType          | `0`=New, `4`=Cancelled, `5`=Replaced, `8`=Rejected, `9`=Suspended, `C`=Expired, `F`=Trade (fill partiel ou total — distingué via OrdStatus) |
| 14   | CumQty            | Quantité cumulée exécutée (sur toute la vie de l'ordre)         |
| 151  | LeavesQty         | Quantité restante                                               |
| 6    | AvgPx             | Prix moyen d'exécution cumulé                                   |
| 434  | CxlRejResponseTo  | `1`=Cancel Request, `2`=Cancel/Replace Request                  |
| 102  | CxlRejReason      | `0`=Too late to cancel, `1`=Unknown order                       |
| 530  | MassCancelRequestType | `1`=All Orders for Instrument, `7`=All Orders               |
| 531  | MassCancelResponse    | `0`=Rejected, `1`/`7`=accepté (même valeur que la requête)  |
| 58   | Text              | Message textuel (raison rejet, etc.)                            |

---

## Exemple de flux complet

### 1. Ordre limite achat ATW — 100 titres à 490 MAD

**Message FIX envoyé (35=D) :**
```
8=FIXT.1.1|9=...|35=D|49=CFC_BOURSE|56=LSE_GATEWAY|34=1|1128=9|52=20260722-09:15:00.000000|
11=a1b2c3d4|453=4|448=<compte_id>|447=D|452=76|448=0|447=P|452=3|448=0|447=P|452=122|
448=3|447=P|452=12|21=1|48=ATW|22=8|54=1|38=100|40=2|59=0|581=1|528=A|
60=20260722-09:15:00.000000|44=490.0000|10=187|
```

**Execution Report reçu (35=8) — ordre en attente dans le carnet :**
```
8=FIXT.1.1|9=...|35=8|49=LSE_GATEWAY|56=CFC_BOURSE|34=1|1128=9|52=...|
17=exec-uuid|11=a1b2c3d4|37=order-uuid|150=0|39=0|453=4|...|48=ATW|22=8|
40=2|54=1|38=100|32=0|31=0.0000|14=0|151=100|6=0.0000|581=1|528=A|
44=490.0000|58=Ordre limite accepté et en attente dans le carnet|10=043|
```

### 2. Modification d'un ordre — remontée du prix (35=G) déclenchant une exécution

```
35=G|41=<orig_cl_ord_id>|11=<cl_ord_id>|37=<order_id>|453=1|448=<compte_id>|447=D|452=76|
48=ATW|22=8|40=2|54=1|38=100|44=493.0000|60=...
```
Si `493.0000` croise désormais le meilleur ask du carnet, l'Execution Report retourné a
`150=F` (Trade) et `39=1` ou `2` (PartiallyFilled/Filled selon la quantité disponible en face) ;
sinon `150=5` (Replaced) et `39=0` (New), l'ordre reprenant sa place dans le carnet — avec perte
de priorité temps puisque le prix a changé (section 2.1.2.3).

### 3. Annulation groupée (35=q) — tous les ordres du compte sur un instrument

```
35=q|11=<cl_ord_id>|530=1|48=ATW|22=8|1461=1|1462=<compte_id>|1463=D|1464=76|60=...
```
Réponse (35=r) :
```
35=r|1369=<report_id>|11=<cl_ord_id>|530=1|531=1|10=...
```
suivie d'un Execution Report (`150=4` Cancelled) pour chaque ordre effectivement annulé.

---

## Phases de marché BVC (Casablanca)

| Phase       | Horaire (Casablanca) | Comportement                                            |
|-------------|-----------------------|----------------------------------------------------------|
| PRE_OPEN    | 08h30 – 09h00        | Ordres acceptés, "parqués" hors carnet (Suspended, 39=9) |
| CONTINUOUS  | 09h00 – 15h30        | Matching en continu, priorité prix-temps                |
| CLOSED      | Hors horaires         | Ordres au marché rejetés (35=8, OrdStatus=8)             |

> Les jours ouvrables sont lundi–vendredi.

---

## Algorithme de matching (Price-Time Priority)

Identique à l'algorithme LSE Millennium Exchange :

1. **Bids** (acheteurs) triés par prix **décroissant**, puis par heure d'arrivée croissante
2. **Asks** (vendeurs) triés par prix **croissant**, puis par heure d'arrivée croissante
3. Match possible si : `bid.price >= ask.price`
4. Prix d'exécution = prix de l'ordre **au repos** (resting order)
5. Exécution partielle possible si les quantités ne se correspondent pas exactement

### Amendement (Cancel/Replace) et priorité temps — section 2.1.2.3

- Prix modifié **ou** quantité **augmentée** → perte de priorité temps (nouveau timestamp)
- Quantité **réduite** seule → priorité temps conservée
- Un ordre déjà filled/cancelled/absent du carnet → `Order Cancel Reject` (35=9) avec
  `OrdStatus=Rejected` même si le statut réel diffère (comportement documenté en 2.10.3)

---

## Types d'ordres et TimeInForce

| type_ordre     | TimeInForce | Comportement                                            |
|----------------|-------------|----------------------------------------------------------|
| `marche`       | `day`       | Exécuté immédiatement au meilleur prix disponible       |
| `limite`       | `day`       | Exécuté si prix croise le carnet, sinon attend          |
| `limite`       | `gtc`       | Reste dans le carnet jusqu'à exécution ou annulation (mappé sur TIF_DAY=0 côté FIX — voir note ci-dessous) |
| `limite`       | `ioc`       | Exécute ce qui est possible, annule le reste            |
| `limite`       | `fok`       | Exécute entièrement ou annule complètement              |
| `stop`         | —           | Parqué (non déclenché) jusqu'à ce qu'un prix négocié franchisse `stop_px` ; devient alors un ordre Market |
| `stop_limite`  | —           | Identique à `stop`, mais devient un ordre Limite (`prix_limite`) une fois déclenché |
| `iceberg`      | —           | Ordre limite dont seule `display_qty` est visible dans le carnet ; réapprovisionné (nouvelle priorité temps) quand le clip visible est épuisé — Fixed Peak (toujours `display_qty`) ou Random Replenished (`display_method=random`, taille tirée entre 50 % et 100 % de `display_qty`) |
| `cache`        | —           | Hidden : entièrement invisible dans le carnet (`display_qty=0`), mais participe normalement au matching |
| `pegged`       | —           | Prix recalculé en continu au midpoint du meilleur bid/ask ; `min_qty` (MES) optionnel refuse les exécutions sous ce seuil |
| `offset`       | `atc`       | Prix = DRP ± DRP×`offset_bp` (2.1.1.2), DRP approximé par le dernier prix négocié ; TIF `atc` obligatoire |
| `limite`/autre | `opg`/`gfa`/`gfx`/`gfs` | Parqué en pré-ouverture comme n'importe quel ordre, puis exécuté en séance continue via le matching réactif standard (simplification assumée, voir plus bas) |
| `limite`/autre | `gtd`       | Expire (`ExecType=Expired`) si `ExpireDate` (432) est dépassée — sweep paresseux (vérifié à chaque appel touchant le carnet, pas de tâche de fond) |
| `limite`/autre | `gtt`       | Comme `gtd`, mais avec une `ExpireTime` (126) précise au lieu d'une date — MIT202 exprime GTT via `GTD`+`ExpireTime`, pas une valeur TIF séparée |
| `limite`/autre | `cpx`       | Mis en file d'attente dédiée (pas dans le carnet visible), croisé entre acheteurs/vendeurs CPX au prix de clôture dès que celui-ci est connu |

> **`gtc` n'existe pas dans l'énumération TimeInForce (59) de MIT202** — LSE Millennium
> Exchange ne supporte pas un ordre valable indéfiniment, seulement `DAY` (0) et `GTD` (6, avec
> une `ExpireDate`). Le tag FIX émis pour un ordre `"gtc"` est donc `59=0` (DAY) — c'est un
> mapping business/API interne, pas une valeur FIX distincte.

> **`gtt` et `cpx` n'ont pas non plus de valeur FIX dédiée** : `gtt` s'exprime via
> `TimeInForce=GTD (6)` + `ExpireTime (126)` au lieu d'`ExpireDate (432)` ; `cpx` s'exprime via
> `TradingSessionID=336="a"` sur un ordre par ailleurs `TIF_DAY`, pas via le tag 59.

### Simplifications assumées (TIF d'enchère)

Cette plateforme BVC ne modélise que 3 phases de marché (pré-ouverture / continu / fermé), sans
scheduler ni tâche de fond, et sans notion d'enchère EDSP ou de calendrier d'enchères
programmées distinctes. En conséquence :

- **OPG, ATC, GFA, GFX, GFS** ne déclenchent aucune mécanique de carnet dédiée : ils suivent le
  chemin déjà codé pour la pré-ouverture (parking sans distinction de TIF, déjà appliqué à
  n'importe quel ordre aujourd'hui) puis le matching réactif standard en séance continue — **pas
  un véritable algorithme d'uncrossing multilatéral à prix unique**. GFX et GFS convergent vers
  le même traitement que GFA.
- **Le Dynamic Reference Price (DRP)** des ordres Offset est approximé par le dernier prix
  négocié disponible (`_LAST_TRADE_PX`), pas par un vrai calcul d'auction.
- **CPX** est la seule TIF d'enchère à bénéficier d'un mécanisme dédié (file d'attente par
  symbole, dénouée au prix de clôture connu), car MIT202 la définit comme un croisement bilatéral
  simple plutôt qu'une enchère multilatérale.

---

## API REST — Endpoints

### `POST /api/ordres` — Passer un ordre

**Corps (JSON) :**
```json
{
  "instrument_code": "ATW",
  "sens": "achat",
  "type_ordre": "limite",
  "quantite": 100,
  "prix_limite": 490.00,
  "time_in_force": "day"
}
```

**Réponse :**
```json
{
  "id": "uuid-ordre-db",
  "fix_cl_ord_id": "uuid-fix",
  "statut": "en_attente",
  "prix_execution": null,
  "quantite_executee": null,
  "montant_total": null,
  "message": "⏳ Ordre FIX d'achat de 100 × ATW en attente dans le carnet."
}
```

### `PUT /api/ordres/{id}/modifier` — Modifier un ordre (35=G)

Envoie un **FIX Order Cancel/Replace Request (35=G)** au moteur de matching. Seuls la quantité
et/ou le prix limite sont modifiables (pas de changement de sens ou d'instrument), et seuls les
ordres à cours limité peuvent être modifiés.

```json
{ "quantite": 150, "prix_limite": 493.0 }
```

### `PUT /api/ordres/{id}/annuler` — Annuler un ordre

Envoie un **FIX Cancel Request (35=F)** au moteur de matching.

### `PUT /api/ordres/annuler-tout?symbol=ATW` — Annuler tous les ordres (35=q)

Envoie un **FIX Order Mass Cancel Request (35=q)**, restreint aux ordres du compte appelant.
Le paramètre `symbol` est optionnel (sinon annule tous les ordres du compte, tous instruments).

### `GET /api/ordres/carnet/{symbol}` — Snapshot du carnet d'ordres

```json
{
  "symbol": "ATW",
  "phase": "continuous",
  "bids": [
    {"prix": 492.0, "quantite": 200, "ordre_id": "uuid1"},
    {"prix": 490.0, "quantite": 100, "ordre_id": "uuid2"}
  ],
  "asks": [
    {"prix": 493.0, "quantite": 150, "ordre_id": "uuid3"}
  ]
}
```

---

## Statuts possibles (retournés par le moteur FIX)

| Statut                  | FIX OrdStatus | Description                              |
|-------------------------|---------------|-------------------------------------------|
| `execute`               | `2` (Filled)  | Totalement exécuté                       |
| `partiellement_execute` | `1` (Partial) | Partiellement exécuté, reste en attente  |
| `en_attente`            | `0` (New) / `9` (Suspended en pré-ouverture) | En attente dans le carnet |
| `annule`                | `4` (Canceled)| Annulé (FOK, IOC, ou demande client)     |
| `rejete`                | `8` (Rejected)| Rejeté (marché fermé, paramètres invalides) |
| `expire`                | `C` (Expired) | GTD/GTT dépassé, ou DAY encore en carnet à la clôture |

---

## Fichiers

```
backend/app/services/
  fix_messages.py   ← Builder / Parser FIX 5.0/FIXT.1.1 (35=D, F, G, q, 8, 9, r, j)
  fix_engine.py     ← Moteur de matching simulé + carnet d'ordres en mémoire

backend/app/routers/
  ordres_bourse.py  ← Router FastAPI — intègre le flux FIX complet

db/migrations/
  001_fix_carnet.sql              ← time_in_force + statut partiellement_execute
  002_ordres_types_avances.sql    ← Stop/Iceberg/Hidden/Pegged/Offset + TIF GTD/GTT/OPG/ATC/GFX/GFA/GFS/CPX
```

---

## Références

- MIT202 — FIX Trading Gateway (FIX5.0), London Stock Exchange, Issue 13.1 (3 juillet 2020)
- [LSE Millennium Exchange Technical Specification](https://www.londonstockexchange.com/resources/trading-resources/technical-specification)
- [BVC — Règles de marché](https://www.casablanca-bourse.com)
