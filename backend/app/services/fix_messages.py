"""
FIX 5.0 (FIXT.1.1) message builder and parser — simulation LSE Millennium Exchange (MIT202).

FIX (Financial Information eXchange) est le protocole standard de messagerie
pour le routage d'ordres entre brokers et marchés financiers.
Ce module implémente le sous-ensemble FIX 5.0 / FIXT.1.1 décrit dans la
spécification MIT202 (London Stock Exchange), restreint aux messages de
gestion d'ordres (pas de Quote/RFQ/Cross Order, hors sujet pour un carnet
d'ordres actions simple).

Références :
  - MIT202 — FIX Trading Gateway (FIX5.0), London Stock Exchange, Issue 13.1
"""
import itertools
import threading
import uuid
from datetime import datetime, timezone

# Séparateur de champs FIX (ASCII SOH = 0x01)
SOH = "\x01"

# ── Types de messages (Tag 35 = MsgType) ──────────────────────────────────────
MSG_NEW_ORDER          = "D"   # New Order Single
MSG_CANCEL_REQ         = "F"   # Order Cancel Request
MSG_REPLACE_REQ        = "G"   # Order Cancel/Replace Request
MSG_MASS_CANCEL_REQ    = "q"   # Order Mass Cancel Request
MSG_EXEC_REPORT        = "8"   # Execution Report
MSG_CANCEL_REJECT      = "9"   # Order Cancel Reject
MSG_MASS_CANCEL_REPORT = "r"   # Order Mass Cancel Report
MSG_BUSINESS_REJECT    = "j"   # Business Message Reject
MSG_SESSION_REJECT     = "3"   # Reject (session-layer)

# ── Type d'ordre (Tag 40 = OrdType) ───────────────────────────────────────────
ORD_TYPE_MARKET      = "1"   # Au marché
ORD_TYPE_LIMIT       = "2"   # À cours limité
ORD_TYPE_STOP        = "3"   # Stop
ORD_TYPE_STOP_LIMIT  = "4"   # Stop Limit
ORD_TYPE_PEGGED      = "P"   # Pegged (au midpoint du BBO)
ORD_TYPE_OFFSET      = "F"   # Offset (prix calculé depuis le Dynamic Reference Price)

# ── Sens (Tag 54 = Side) ──────────────────────────────────────────────────────
SIDE_BUY  = "1"   # Achat
SIDE_SELL = "2"   # Vente

# ── Durée de validité (Tag 59 = TimeInForce) — section 2.1.1, valeurs 6.4.1 ───
# "1" (Good Till Cancelled) n'existe PAS dans l'énumération MIT202 : LSE
# Millennium Exchange ne supporte pas un ordre valable indéfiniment — seuls
# DAY (0) et GTD (6, avec ExpireDate) le permettent sur une durée > 1 jour.
# Le "gtc" exposé côté API/mobile (persistance jusqu'à exécution ou annulation
# manuelle) est mappé sur TIF_DAY (0) au niveau du protocole, seule valeur
# réellement conforme qui corresponde au comportement effectif du moteur.
TIF_DAY = "0"   # Valable la journée (défaut) — aussi utilisé pour "gtc" (voir ci-dessus)
TIF_OPG = "2"   # At the Opening — exécuté à l'enchère d'ouverture
TIF_IOC = "3"   # Immediate Or Cancel
TIF_FOK = "4"   # Fill Or Kill
TIF_GTD = "6"   # Good Till Date — valable jusqu'à ExpireDate (432)
TIF_ATC = "7"   # At the Close — exécuté à l'enchère de clôture
TIF_GFX = "8"   # Good For auction — enchère intra-journalière (EDSP)
TIF_GFA = "9"   # Good For Auction — prochaine enchère
TIF_GFS = "C"   # Good For next Scheduled auction
TIF_GTT = "gtt-local"   # Good Till Time — pas de valeur FIX dédiée (voir note ci-dessous)

# NOTE — GTT (Good Till Time) : MIT202 exprime la validité "jusqu'à une heure
# donnée" via TimeInForce=GTD (6) + ExpireTime (126) au lieu d'une valeur TIF
# séparée (section 2.1.1 : "ExpireTime... used in conjunction with a
# TimeInForce of GoodTillDate"). TIF_GTT ci-dessus n'est donc PAS une valeur
# FIX réelle : c'est un identifiant côté API uniquement, traduit en TIF_GTD
# avec ExpireTime rempli (et ExpireDate absent) lors de la construction du
# message FIX — cf. ordres_bourse.py.

# ── Session de croisement au prix de clôture (Tag 336 = TradingSessionID) ────
# CPX (Closing Price Crossing) n'est PAS une valeur de TimeInForce dans
# MIT202 : c'est un bloc de session (TradingSessionID=336="a") qui accompagne
# un ordre dont la TIF reste par ailleurs DAY. Comme pour "gtc" ci-dessus, on
# documente et on suit ce mapping : un ordre CPX est construit avec
# TIF_DAY + trading_session_id=TRADING_SESSION_ID_CPX (au lieu d'inventer une
# fausse valeur de tag 59).
TRADING_SESSION_ID_CPX = "a"

# ── Statut ordre (Tag 39 = OrdStatus) — section 2.1.3 ─────────────────────────
STATUS_NEW          = "0"
STATUS_PARTIAL_FILL = "1"
STATUS_FILLED       = "2"
STATUS_CANCELED     = "4"
STATUS_REJECTED     = "8"
STATUS_SUSPENDED    = "9"   # Ordre "parké" hors carnet (ex : file d'attente pré-ouverture)
STATUS_EXPIRED      = "C"

# ── Type d'exécution (Tag 150 = ExecType) — section 6.4.5 ─────────────────────
# Distinct de OrdStatus (39) : ExecType indique l'ÉVÉNEMENT, OrdStatus l'ÉTAT résultant.
# Un fill (partiel ou total) est toujours ExecType=F ; c'est OrdStatus qui
# distingue PartiallyFilled (1) de Filled (2).
EXEC_TYPE_NEW          = "0"
EXEC_TYPE_CANCELED     = "4"
EXEC_TYPE_REPLACED     = "5"
EXEC_TYPE_REJECTED     = "8"
EXEC_TYPE_SUSPENDED    = "9"
EXEC_TYPE_EXPIRED      = "C"
EXEC_TYPE_TRADE        = "F"
EXEC_TYPE_RESTATED     = "D"   # Order Cancel/Replace by Market Operations/Restated — 6.4.5

# ── Raison de restatement (Tag 378 = ExecRestatementReason) — 6.4.5 ──────────
EXEC_RESTATEMENT_REASON_CPX_REPRICE   = "3"    # Ordre re-pricé au début de la session CPX
EXEC_RESTATEMENT_REASON_MARKET_OPTION = "8"    # Annulation/modification par Market Operations (hors scope ici)
EXEC_RESTATEMENT_REASON_REPLENISHMENT = "100"  # Réapprovisionnement Iceberg

# ── Iceberg / Hidden (Tag 1084 = DisplayMethod) ───────────────────────────────
DISPLAY_METHOD_RANDOM = "3"   # Random Replenished Iceberg
DISPLAY_METHOD_HIDDEN = "4"   # Hidden (DisplayQty=0)

# ── Anonymat pré-négociation (Tag 1091 = PreTradeAnonymity) ───────────────────
# Par défaut les ordres sont anonymes (Y) sur ce marché ; un ordre "Named"
# (N) expose l'identité du Trader Group à la contrepartie.
PRE_TRADE_ANONYMITY_ANON  = "Y"
PRE_TRADE_ANONYMITY_NAMED = "N"

# ── Identifiant de l'instrument (Tag 22 = SecurityIDSource) ───────────────────
# FIX 5.0 identifie l'instrument via SecurityID(48)+SecurityIDSource(22),
# et non plus via Symbol(55) comme en FIX 4.4 — cf. 2.3 / 6.4.1.
SECURITY_ID_SOURCE_EXCHANGE_SYMBOL = "8"

# ── Identification des parties (Tag 452 = PartyRole) — section 2.4 ───────────
PARTY_ROLE_TRADER_GROUP             = "76"
PARTY_ROLE_CLIENT_ID                = "3"
PARTY_ROLE_INVESTMENT_DECISION_MAKER = "122"
PARTY_ROLE_EXECUTING_TRADER         = "12"
# Trader ID (100) est optionnel (2.4.1) — identifiant d'un trader individuel
# au sein du Trader Group. Cette plateforme retail n'a pas de notion de
# trader distinct du compte (mêmes raisons que pour les rôles réservés
# ci-dessous) : le tag n'est émis QUE si un identifiant est explicitement
# fourni par l'appelant, jamais par défaut.
PARTY_ROLE_TRADER_ID                = "100"

# PartyRoleQualifier (Tag 2376) — requis UNIQUEMENT quand le PartyID d'un rôle
# Client ID/Investment Decision Maker/Executing Trader est un "short code"
# réel (4-4294967295) et NON une valeur réservée (0/1/2/3/CLIENT). Cette
# plateforme utilise toujours des valeurs réservées pour ces 3 rôles (2.4.2)
# — le tag ne doit donc structurellement jamais être émis ici ; les
# constantes sont documentées pour référence si un vrai short code est
# introduit un jour.
PARTY_ROLE_QUALIFIER_ALGORITHM      = "22"
PARTY_ROLE_QUALIFIER_LEGAL_ENTITY   = "23"
PARTY_ROLE_QUALIFIER_NATURAL_PERSON = "24"

PARTY_ID_SOURCE_PROPRIETARY = "D"   # 447=D : code propriétaire (ex : compte interne)
PARTY_ID_SOURCE_SHORT_CODE  = "P"   # 447=P : short code (valeurs réservées 0-3)

# Valeurs réservées de PartyID (448) pour Client ID / Investment Decision Maker /
# Executing Trader quand ces rôles ne sont pas distincts du compte de trading
# (cette plateforme retail n'a pas de notion de client sous-jacent séparé,
# d'algorithme de décision d'investissement, ni de trader exécutant distinct) —
# cf. tableau section 2.4.2.
PARTY_ID_NONE   = "0"   # "No client for the order" / "No Investment Decision Maker"
PARTY_ID_CLIENT = "3"   # "Executing Trader on behalf of a client" (CLIENT)

# ── Capacité de l'ordre (Tag 528 = OrderCapacity) — section 2.13.3 ────────────
# AOTC (Any Other Trading Capacity) : le broker exécute des ordres pour le
# compte de ses clients retail, ce n'est ni du DEAL (compte propre) ni du MTCH.
ORDER_CAPACITY_AOTC = "A"

# ── Type de compte (Tag 581 = AccountType) ────────────────────────────────────
ACCOUNT_TYPE_CLIENT = "1"   # Pas de notion de compte "House" (propriétaire) ici

# ── Version FIX applicative (Tag 1128 = ApplVerID) ────────────────────────────
APPL_VER_ID_FIX50SP2 = "9"

# ── Order Cancel Reject (Tag 434 = CxlRejResponseTo / Tag 102 = CxlRejReason) ─
CXL_REJ_RESPONSE_TO_CANCEL  = "1"   # Rejet d'un Order Cancel Request
CXL_REJ_RESPONSE_TO_REPLACE = "2"   # Rejet d'un Order Cancel/Replace Request
CXL_REJ_REASON_TOO_LATE      = "0"  # Too late to cancel (déjà filled/cancelled)
CXL_REJ_REASON_UNKNOWN_ORDER = "1"  # Unknown order
CXL_REJ_REASON_OTHER         = "99"  # Other — amendement structurellement invalide (StopPx/DisplayMethod/Offset Price, cf. 2.1.2.3/2.10.15/2.10.16/6.4.4)

# ── Mass Cancel (Tag 530 = MassCancelRequestType / Tag 531 = MassCancelResponse) ─
MASS_CANCEL_FOR_INSTRUMENT         = "1"    # Cancel All Orders for Instrument
MASS_CANCEL_ALL_ORDERS             = "7"    # Cancel All Orders
MASS_CANCEL_FOR_SEGMENT            = "9"    # Cancel All Orders for Segment (hors scope — pas de segments de marché ici)
MASS_CANCEL_FOR_GROUP              = "56"   # Cancel All Orders for Group
MASS_CANCEL_FOR_INSTRUMENT_GROUP   = "57"   # Cancel All Orders for Instrument for Group
MASS_CANCEL_RESPONSE_REJECTED      = "0"    # Mass Cancel Request Rejected

# ── Contrainte d'exécution passive (Tag 27010 = PassiveOnlyOrder) ────────────
PASSIVE_ONLY_NONE               = "0"     # Aucune contrainte (défaut)
PASSIVE_ONLY_NO_VISIBLE_MATCH   = "99"    # Rejeté si l'ordre croiserait un ordre visible contraire
PASSIVE_ONLY_NEW_VISIBLE_BBO    = "100"   # Accepté seulement s'il établit un nouveau meilleur prix visible
PASSIVE_ONLY_AT_OR_JOIN_BBO     = "1"     # Accepté seulement au BBO ou en le rejoignant
PASSIVE_ONLY_WITHIN_ONE_TICK    = "2"     # Accepté seulement au BBO ou à 1 palier visible
PASSIVE_ONLY_WITHIN_TWO_TICKS   = "3"     # Accepté seulement au BBO ou à 2 paliers visibles

# ── Origine de l'ordre (Tag 1724 = OrderOrigination) ─────────────────────────
ORDER_ORIGINATION_DEA = "5"   # Direct Electronic Access

# ── Attributs d'ordre (Tag 2594 = OrderAttributeType / 2595 = OrderAttributeValue) ─
ORDER_ATTRIBUTE_ALGORITHM           = "4"
ORDER_ATTRIBUTE_LIQUIDITY_PROVISION = "2"
ORDER_ATTRIBUTE_VALUE_YES           = "Y"

# ── Business Message Reject (Tag 380 = BusinessRejectReason) ─────────────────
BUSINESS_REJECT_REASON_OTHER = "0"

# ── Order Reject (Tag 103 = OrdRejReason) — voir MIT801, non détaillé ici ────
ORD_REJ_REASON_OTHER = "99"

# ── Identifiants des contreparties ────────────────────────────────────────────
SENDER_COMP_ID = "CFC_BOURSE"    # Broker (nous)
TARGET_COMP_ID = "LSE_GATEWAY"   # Passerelle de marché simulée


# ── Utilitaires internes ───────────────────────────────────────────────────────

def _timestamp() -> str:
    """Horodatage FIX en microsecondes (YYYYMMDD-HH:MM:SS.uuuuuu, UTC) — section 2.13.1."""
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H:%M:%S.%f")


def _checksum(raw: str) -> str:
    """Checksum FIX : somme des valeurs ASCII modulo 256, sur 3 chiffres."""
    return str(sum(ord(c) for c in raw) % 256).zfill(3)


# Compteurs de séquence réels et monotones, un par sens (section 4.2.1 : le
# client et le serveur maintiennent chacun un jeu indépendant de numéros de
# séquence entrant/sortant). Comme il n'y a pas de vraie session réseau ici
# (le "FIX" est un format de message interne au process), il n'y a pas de
# Logon/Logout à simuler — mais le compteur, lui, doit se comporter comme un
# vrai numéro de séquence FIX : initialisé à 1, incrémenté à chaque message.
_seq_lock     = threading.Lock()
_seq_counters = {
    "out": itertools.count(1),   # Client (CFC_BOURSE) → Marché (LSE_GATEWAY)
    "in":  itertools.count(1),   # Marché (LSE_GATEWAY) → Client (CFC_BOURSE)
}


def _next_seq(direction: str) -> str:
    with _seq_lock:
        return str(next(_seq_counters[direction]))


def _build(msg_type: str, body_fields: list[tuple[str, str]], direction: str) -> str:
    """
    Assemble un message FIXT.1.1 complet : BeginString + BodyLength + header +
    body + CheckSum (section 6.2).

    direction="out" : message client → marché (SenderCompID=CFC_BOURSE)
    direction="in"  : message marché → client (SenderCompID=LSE_GATEWAY)
    """
    sender, target = (
        (SENDER_COMP_ID, TARGET_COMP_ID) if direction == "out"
        else (TARGET_COMP_ID, SENDER_COMP_ID)
    )
    header: list[tuple[str, str]] = [
        ("35", msg_type),
        ("49", sender),
        ("56", target),
        ("34", _next_seq(direction)),
        ("1128", APPL_VER_ID_FIX50SP2),
        ("52", _timestamp()),
    ]
    body = ""
    for tag, val in header + body_fields:
        body += f"{tag}={val}{SOH}"

    prefix = f"8=FIXT.1.1{SOH}9={len(body)}{SOH}"
    full   = prefix + body
    return full + f"10={_checksum(full)}{SOH}"


def _party_fields_order(trader_group_id: str, trader_id: str | None = None) -> list[tuple[str, str]]:
    """
    Bloc PartyID complet (New Order Single / Execution Report) — 6.4.1 / 6.4.5.
    NoPartyIDs=4 (ou 5 si trader_id fourni), les 4 rôles obligatoires (Trader
    Group, Client ID, Investment Decision Maker, Executing Trader). Cette
    plateforme retail ne distingue pas de client/décideur d'investissement/
    trader exécutant séparés du compte de trading : on applique les valeurs
    réservées documentées en 2.4.2 pour ce cas ("No client for the order",
    "No Investment Decision Maker", "Executing Trader on behalf of a client").
    Trader ID (100) est optionnel (2.4.1) — n'est ajouté que si explicitement
    fourni, cette plateforme n'ayant pas de notion de trader individuel
    distinct du compte.
    """
    fields = [
        ("453", "5" if trader_id is not None else "4"),
        ("448", trader_group_id), ("447", PARTY_ID_SOURCE_PROPRIETARY), ("452", PARTY_ROLE_TRADER_GROUP),
        ("448", PARTY_ID_NONE),   ("447", PARTY_ID_SOURCE_SHORT_CODE),  ("452", PARTY_ROLE_CLIENT_ID),
        ("448", PARTY_ID_NONE),   ("447", PARTY_ID_SOURCE_SHORT_CODE),  ("452", PARTY_ROLE_INVESTMENT_DECISION_MAKER),
        ("448", PARTY_ID_CLIENT), ("447", PARTY_ID_SOURCE_SHORT_CODE),  ("452", PARTY_ROLE_EXECUTING_TRADER),
    ]
    if trader_id is not None:
        fields += [("448", trader_id), ("447", PARTY_ID_SOURCE_PROPRIETARY), ("452", PARTY_ROLE_TRADER_ID)]
    return fields


def _party_fields_management(trader_group_id: str, trader_id: str | None = None) -> list[tuple[str, str]]:
    """Bloc PartyID simplifié (Cancel Request / Cancel-Replace Request) — 6.4.2 / 6.4.4."""
    fields = [
        ("453", "2" if trader_id is not None else "1"),
        ("448", trader_group_id), ("447", PARTY_ID_SOURCE_PROPRIETARY), ("452", PARTY_ROLE_TRADER_GROUP),
    ]
    if trader_id is not None:
        fields += [("448", trader_id), ("447", PARTY_ID_SOURCE_PROPRIETARY), ("452", PARTY_ROLE_TRADER_ID)]
    return fields


# ── Parseurs ────────────────────────────────────────────────────────────────────

def parse(fix_msg: str) -> dict[str, str]:
    """
    Parse un message FIX et retourne un dict {tag: valeur}.

    Si un tag est répété (ex : dans un repeating group), seule la DERNIÈRE
    occurrence est conservée — comportement documenté en 2.10.7. Pour les
    repeating groups de parties (PartyID), utiliser parse_party_ids().

    Exemple :
        parse("35=D|54=1|38=100|...") → {"35": "D", "54": "1", "38": "100", ...}
    """
    result: dict[str, str] = {}
    sep = SOH if SOH in fix_msg else "|"
    for field in fix_msg.split(sep):
        if "=" in field:
            tag, _, value = field.partition("=")
            result[tag.strip()] = value.strip()
    return result


def parse_party_ids(fix_msg: str) -> dict[str, str]:
    """
    Parse le repeating group PartyID (453/448/447/452) et retourne
    {PartyRole (452): PartyID (448)}.

    Nécessaire car parse() aplatit les tags répétés (ne garde que le dernier) ;
    ce parseur suit l'ordre d'apparition 448→447→452 de chaque entrée pour
    reconstituer la correspondance rôle → identifiant.
    """
    sep = SOH if SOH in fix_msg else "|"
    result: dict[str, str] = {}
    pending_id: str | None = None
    for field in fix_msg.split(sep):
        if "=" not in field:
            continue
        tag, _, value = field.partition("=")
        tag = tag.strip()
        if tag == "448":
            pending_id = value.strip()
        elif tag == "452" and pending_id is not None:
            result[value.strip()] = pending_id
            pending_id = None
    return result


# ── Constructeurs de messages : client → marché ───────────────────────────────

def build_new_order(
    cl_ord_id: str,
    trader_group_id: str,
    symbol: str,
    side: str,
    ord_type: str,
    quantity: int,
    price: float | None = None,
    time_in_force: str = TIF_DAY,
    stop_px: float | None = None,
    display_qty: int | None = None,
    display_method: str | None = None,
    min_qty: int | None = None,
    pre_trade_anonymity: str = PRE_TRADE_ANONYMITY_ANON,
    expire_time: str | None = None,
    expire_date: str | None = None,
    offset_bp: float | None = None,
    trading_session_id: str | None = None,
    account: str | None = None,
    trader_id: str | None = None,
    passive_only_order: str | None = None,
    secondary_cl_ord_id: str | None = None,
    cl_ord_link_id: str | None = None,
    order_origination: str | None = None,
    order_attribute_type: str | None = None,
    group_id: str | None = None,
) -> str:
    """
    Construit un message FIX New Order Single (35=D) — section 6.4.1.

    Tags principaux :
      11=ClOrdID    453/448/447/452=PartyID (Trader Group/Client ID/IDM/Exec Trader)
      48=SecurityID 22=SecurityIDSource      55 n'existe plus en FIX 5.0
      54=Side       38=OrderQty    40=OrdType    1138=DisplayQty
      44=Price      59=TimeInForce 60=TransactTime
      528=OrderCapacity  581=AccountType
      99=StopPx (Stop/Stop Limit)  1084=DisplayMethod (Iceberg/Hidden)
      110=MinQty (Pegged/MES)      1091=PreTradeAnonymity
      126=ExpireTime (GTD+heure)   432=ExpireDate (GTD)
      27018=Offset (basis points, ordres Offset)
      1=Account (référence client)          27010=PassiveOnlyOrder
      526=SecondaryClOrdID  583=ClOrdLinkID  1724=OrderOrigination (DEA)
      2593/2594/2595=Order Attributes (Algorithme/Liquidity Provision)
      27017=GroupID

    Ni HandlInst (21) ni Symbol (55) ne figurent dans le tableau de champs de
    6.4.1 — ce sont des reliquats FIX 4.4, volontairement absents ici.
    """
    fields: list[tuple[str, str]] = [
        ("11", cl_ord_id),
        *_party_fields_order(trader_group_id, trader_id),
    ]
    if account is not None:
        fields.append(("1", account))
    fields += [
        ("48", symbol),
        ("22", SECURITY_ID_SOURCE_EXCHANGE_SYMBOL),
        ("54", side),
        ("38", str(quantity)),
        # DisplayQty (1138) est obligatoire selon 6.4.1 ("mandatory to specify
        # the intended display quantity"). Égal à la quantité totale sauf pour
        # un ordre Iceberg/Hidden qui fournit explicitement un display_qty.
        ("1138", str(display_qty if display_qty is not None else quantity)),
        ("40", ord_type),
        ("59", time_in_force),
        ("581", ACCOUNT_TYPE_CLIENT),
        ("528", ORDER_CAPACITY_AOTC),
        ("60", _timestamp()),
    ]
    # Price (44) accompagne tout ordre avec une composante prix limite : Limit,
    # Stop Limit, ou Pegged/Offset avec un plafond/plancher optionnel.
    if price is not None:
        fields.append(("44", f"{price:.4f}"))
    if stop_px is not None:
        fields.append(("99", f"{stop_px:.4f}"))
    if display_method is not None:
        fields.append(("1084", display_method))
    if min_qty is not None:
        fields.append(("110", str(min_qty)))
    if pre_trade_anonymity != PRE_TRADE_ANONYMITY_ANON:
        fields.append(("1091", pre_trade_anonymity))
    # ExpireTime et ExpireDate sont mutuellement exclusifs (l'un décrit une
    # heure le jour même, l'autre une date de fin de validité pluri-jours).
    if expire_time is not None:
        fields.append(("126", expire_time))
    elif expire_date is not None:
        fields.append(("432", expire_date))
    if offset_bp is not None:
        fields.append(("27018", f"{offset_bp:.4f}"))
    if trading_session_id is not None:
        fields.append(("386", "1"))
        fields.append(("336", trading_session_id))
    if secondary_cl_ord_id is not None:
        fields.append(("526", secondary_cl_ord_id))
    if cl_ord_link_id is not None:
        fields.append(("583", cl_ord_link_id))
    if passive_only_order is not None and passive_only_order != PASSIVE_ONLY_NONE:
        fields.append(("27010", passive_only_order))
    if order_attribute_type is not None:
        fields += [("2593", "1"), ("2594", order_attribute_type), ("2595", ORDER_ATTRIBUTE_VALUE_YES)]
    if order_origination is not None:
        fields.append(("1724", order_origination))
    if group_id is not None:
        fields.append(("27017", group_id))
    return _build(MSG_NEW_ORDER, fields, direction="out")


def build_cancel_request(
    orig_cl_ord_id: str,
    cl_ord_id: str,
    order_id: str,
    trader_group_id: str,
    symbol: str,
    side: str,
    trader_id: str | None = None,
) -> str:
    """
    Construit un message FIX Order Cancel Request (35=F) — section 6.4.2.

    Tags principaux :
      41=OrigClOrdID   11=ClOrdID   37=OrderID
      48=SecurityID    22=SecurityIDSource
      453/448/447/452=PartyID (Trader Group obligatoire, Trader ID optionnel —
      pas de Client ID/IDM/Exec Trader sur les messages de gestion d'ordre)
      54=Side
    """
    fields: list[tuple[str, str]] = [
        ("41", orig_cl_ord_id),
        ("11", cl_ord_id),
        ("37", order_id),
        ("48", symbol),
        ("22", SECURITY_ID_SOURCE_EXCHANGE_SYMBOL),
        *_party_fields_management(trader_group_id, trader_id),
        ("54", side),
        ("60", _timestamp()),
    ]
    return _build(MSG_CANCEL_REQ, fields, direction="out")


def build_replace_request(
    orig_cl_ord_id: str,
    cl_ord_id: str,
    order_id: str,
    trader_group_id: str,
    symbol: str,
    side: str,
    ord_type: str,
    order_qty: int,
    price: float | None = None,
    stop_px: float | None = None,
    display_qty: int | None = None,
    display_method: str | None = None,
    min_qty: int | None = None,
    expire_time: str | None = None,
    expire_date: str | None = None,
    offset_bp: float | None = None,
    account: str | None = None,
    trader_id: str | None = None,
    passive_only_order: str | None = None,
    group_id: str | None = None,
) -> str:
    """
    Construit un message FIX Order Cancel/Replace Request (35=G) — section 6.4.4.

    Permet de modifier la quantité, le prix, la quantité affichée, le prix
    stop*, le MES, l'expiration, l'offset, le groupe et la référence client
    d'un ordre vivant (2.1.2.3). Tags principaux :
      41=OrigClOrdID  11=ClOrdID  37=OrderID
      48=SecurityID   22=SecurityIDSource   40=OrdType (doit correspondre à l'ordre)
      54=Side         38=OrderQty           44=Price
      99=StopPx*  1138=DisplayQty  1084=DisplayMethod  110=MinQty
      126=ExpireTime  432=ExpireDate  27018=Offset  1=Account  27017=GroupID
      27010=PassiveOnlyOrder

    *StopPx (99) est présent dans la table 6.4.4, mais 2.1.2.3 précise que
    "The Stop price of a Stop/Stop Limit order cannot be amended once the
    order has been injected into the order book" — ce builder transmet la
    valeur si fournie, mais fix_engine.process_replace l'ignore/rejette pour
    un ordre déjà dans le carnet (cf. commentaire associé).
    """
    fields: list[tuple[str, str]] = [
        ("41", orig_cl_ord_id),
        ("11", cl_ord_id),
        ("37", order_id),
        *_party_fields_management(trader_group_id, trader_id),
    ]
    if account is not None:
        fields.append(("1", account))
    fields += [
        ("48", symbol),
        ("22", SECURITY_ID_SOURCE_EXCHANGE_SYMBOL),
        ("40", ord_type),
        ("54", side),
        ("38", str(order_qty)),
        # DisplayQty (1138) obligatoire — cf. build_new_order().
        ("1138", str(display_qty if display_qty is not None else order_qty)),
        ("60", _timestamp()),
    ]
    if price is not None:
        fields.append(("44", f"{price:.4f}"))
    if stop_px is not None:
        fields.append(("99", f"{stop_px:.4f}"))
    if display_method is not None:
        fields.append(("1084", display_method))
    if min_qty is not None:
        fields.append(("110", str(min_qty)))
    if expire_time is not None:
        fields.append(("126", expire_time))
    elif expire_date is not None:
        fields.append(("432", expire_date))
    if offset_bp is not None:
        fields.append(("27018", f"{offset_bp:.4f}"))
    if passive_only_order is not None and passive_only_order != PASSIVE_ONLY_NONE:
        fields.append(("27010", passive_only_order))
    if group_id is not None:
        fields.append(("27017", group_id))
    return _build(MSG_REPLACE_REQ, fields, direction="out")


def build_mass_cancel_request(
    cl_ord_id: str,
    mass_cancel_request_type: str,
    trader_group_id: str,
    symbol: str | None = None,
    group_id: str | None = None,
) -> str:
    """
    Construit un message FIX Order Mass Cancel Request (35=q) — section 6.4.3.

    Le scope est toujours restreint au Trader Group (76) de l'appelant : cette
    plateforme retail n'a pas de notion de firme multi-comptes justifiant un
    mass cancel "Member ID". GroupID (27017) est requis si
    mass_cancel_request_type est For Group (56) ou For Instrument For Group (57).
    """
    fields: list[tuple[str, str]] = [
        ("11", cl_ord_id),
        ("530", mass_cancel_request_type),
    ]
    if group_id is not None:
        fields.append(("27017", group_id))
    if symbol:
        fields.append(("48", symbol))
        fields.append(("22", SECURITY_ID_SOURCE_EXCHANGE_SYMBOL))
    fields += [
        ("1461", "1"),
        ("1462", trader_group_id),
        ("1463", PARTY_ID_SOURCE_PROPRIETARY),
        ("1464", PARTY_ROLE_TRADER_GROUP),
        ("60", _timestamp()),
    ]
    return _build(MSG_MASS_CANCEL_REQ, fields, direction="out")


# ── Constructeurs de messages : marché → client ───────────────────────────────

def _generate_trade_match_id() -> str:
    """
    Génère un TradeMatchID (TVTIC) au format ASCII documenté en 2.12 (10
    octets, alphabet 0-9/A-Z) — pas une réplique de l'algorithme d'allocation
    LSE (partition/thread/compteur/timestamp), simplement un identifiant
    unique respectant le format attendu par le tag 880.
    """
    return uuid.uuid4().hex[:10].upper()


def build_exec_report(
    cl_ord_id: str,
    order_id: str,
    trader_group_id: str,
    exec_type: str,
    ord_status: str,
    symbol: str,
    side: str,
    ord_type: str,
    order_qty: int,
    leaves_qty: int,
    cum_qty: int,
    last_px: float = 0.0,
    last_qty: int = 0,
    price: float | None = None,
    text: str = "",
    stop_px: float | None = None,
    display_qty: int | None = None,
    display_method: str | None = None,
    min_qty: int | None = None,
    pre_trade_anonymity: str = PRE_TRADE_ANONYMITY_ANON,
    expire_time: str | None = None,
    expire_date: str | None = None,
    offset_bp: float | None = None,
    exec_restatement_reason: str | None = None,
    account: str | None = None,
    trader_id: str | None = None,
    passive_only_order: str | None = None,
    order_origination: str | None = None,
    group_id: str = "0",
    orig_cl_ord_id: str | None = None,
    ord_rej_reason: str | None = None,
) -> str:
    """
    Construit un FIX Execution Report (35=8) — section 6.4.5.

    Tags principaux :
      17=ExecID   11=ClOrdID   41=OrigClOrdID (cancel/replace, absent pour
      un cancel par Market Operations — non modélisé ici)
      37=OrderID  150=ExecType  378=ExecRestatementReason
      39=OrdStatus  103=OrdRejReason (si Rejected/Expired)
      453/448/447/452=PartyID
      48=SecurityID  22=SecurityIDSource
      54=Side     38=OrderQty    31=LastPx
      32=LastQty  14=CumQty      151=LeavesQty
      278=MDEntryID (Public Order ID)  27017=GroupID
      528=OrderCapacity  581=AccountType  58=Text
      99=StopPx  1138=DisplayQty (quantité actuellement affichée)
      1084=DisplayMethod  110=MinQty  1091=PreTradeAnonymity
      126=ExpireTime  432=ExpireDate  27018=Offset
      1=Account  1724=OrderOrigination  27010=PassiveOnlyOrder (écho)

    AvgPx (tag 6) n'existe PAS dans cette table — c'est un champ du Quote
    Execution Report (6.5.5, RFQ), hors périmètre ici ; il ne doit donc pas
    être émis pour un Execution Report d'ordre.
    """
    fields: list[tuple[str, str]] = [
        ("17", str(uuid.uuid4())),
        ("11", cl_ord_id),
    ]
    if orig_cl_ord_id is not None:
        fields.append(("41", orig_cl_ord_id))
    fields += [
        ("37", order_id),
        ("150", exec_type),
    ]
    if exec_restatement_reason is not None:
        fields.append(("378", exec_restatement_reason))
    fields.append(("39", ord_status))
    if ord_rej_reason is not None:
        fields.append(("103", ord_rej_reason))
    fields += [*_party_fields_order(trader_group_id, trader_id)]
    if account is not None:
        fields.append(("1", account))
    fields += [
        ("48", symbol),
        ("22", SECURITY_ID_SOURCE_EXCHANGE_SYMBOL),
        ("40", ord_type),
        ("54", side),
        ("38", str(order_qty)),
        ("32", str(last_qty)),
        ("31", f"{last_px:.4f}"),
        ("14", str(cum_qty)),
        ("151", str(leaves_qty)),
        ("581", ACCOUNT_TYPE_CLIENT),
        ("528", ORDER_CAPACITY_AOTC),
        ("60", _timestamp()),
        ("278", order_id),      # MDEntryID (Public Order ID) — obligatoire (Y)
        ("27017", group_id),    # GroupID — obligatoire (Y) ; "0" = ordre non groupé (défaut)
    ]
    if price is not None:
        fields.append(("44", f"{price:.4f}"))
    if stop_px is not None:
        fields.append(("99", f"{stop_px:.4f}"))
    if display_qty is not None:
        fields.append(("1138", str(display_qty)))
    if display_method is not None:
        fields.append(("1084", display_method))
    if min_qty is not None:
        fields.append(("110", str(min_qty)))
    if pre_trade_anonymity != PRE_TRADE_ANONYMITY_ANON:
        fields.append(("1091", pre_trade_anonymity))
    if expire_time is not None:
        fields.append(("126", expire_time))
    elif expire_date is not None:
        fields.append(("432", expire_date))
    if offset_bp is not None:
        fields.append(("27018", f"{offset_bp:.4f}"))
    if passive_only_order is not None and passive_only_order != PASSIVE_ONLY_NONE:
        fields.append(("27010", passive_only_order))
    if order_origination is not None:
        fields.append(("1724", order_origination))
    if exec_type == EXEC_TYPE_TRADE:
        # Tags conditionnels "si ExecType=Trade" (9730, 880, 30 — 851 est
        # l'équivalent numérique de 9730 pour les auctions/continu). Cette
        # plateforme ne notifie que le côté agresseur d'un match (limitation
        # architecturale connue, cf. discussion) : on documente donc
        # systématiquement la perspective "liquidité retirée".
        fields.append(("9730", "R"))               # TradeLiquidityIndicator
        fields.append(("851", "2"))                 # LastLiquidityInd = Removed
        fields.append(("880", _generate_trade_match_id()))  # TradeMatchID (TVTIC)
        fields.append(("30", "XLON"))                # LastMkt — placeholder (simulation mono-venue)
    if text:
        fields.append(("58", text))
    return _build(MSG_EXEC_REPORT, fields, direction="in")


def build_cancel_reject(
    cl_ord_id: str,
    orig_cl_ord_id: str,
    order_id: str,
    response_to: str,
    reason_code: str,
    reason_text: str,
) -> str:
    """
    Construit un FIX Order Cancel Reject (35=9) — section 6.4.6.

    Tags principaux :
      37=OrderID   11=ClOrdID   41=OrigClOrdID   39=OrdStatus (toujours
      Rejected, même si le statut réel de l'ordre diffère — comportement
      documenté en 2.10.3)
      434=CxlRejResponseTo (1=Cancel Request, 2=Cancel/Replace Request)
      102=CxlRejReason     58=Text

    TransactTime (60) n'existe PAS dans ce tableau de champs — contrairement
    aux autres messages applicatifs, il n'est volontairement pas émis ici.
    """
    return _build(MSG_CANCEL_REJECT, [
        ("11", cl_ord_id),
        ("41", orig_cl_ord_id),
        ("37", order_id),
        ("39", STATUS_REJECTED),
        ("434", response_to),
        ("102", reason_code),
        ("58", reason_text),
    ], direction="in")


def build_mass_cancel_report(
    mass_action_report_id: str,
    cl_ord_id: str,
    mass_cancel_request_type: str,
    mass_cancel_response: str,
    reject_reason: str | None = None,
    group_id: str | None = None,
    total_affected_orders: int | None = None,
) -> str:
    """
    Construit un FIX Order Mass Cancel Report (35=r) — section 6.4.7.

    Tags principaux :
      1369=MassActionReportID  11=ClOrdID  530=MassCancelRequestType
      531=MassCancelResponse   532=MassCancelRejectReason (si rejeté)
      27017=GroupID (écho de la requête)
      1180=ApplId (partition de matching — obligatoire)
      533=TotalAffectedOrders (peut être absent — cf. limitation 2.10.11 ;
      ici toujours connu puisque ce report est émis APRÈS le traitement
      complet du mass cancel, pas avant comme sur le vrai gateway)
    """
    fields: list[tuple[str, str]] = [
        ("1369", mass_action_report_id),
        ("11", cl_ord_id),
        ("530", mass_cancel_request_type),
        ("531", mass_cancel_response),
    ]
    if reject_reason is not None:
        fields.append(("532", reject_reason))
    if group_id is not None:
        fields.append(("27017", group_id))
    # ApplId (1180) est obligatoire (Y) : identifie la partition de matching
    # concernée. Ce moteur simulé n'a qu'une seule partition ("1").
    fields.append(("1180", "1"))
    if total_affected_orders is not None:
        fields.append(("533", str(total_affected_orders)))
    return _build(MSG_MASS_CANCEL_REPORT, fields, direction="in")


def build_session_reject(
    ref_seq_num: str,
    ref_msg_type: str | None = None,
    ref_tag_id: str | None = None,
    reason_code: str | None = None,
    text: str = "",
) -> str:
    """
    Construit un FIX Reject (35=3, niveau session) — section 6.3.6.

    Documenté en 2.9 : "A session reject message will be sent by the server
    if a required tag or a conditionally required tag is missing in a
    message sent by a client." Dans notre architecture, cette validation de
    forme est faite par Pydantic AVANT toute construction de message FIX
    (HTTP 422) — ce builder existe pour compléter la table de messages
    documentée dans FIX_PROTOCOL.md, sans point d'appel actif actuellement.
    """
    fields: list[tuple[str, str]] = [("45", ref_seq_num)]
    if ref_msg_type is not None:
        fields.append(("372", ref_msg_type))
    if ref_tag_id is not None:
        fields.append(("371", ref_tag_id))
    if reason_code is not None:
        fields.append(("373", reason_code))
    if text:
        fields.append(("58", text))
    return _build(MSG_SESSION_REJECT, fields, direction="in")


def build_business_reject(
    ref_seq_num: str,
    ref_msg_type: str,
    reason_code: str,
    text: str,
) -> str:
    """
    Construit un FIX Business Message Reject (35=j) — section 6.6.1.

    Utilisé quand le moteur reçoit un message applicatif structurellement
    valide (Pydantic l'a laissé passer) mais qu'il ne sait pas traiter — ex :
    un MassCancelRequestType non supporté.
    """
    return _build(MSG_BUSINESS_REJECT, [
        ("45", ref_seq_num),
        ("372", ref_msg_type),
        ("380", reason_code),
        ("58", text),
    ], direction="in")
