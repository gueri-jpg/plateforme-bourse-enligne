"""
Moteur de matching FIX simulé — protocole LSE FIX 5.0/FIXT.1.1 (MIT202), heures BVC Casablanca.

Simule le comportement du London Stock Exchange (LSE) Millennium Exchange :
  - Carnet d'ordres en mémoire par instrument (bids / asks)
  - Matching par priorité prix-temps (price-time priority)
  - Phases de marché adaptées à la BVC (Casablanca, Africa/Casablanca)
  - Sémantiques IOC, FOK, Stop/Stop Limit, Iceberg/Hidden, Pegged, Offset
  - Retourne des FIX Execution Reports (35=8) pour chaque changement d'état

Phases BVC :
  PRE_OPEN   : 08h30 – 09h00  (ordres acceptés, pas de matching)
  CONTINUOUS : 09h00 – 15h30  (matching en continu)
  CLOSED     : hors horaires  (ordres au marché rejetés)

Simplifications assumées (documentées ici et dans FIX_PROTOCOL.md), retenues
pour rester fidèles au style déjà en place dans ce moteur (pas de scheduler,
pas d'état de transition de phase persistant, pas d'algorithme d'uncrossing
multilatéral) :
  - OPG/ATC/GFA/GFX/GFS ne déclenchent aucune mécanique de carnet dédiée : ils
    suivent le chemin déjà codé pour PRE_OPEN (parking sans distinction de
    TIF) puis le matching réactif standard en séance continue. GFX et GFS
    convergent vers le même traitement que GFA (pas d'enchère EDSP ni de
    calendrier d'enchères programmées modélisés par cette plateforme BVC).
  - Le Dynamic Reference Price (DRP) des ordres Offset est approximé par le
    dernier prix négocié disponible (pas de vrai calcul d'auction).
  - CPX (Closing Price Crossing) est mis en file d'attente par symbole et
    dénoué au prix de clôture dès que celui-ci est connu, via le même sweep
    paresseux que l'expiration DAY/GTD/GTT.
"""
import random
import uuid
import logging
from dataclasses import dataclass, field
from datetime import datetime, date, timezone
from zoneinfo import ZoneInfo

from app.services.fix_messages import (
    parse,
    parse_party_ids,
    build_exec_report,
    build_cancel_reject,
    build_mass_cancel_report,
    ORD_TYPE_MARKET, ORD_TYPE_LIMIT, ORD_TYPE_STOP, ORD_TYPE_STOP_LIMIT,
    ORD_TYPE_PEGGED, ORD_TYPE_OFFSET,
    SIDE_BUY, SIDE_SELL,
    TIF_DAY, TIF_IOC, TIF_FOK, TIF_GTD,
    DISPLAY_METHOD_RANDOM, DISPLAY_METHOD_HIDDEN,
    STATUS_NEW, STATUS_PARTIAL_FILL, STATUS_FILLED,
    STATUS_CANCELED, STATUS_REJECTED, STATUS_SUSPENDED, STATUS_EXPIRED,
    EXEC_TYPE_NEW, EXEC_TYPE_TRADE, EXEC_TYPE_REPLACED,
    EXEC_TYPE_CANCELED, EXEC_TYPE_REJECTED, EXEC_TYPE_SUSPENDED, EXEC_TYPE_EXPIRED,
    EXEC_TYPE_RESTATED, EXEC_RESTATEMENT_REASON_REPLENISHMENT,
    PARTY_ROLE_TRADER_GROUP,
    CXL_REJ_RESPONSE_TO_CANCEL, CXL_REJ_RESPONSE_TO_REPLACE,
    CXL_REJ_REASON_TOO_LATE, CXL_REJ_REASON_UNKNOWN_ORDER, CXL_REJ_REASON_OTHER,
    MASS_CANCEL_ALL_ORDERS, MASS_CANCEL_FOR_INSTRUMENT, MASS_CANCEL_RESPONSE_REJECTED,
    MASS_CANCEL_FOR_GROUP, MASS_CANCEL_FOR_INSTRUMENT_GROUP,
    PASSIVE_ONLY_NONE, PASSIVE_ONLY_NO_VISIBLE_MATCH, PASSIVE_ONLY_NEW_VISIBLE_BBO,
    PASSIVE_ONLY_AT_OR_JOIN_BBO, PASSIVE_ONLY_WITHIN_ONE_TICK, PASSIVE_ONLY_WITHIN_TWO_TICKS,
    ORD_REJ_REASON_OTHER,
)

# Valeurs de PassiveOnlyOrder (27010) qui, combinées à un ordre entièrement
# caché (DisplayMethod=Hidden), doivent être rejetées d'emblée (2.4.1/6.4.1 :
# "Any fully hidden order will be rejected if it has enum 100, 1, 2 or 3").
# 99 (no visible match) reste valide sur un ordre Hidden (6.4.4 : "A hidden
# order must be set to a value of either 0 or 99").
_PASSIVE_ONLY_FORBIDDEN_ON_HIDDEN = {
    PASSIVE_ONLY_NEW_VISIBLE_BBO, PASSIVE_ONLY_AT_OR_JOIN_BBO,
    PASSIVE_ONLY_WITHIN_ONE_TICK, PASSIVE_ONLY_WITHIN_TWO_TICKS,
}

# Valeurs de PassiveOnlyOrder (27010) qui interdisent à l'ordre de "prendre"
# (agresser) de la liquidité visible au repos — seule la contrainte
# d'exclusion de croisement est modélisée pour 100/1/2/3 : ce moteur simulé
# n'a pas de table de pas de cotation (tick size) permettant de distinguer
# "au BBO", "à 1 palier visible" et "à 2 paliers visibles" ; ces trois
# nuances sont donc traitées de façon identique (documenté ici et dans
# FIX_PROTOCOL.md comme simplification assumée).
_PASSIVE_ONLY_REJECT_ON_CROSS = {
    PASSIVE_ONLY_NO_VISIBLE_MATCH, PASSIVE_ONLY_NEW_VISIBLE_BBO,
    PASSIVE_ONLY_AT_OR_JOIN_BBO, PASSIVE_ONLY_WITHIN_ONE_TICK, PASSIVE_ONLY_WITHIN_TWO_TICKS,
}

log = logging.getLogger(__name__)

_CASABLANCA = ZoneInfo("Africa/Casablanca")


# ── Phases de marché ──────────────────────────────────────────────────────────

class MarketPhase:
    PRE_OPEN   = "pre_open"    # Pré-ouverture  : 08h30 – 09h00
    CONTINUOUS = "continuous"  # Séance continue : 09h00 – 15h30
    CLOSED     = "closed"      # Marché fermé


def get_market_phase() -> str:
    """Retourne la phase de marché BVC courante (heure de Casablanca)."""
    now = datetime.now(tz=_CASABLANCA)
    if now.weekday() >= 5:           # Samedi / Dimanche
        return MarketPhase.CLOSED
    mins = now.hour * 60 + now.minute
    if 510 <= mins < 540:            # 08h30 – 09h00
        return MarketPhase.PRE_OPEN
    if 540 <= mins < 930:            # 09h00 – 15h30
        return MarketPhase.CONTINUOUS
    return MarketPhase.CLOSED


# ── Ordre dans le carnet ──────────────────────────────────────────────────────

@dataclass
class BookOrder:
    order_id:   str
    cl_ord_id:  str
    owner_id:   str     # Trader Group (452=76) — compte_id du propriétaire, pour Mass Cancel
    side:       str
    ord_type:   str
    quantity:   int
    price:      float     # Prix limite (0.0 pour les ordres au marché / non encore fixé)
    tif:        str
    timestamp:  datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    filled_qty: int = 0

    # Stop / Stop Limit (99=StopPx) — triggered=False tant que le stop n'est
    # pas déclenché par un prix négocié franchissant stop_px.
    stop_px:    float | None = None
    triggered:  bool = True

    # Iceberg / Hidden (1138=DisplayQty, 1084=DisplayMethod)
    display_qty:    int | None = None
    display_method: str | None = None   # None (fixed peak) | "random" | "hidden"
    clip_remaining: int | None = None   # quantité restante du clip actuellement affiché

    # Pegged (110=MinQty / MES)
    min_qty: int | None = None

    # GTD / GTT (126=ExpireTime, 432=ExpireDate)
    expire_time: datetime | None = None
    expire_date: date | None = None

    # Offset (27018)
    offset_bp: float | None = None
    # Vrai si le tag 44 (Price) était présent sur le New Order d'origine — la
    # règle 6.4.4 exige que le Cancel/Replace d'un ordre Offset préserve cette
    # présence/absence à l'identique (pas de bascule via un amendement).
    price_was_set: bool = False

    # GroupID (27017) — bucket client-assignable (1-255) pour le Mass Cancel
    # ciblé "For Group"/"For Instrument For Group" (530=56/57) ; "0" = non groupé.
    group_id: str = "0"

    # Account (1) — référence client échoée telle quelle sur les rapports
    # d'exécution ultérieurs de cet ordre (expiration, déclenchement Stop...).
    account: str | None = None

    def __post_init__(self) -> None:
        if self.display_qty is not None and self.clip_remaining is None:
            self.clip_remaining = min(self.display_qty, self.leaves_qty) if self.leaves_qty > 0 else self.display_qty

    @property
    def leaves_qty(self) -> int:
        return self.quantity - self.filled_qty


# Carnet d'ordres en mémoire : symbole → {"bids": [...], "asks": [...]}
_ORDER_BOOK: dict[str, dict[str, list[BookOrder]]] = {}

# Dernier prix négocié par symbole — sert d'approximation du Dynamic
# Reference Price (ordres Offset) et de prix de clôture (CPX).
_LAST_TRADE_PX: dict[str, float] = {}

# File d'attente des ordres CPX (Closing Price Crossing) par symbole,
# dénouée au prix de clôture dès que celui-ci est connu (sweep paresseux).
_CPX_QUEUE: dict[str, list[BookOrder]] = {}


def _get_book(symbol: str) -> dict[str, list[BookOrder]]:
    if symbol not in _ORDER_BOOK:
        _ORDER_BOOK[symbol] = {"bids": [], "asks": []}
    return _ORDER_BOOK[symbol]


def _sort_book(book: dict[str, list[BookOrder]]) -> None:
    """Trie le carnet par priorité prix-temps (LSE Millennium Exchange)."""
    # Bids : meilleur prix en premier (décroissant), puis plus ancien en premier
    book["bids"].sort(key=lambda o: (-o.price, o.timestamp))
    # Asks : meilleur prix en premier (croissant), puis plus ancien en premier
    book["asks"].sort(key=lambda o: (o.price, o.timestamp))


def _log_fix(fix_msg: str) -> None:
    """Journalise un message FIX généré par un événement de fond (expiration,
    déclenchement Stop, croisement CPX) — même convention que le router pour
    que ces messages restent visibles via `docker logs`/demo_fix_flow.py."""
    log.info("[FIX IN]  %s", fix_msg.replace("\x01", "|"))


def get_order_book_snapshot(symbol: str) -> dict:
    """
    Retourne un instantané lisible du carnet d'ordres.

    Les ordres Hidden (display_method="hidden") n'apparaissent jamais dans le
    snapshot (mais participent quand même au matching). Les ordres Iceberg
    affichent leur clip courant (clip_remaining), pas leur leaves_qty total.
    Un ordre Stop/Stop Limit pas encore déclenché n'est pas affiché (il n'est
    pas encore un ordre de marché visible).
    """
    book = _get_book(symbol)
    _sort_book(book)
    phase = get_market_phase()
    now = datetime.now(timezone.utc)

    def visible(orders: list[BookOrder]) -> list[dict]:
        out = []
        for o in orders:
            if o.display_method == DISPLAY_METHOD_HIDDEN:
                continue
            if not o.triggered:
                continue
            if _est_expire(o, phase, now):
                continue
            qty = o.clip_remaining if o.clip_remaining is not None else o.leaves_qty
            out.append({"prix": o.price, "quantite": qty, "ordre_id": o.order_id})
        return out

    return {
        "symbol": symbol,
        "phase":  phase,
        "bids": visible(book["bids"]),
        "asks": visible(book["asks"]),
    }


# ── Utilitaires partagés ──────────────────────────────────────────────────────

def _record_trade(symbol: str, price: float) -> None:
    if price > 0:
        _LAST_TRADE_PX[symbol] = price


def _est_expire(o: BookOrder, phase: str, now: datetime) -> bool:
    """Prédicat pur (pas d'effet de bord) — un ordre GTD/GTT expiré, ou un
    ordre DAY encore en carnet après la clôture (2.1.1 : "An order that will
    expire at the end of the day")."""
    if o.expire_time is not None and now >= o.expire_time:
        return True
    if o.expire_date is not None and now.date() > o.expire_date:
        return True
    if o.tif == TIF_DAY and phase == MarketPhase.CLOSED:
        return True
    return False


def _expirer_ordres(symbol: str) -> list[dict]:
    """
    Purge le carnet des ordres GTD/GTT expirés et des ordres DAY restants en
    clôture — sweep paresseux, fonction pure de l'heure courante (même
    principe que get_market_phase()), pas d'état de transition à persister.

    Retourne une liste d'"événements annexes" ({order_id, symbol, statut}) à
    répercuter en DB par l'appelant (ces ordres ne sont pas ceux de la requête
    en cours) et journalise un Execution Report (ExecType=Expired) pour
    chacun.
    """
    book = _get_book(symbol)
    now = datetime.now(timezone.utc)
    phase = get_market_phase()
    annexes: list[dict] = []
    for side_key in ("bids", "asks"):
        side = SIDE_BUY if side_key == "bids" else SIDE_SELL
        keep = []
        for o in book[side_key]:
            if _est_expire(o, phase, now):
                report = build_exec_report(
                    cl_ord_id=o.cl_ord_id, order_id=o.order_id, trader_group_id=o.owner_id,
                    exec_type=EXEC_TYPE_EXPIRED, ord_status=STATUS_EXPIRED,
                    symbol=symbol, side=side, ord_type=o.ord_type,
                    order_qty=o.quantity, leaves_qty=0, cum_qty=o.filled_qty,
                    text="Ordre expiré (GTD/GTT ou fin de séance DAY)",
                )
                _log_fix(report)
                annexes.append({"order_id": o.order_id, "symbol": symbol, "statut": "expire"})
            else:
                keep.append(o)
        book[side_key] = keep
    annexes += _resoudre_cpx(symbol)
    return annexes


def _resoudre_cpx(symbol: str) -> list[dict]:
    """
    Dénoue la file CPX (Closing Price Crossing) d'un symbole dès que le
    marché est fermé et qu'un prix de clôture est connu : croise entre eux,
    au prix de clôture, les ordres achat/vente en attente (priorité
    temps simple, tous exécutés au même prix — pas de carnet visible).
    """
    queue = _CPX_QUEUE.get(symbol) or []
    if not queue or get_market_phase() != MarketPhase.CLOSED:
        return []
    close_px = _LAST_TRADE_PX.get(symbol)
    if not close_px:
        return []

    bids = sorted([o for o in queue if o.side == SIDE_BUY], key=lambda o: o.timestamp)
    asks = sorted([o for o in queue if o.side == SIDE_SELL], key=lambda o: o.timestamp)
    annexes: list[dict] = []

    i = j = 0
    while i < len(bids) and j < len(asks):
        b, a = bids[i], asks[j]
        fill_qty = min(b.leaves_qty, a.leaves_qty)
        if fill_qty > 0:
            b.filled_qty += fill_qty
            a.filled_qty += fill_qty
            for o, side in ((b, SIDE_BUY), (a, SIDE_SELL)):
                statut = "execute" if o.leaves_qty == 0 else "partiellement_execute"
                report = build_exec_report(
                    cl_ord_id=o.cl_ord_id, order_id=o.order_id, trader_group_id=o.owner_id,
                    exec_type=EXEC_TYPE_TRADE,
                    ord_status=STATUS_FILLED if o.leaves_qty == 0 else STATUS_PARTIAL_FILL,
                    symbol=symbol, side=side, ord_type=o.ord_type,
                    order_qty=o.quantity, leaves_qty=o.leaves_qty, cum_qty=o.filled_qty,
                    last_px=close_px, last_qty=fill_qty,
                    text="Croisé via CPX (Closing Price Crossing) au prix de clôture",
                )
                _log_fix(report)
                annexes.append({
                    "order_id": o.order_id, "symbol": symbol, "statut": statut,
                    "prix_execution": close_px, "quantite_executee": fill_qty,
                })
        if b.leaves_qty == 0:
            i += 1
        if a.leaves_qty == 0:
            j += 1

    remaining = [o for o in bids[i:] if o.leaves_qty > 0] + [o for o in asks[j:] if o.leaves_qty > 0]
    for o in remaining:
        annexes.append({"order_id": o.order_id, "symbol": symbol, "statut": "annule"})
        report = build_exec_report(
            cl_ord_id=o.cl_ord_id, order_id=o.order_id, trader_group_id=o.owner_id,
            exec_type=EXEC_TYPE_CANCELED, ord_status=STATUS_CANCELED,
            symbol=symbol, side=o.side, ord_type=o.ord_type,
            order_qty=o.quantity, leaves_qty=0, cum_qty=o.filled_qty,
            text="CPX non apparié — aucune contrepartie disponible au prix de clôture",
        )
        _log_fix(report)

    _CPX_QUEUE[symbol] = []
    return annexes


def _display_state(display_qty: int | None, display_method: str | None, quantity: int) -> str:
    """
    Classe l'état de visibilité d'un ordre — utilisé pour valider les
    transitions autorisées lors d'un Cancel/Replace (2.1.2.3/2.10.15/2.10.16) :
      "hidden"        : DisplayMethod=Hidden (4)
      "iceberg_random": DisplayMethod=Random Replenished (3)
      "iceberg_fixed" : DisplayQty < OrderQty, sans DisplayMethod (Fixed Peak)
      "visible"       : entièrement affiché
    """
    if display_method == DISPLAY_METHOD_HIDDEN:
        return "hidden"
    if display_method == DISPLAY_METHOD_RANDOM:
        return "iceberg_random"
    if display_qty is not None and display_qty < quantity:
        return "iceberg_fixed"
    return "visible"


def _replenish_if_needed(o: BookOrder, symbol: str) -> None:
    """Réapprovisionne le clip visible d'un ordre Iceberg quand il est épuisé
    (Fixed Peak : toujours display_qty ; Random Replenished : taille tirée
    aléatoirement entre 50% et 100% de display_qty) — nouveau timestamp, donc
    perte de priorité temps (2.1.4, réapprovisionnement).

    Émet et journalise un Execution Report ExecType=Restated(D)/
    ExecRestatementReason(378)=100 (6.4.5) — ce réapprovisionnement ne modifie
    pas le statut persisté de l'ordre (clip_remaining n'est pas une colonne
    DB), donc pas d'événement annexe à répercuter, uniquement la trace FIX."""
    if o.display_qty is None or o.leaves_qty <= 0:
        return
    if o.clip_remaining is not None and o.clip_remaining > 0:
        return
    if o.display_method == DISPLAY_METHOD_RANDOM:
        low = max(1, int(o.display_qty * 0.5))
        clip = random.randint(low, o.display_qty)
    else:
        clip = o.display_qty
    o.clip_remaining = min(clip, o.leaves_qty)
    o.timestamp = datetime.now(timezone.utc)
    report = build_exec_report(
        cl_ord_id=o.cl_ord_id, order_id=o.order_id, trader_group_id=o.owner_id,
        exec_type=EXEC_TYPE_RESTATED, exec_restatement_reason=EXEC_RESTATEMENT_REASON_REPLENISHMENT,
        ord_status=STATUS_PARTIAL_FILL if o.filled_qty > 0 else STATUS_NEW,
        symbol=symbol, side=o.side, ord_type=o.ord_type,
        order_qty=o.quantity, leaves_qty=o.leaves_qty, cum_qty=o.filled_qty,
        display_qty=o.clip_remaining, display_method=o.display_method,
        account=o.account, group_id=o.group_id,
        text="Réapprovisionnement du clip Iceberg (perte de priorité temps, 2.1.4)",
    )
    _log_fix(report)


def _reprice_pegged(book: dict[str, list[BookOrder]]) -> None:
    """Recalcule le prix de tous les ordres Pegged du carnet au midpoint du
    BBO courant, avant toute passe de matching (2.1.1 : ordre pegged au
    midpoint de la meilleure limite achat/vente)."""
    bids, asks = book["bids"], book["asks"]
    if not bids or not asks:
        return
    mid = round((bids[0].price + asks[0].price) / 2, 4)
    for side_orders in (bids, asks):
        for o in side_orders:
            if o.ord_type == ORD_TYPE_PEGGED:
                o.price = mid


def _offset_price(drp: float, side: str, offset_bp: float) -> float:
    """
    Prix d'un ordre Offset (OrdType=F) — formule 2.1.1.2 : le prix est calculé
    à partir du Dynamic Reference Price (DRP) et d'un décalage en points de
    base (27018), avec un signe qui dépend du sens ET du signe de l'offset :
      BUY  + offset positif → DRP + DRP×offset   BUY  + offset négatif → DRP - DRP×|offset|
      SELL + offset positif → DRP - DRP×offset   SELL + offset négatif → DRP + DRP×|offset|
    """
    magnitude = abs(offset_bp) / 10000
    adjustment = drp * magnitude
    if side == SIDE_BUY:
        return round(drp + adjustment if offset_bp >= 0 else drp - adjustment, 4)
    return round(drp - adjustment if offset_bp >= 0 else drp + adjustment, 4)


def _match(existing: BookOrder, book: dict[str, list[BookOrder]], side: str, symbol: str) -> list[tuple[float, int]]:
    """
    Boucle de matching prix-temps partagée par New Order, Cancel/Replace et
    le déclenchement de Stop — modifie existing.filled_qty et les ordres
    resting en place, réapprovisionne les icebergs touchés, retourne la liste
    (prix, quantité) des exécutions réalisées lors de cet appel.

    Un ordre resting non déclenché (Stop/Stop Limit en attente) n'est jamais
    contrepartie : il est ignoré, pas retiré du carnet.
    """
    opposite = book["asks"] if side == SIDE_BUY else book["bids"]

    def crosses(resting: BookOrder) -> bool:
        if existing.ord_type == ORD_TYPE_MARKET:
            return True
        return existing.price >= resting.price if side == SIDE_BUY else existing.price <= resting.price

    executions: list[tuple[float, int]] = []
    i = 0
    while i < len(opposite) and existing.leaves_qty > 0:
        resting = opposite[i]
        if not resting.triggered:
            i += 1
            continue
        if not crosses(resting):
            break
        fill_qty = min(existing.leaves_qty, resting.leaves_qty)
        # MES (MinQty, 110) : s'applique côté Pegged agresseur ET côté Pegged
        # au repos — un fill sous le seuil est refusé à CE niveau de prix,
        # mais n'empêche pas de tenter le niveau suivant du carnet.
        if existing.ord_type == ORD_TYPE_PEGGED and existing.min_qty and fill_qty < existing.min_qty:
            i += 1
            continue
        if resting.ord_type == ORD_TYPE_PEGGED and resting.min_qty and fill_qty < resting.min_qty:
            i += 1
            continue
        fill_price = resting.price if resting.price > 0 else existing.price
        existing.filled_qty += fill_qty
        resting.filled_qty += fill_qty
        if resting.clip_remaining is not None:
            resting.clip_remaining = max(0, resting.clip_remaining - fill_qty)
        executions.append((fill_price, fill_qty))
        if resting.leaves_qty == 0:
            opposite.pop(i)
        else:
            _replenish_if_needed(resting, symbol)
            i += 1
    return executions


def _trigger_stops(symbol: str) -> list[dict]:
    """
    Vérifie si le dernier prix négocié déclenche des ordres Stop/Stop Limit
    non encore déclenchés du carnet (2.1.1) ; les convertit en ordre Market
    (Stop) ou Limit (Stop Limit) et les repasse dans la boucle de matching
    partagée. Retourne les "événements annexes" à répercuter en DB, journalise
    les Execution Reports générés.
    """
    last_px = _LAST_TRADE_PX.get(symbol)
    if last_px is None:
        return []
    book = _get_book(symbol)
    annexes: list[dict] = []

    for side_key in ("bids", "asks"):
        side = SIDE_BUY if side_key == "bids" else SIDE_SELL
        candidates = [
            o for o in book[side_key]
            if not o.triggered and o.ord_type in (ORD_TYPE_STOP, ORD_TYPE_STOP_LIMIT)
            and o.stop_px is not None
            and ((last_px >= o.stop_px) if side == SIDE_BUY else (last_px <= o.stop_px))
        ]
        for o in candidates:
            book[side_key] = [x for x in book[side_key] if x.order_id != o.order_id]
            o.triggered = True
            o.ord_type = ORD_TYPE_MARKET if o.ord_type == ORD_TYPE_STOP else ORD_TYPE_LIMIT
            o.timestamp = datetime.now(timezone.utc)

            executions = _match(o, book, side, symbol)
            if o.leaves_qty > 0 and o.ord_type == ORD_TYPE_MARKET:
                # Un ordre Stop (simple) devenu Market ne reste jamais en
                # carnet sans contrepartie — même simulation "market maker"
                # que pour un ordre Market neuf (process_new_order).
                mm_qty = o.leaves_qty
                o.filled_qty += mm_qty
                executions.append((last_px, mm_qty))
            if o.leaves_qty > 0:
                book[side_key].append(o)
                _sort_book(book)

            cum_qty, leaves_qty = o.filled_qty, o.leaves_qty
            if executions:
                last_fill_px, last_fill_qty = executions[-1]
                avg_px = sum(p * q for p, q in executions) / sum(q for _, q in executions)
                _record_trade(symbol, last_fill_px)
                statut = "execute" if leaves_qty == 0 else "partiellement_execute"
                report = build_exec_report(
                    cl_ord_id=o.cl_ord_id, order_id=o.order_id, trader_group_id=o.owner_id,
                    exec_type=EXEC_TYPE_TRADE,
                    ord_status=STATUS_FILLED if leaves_qty == 0 else STATUS_PARTIAL_FILL,
                    symbol=symbol, side=side, ord_type=o.ord_type,
                    order_qty=o.quantity, leaves_qty=leaves_qty, cum_qty=cum_qty,
                    last_px=last_fill_px, last_qty=last_fill_qty,
                    price=o.price if o.price else None,
                    text="Ordre Stop déclenché et exécuté",
                )
                _log_fix(report)
                annexes.append({
                    "order_id": o.order_id, "symbol": symbol, "statut": statut,
                    "prix_execution": round(avg_px, 2), "quantite_executee": last_fill_qty,
                })
            else:
                report = build_exec_report(
                    cl_ord_id=o.cl_ord_id, order_id=o.order_id, trader_group_id=o.owner_id,
                    exec_type=EXEC_TYPE_REPLACED, ord_status=STATUS_NEW,
                    symbol=symbol, side=side, ord_type=o.ord_type,
                    order_qty=o.quantity, leaves_qty=leaves_qty, cum_qty=cum_qty,
                    price=o.price if o.price else None,
                    text="Ordre Stop déclenché — actif dans le carnet",
                )
                _log_fix(report)
                annexes.append({"order_id": o.order_id, "symbol": symbol, "statut": "en_attente"})
    return annexes


# ── Moteur de matching ────────────────────────────────────────────────────────

def process_new_order(fix_msg: str) -> tuple[str, dict]:
    """
    Traite un FIX New Order Single (35=D).

    Retourne (exec_report_fix, result_dict) où result_dict contient :
      - statut          : "execute" | "partiellement_execute" | "en_attente" | "annule" | "rejete"
      - prix_execution  : float | None
      - quantite_executee : int | None
      - raison          : str (en cas de rejet/annulation)
      - evenements_annexes : list[dict] — expirations/déclenchements Stop
        d'AUTRES ordres constatés en traitant cette requête, à répercuter en DB

    Algorithme de matching LSE (price-time priority) :
      1. Ordres au marché  → match immédiat au meilleur prix disponible
         Si pas de contrepartie → exécuté au prix fourni (simulation market maker)
      2. Ordres limite     → match si le prix croise le carnet, sinon repos dans le carnet
      3. IOC               → remplit ce qui est disponible, annule le reste
      4. FOK               → remplit entièrement ou annule tout
      5. Stop/Stop Limit   → parqué jusqu'à franchissement de StopPx (99)
      6. Iceberg/Hidden    → DisplayQty (1138)/DisplayMethod (1084) limitent la visibilité
      7. Pegged            → prix recalculé au midpoint du BBO, MES via MinQty (110)
      8. Offset            → prix = DRP ± DRP×Offset (27018), DRP approximé par le dernier prix négocié
    """
    tags            = parse(fix_msg)
    party           = parse_party_ids(fix_msg)
    trader_group_id = party.get(PARTY_ROLE_TRADER_GROUP, "")
    cl_ord_id = tags.get("11", str(uuid.uuid4()))
    symbol    = tags.get("48", "")
    side      = tags.get("54", SIDE_BUY)
    ord_type  = tags.get("40", ORD_TYPE_LIMIT)
    order_qty = int(tags.get("38", 0))
    price     = float(tags.get("44", 0)) if "44" in tags else 0.0
    tif       = tags.get("59", "0")
    market_px = float(tags.get("99", 0)) if ord_type != ORD_TYPE_STOP and ord_type != ORD_TYPE_STOP_LIMIT and "99" in tags else price
    stop_px       = float(tags["99"]) if "99" in tags and ord_type in (ORD_TYPE_STOP, ORD_TYPE_STOP_LIMIT) else None
    display_qty   = int(tags["1138"]) if "1138" in tags else None
    display_method = tags.get("1084")
    min_qty       = int(tags["110"]) if "110" in tags else None
    expire_time   = datetime.strptime(tags["126"], "%Y%m%d-%H:%M:%S.%f").replace(tzinfo=timezone.utc) if "126" in tags else None
    expire_date   = datetime.strptime(tags["432"], "%Y%m%d").date() if "432" in tags else None
    offset_bp     = float(tags["27018"]) if "27018" in tags else None
    is_cpx        = tags.get("336") == "a"
    account       = tags.get("1")
    group_id      = tags.get("27017", "0")
    passive_only_order = tags.get("27010")
    price_was_set = "44" in tags

    # Pour permettre la correspondance avec l'ID DB lors des annulations,
    # on utilise le cl_ord_id comme order_id dans le carnet.
    order_id = cl_ord_id
    phase    = get_market_phase()

    annexes = _expirer_ordres(symbol) + _trigger_stops(symbol)

    # ── MinQty (110) : MES réservé aux ordres Pegged DAY/GTT (pas IOC/FOK) ────
    # (6.4.1 : "If this tag is specified on a non-pegged order the message
    # will be rejected." / "It is not applicable to pegged IOC/FOK orders.")
    if min_qty is not None and (ord_type != ORD_TYPE_PEGGED or tif in (TIF_IOC, TIF_FOK)):
        report = build_exec_report(
            cl_ord_id=cl_ord_id, order_id=order_id, trader_group_id=trader_group_id,
            exec_type=EXEC_TYPE_REJECTED, ord_status=STATUS_REJECTED,
            symbol=symbol, side=side, ord_type=ord_type,
            order_qty=order_qty, leaves_qty=0, cum_qty=0,
            ord_rej_reason=ORD_REJ_REASON_OTHER,
            text="MinQty (110) réservé aux ordres Pegged DAY/GTT (6.4.1)",
        )
        return report, {
            "statut": "rejete",
            "raison": "MinQty n'est applicable qu'aux ordres Pegged en DAY/GTT (pas IOC/FOK, pas sur un ordre non-pegged).",
            "evenements_annexes": annexes,
        }

    # ── PassiveOnlyOrder + ordre entièrement caché : combinaison rejetée ──────
    # (6.4.1 : "Any fully hidden order will be rejected if it has enum
    # 100, 1, 2 or 3." — 99 reste valide sur un ordre Hidden.)
    if display_method == DISPLAY_METHOD_HIDDEN and passive_only_order in _PASSIVE_ONLY_FORBIDDEN_ON_HIDDEN:
        report = build_exec_report(
            cl_ord_id=cl_ord_id, order_id=order_id, trader_group_id=trader_group_id,
            exec_type=EXEC_TYPE_REJECTED, ord_status=STATUS_REJECTED,
            symbol=symbol, side=side, ord_type=ord_type,
            order_qty=order_qty, leaves_qty=0, cum_qty=0,
            ord_rej_reason=ORD_REJ_REASON_OTHER,
            text="PassiveOnlyOrder (27010) incompatible avec un ordre entièrement caché (6.4.1)",
        )
        return report, {
            "statut": "rejete",
            "raison": "Un ordre entièrement caché ne peut pas utiliser PassiveOnlyOrder=100/1/2/3.",
            "evenements_annexes": annexes,
        }

    # ── Rejection : ordre au marché hors séance ───────────────────────────────
    if phase == MarketPhase.CLOSED and ord_type == ORD_TYPE_MARKET:
        report = build_exec_report(
            cl_ord_id=cl_ord_id, order_id=order_id, trader_group_id=trader_group_id,
            exec_type=EXEC_TYPE_REJECTED, ord_status=STATUS_REJECTED,
            symbol=symbol, side=side, ord_type=ord_type,
            order_qty=order_qty, leaves_qty=0, cum_qty=0,
            account=account, group_id=group_id,
            ord_rej_reason=ORD_REJ_REASON_OTHER,
            text="Marché fermé — ordres au marché rejetés hors séance BVC",
        )
        return report, {
            "statut": "rejete",
            "raison": "Marché fermé. La BVC est ouverte lun-ven 09h00-15h30 (Casablanca).",
            "evenements_annexes": annexes,
        }

    # ── CPX : mis en file d'attente, dénoué au prix de clôture ────────────────
    if is_cpx:
        book_cpx = _CPX_QUEUE.setdefault(symbol, [])
        new_order = BookOrder(
            order_id=order_id, cl_ord_id=cl_ord_id, owner_id=trader_group_id,
            side=side, ord_type=ord_type, quantity=order_qty, price=price, tif=tif,
            price_was_set=price_was_set, group_id=group_id, account=account,
        )
        book_cpx.append(new_order)
        report = build_exec_report(
            cl_ord_id=cl_ord_id, order_id=order_id, trader_group_id=trader_group_id,
            exec_type=EXEC_TYPE_SUSPENDED, ord_status=STATUS_SUSPENDED,
            symbol=symbol, side=side, ord_type=ord_type,
            order_qty=order_qty, leaves_qty=order_qty, cum_qty=0,
            account=account, group_id=group_id,
            text="Ordre CPX en attente du prix de clôture",
        )
        return report, {
            "statut": "en_attente", "order_id": order_id,
            "raison": "CPX — en attente du prix de clôture.",
            "evenements_annexes": annexes,
        }

    # ── File d'attente pré-ouverture : ordre "parké" hors carnet (2.1.4 : ─────
    # Suspended = ordre non encore injecté dans le carnet) ────────────────────
    if phase == MarketPhase.PRE_OPEN:
        book = _get_book(symbol)
        new_order = BookOrder(
            order_id=order_id, cl_ord_id=cl_ord_id, owner_id=trader_group_id,
            side=side, ord_type=ord_type,
            quantity=order_qty, price=price, tif=tif,
            stop_px=stop_px, triggered=(stop_px is None),
            display_qty=display_qty, display_method=display_method, min_qty=min_qty,
            expire_time=expire_time, expire_date=expire_date, offset_bp=offset_bp,
            price_was_set=price_was_set, group_id=group_id, account=account,
        )
        if side == SIDE_BUY:
            book["bids"].append(new_order)
        else:
            book["asks"].append(new_order)
        _sort_book(book)
        report = build_exec_report(
            cl_ord_id=cl_ord_id, order_id=order_id, trader_group_id=trader_group_id,
            exec_type=EXEC_TYPE_SUSPENDED, ord_status=STATUS_SUSPENDED,
            symbol=symbol, side=side, ord_type=ord_type,
            order_qty=order_qty, leaves_qty=order_qty, cum_qty=0,
            price=price if price else None,
            account=account, group_id=group_id,
            text="Ordre mis en file d'attente pré-ouverture BVC",
        )
        return report, {
            "statut":   "en_attente",
            "order_id": order_id,
            "raison":   "Pré-ouverture — ordre accepté, sera traité à 09h00.",
            "evenements_annexes": annexes,
        }

    # ── Séance continue : matching ────────────────────────────────────────────
    book     = _get_book(symbol)
    _sort_book(book)
    _reprice_pegged(book)

    # Offset : le prix est calculé une fois à la soumission, à partir du DRP
    # (approximé par le dernier prix négocié, ou le prix de référence fourni
    # par le client à défaut de tout historique de négociation).
    if ord_type == ORD_TYPE_OFFSET and offset_bp is not None:
        drp = _LAST_TRADE_PX.get(symbol, price if price else 0.0)
        if drp:
            price = _offset_price(drp, side, offset_bp)

    # Pegged : prix initial au midpoint courant du BBO (peut être None si un
    # seul côté du carnet est garni — l'ordre reste alors non exécutable
    # jusqu'à ce qu'un midpoint existe).
    if ord_type == ORD_TYPE_PEGGED:
        if book["bids"] and book["asks"]:
            price = round((book["bids"][0].price + book["asks"][0].price) / 2, 4)
        else:
            price = 0.0

    opposite = book["asks"] if side == SIDE_BUY else book["bids"]

    new_order = BookOrder(
        order_id=order_id, cl_ord_id=cl_ord_id, owner_id=trader_group_id,
        side=side, ord_type=ord_type,
        quantity=order_qty, price=price, tif=tif,
        stop_px=stop_px, triggered=(stop_px is None),
        display_qty=display_qty, display_method=display_method, min_qty=min_qty,
        expire_time=expire_time, expire_date=expire_date, offset_bp=offset_bp,
        price_was_set=price_was_set, group_id=group_id, account=account,
    )

    # ── Stop / Stop Limit : parqué tant que StopPx n'est pas franchi ──────────
    if ord_type in (ORD_TYPE_STOP, ORD_TYPE_STOP_LIMIT):
        last_px = _LAST_TRADE_PX.get(symbol)
        immediately_triggered = (
            last_px is not None and stop_px is not None
            and ((last_px >= stop_px) if side == SIDE_BUY else (last_px <= stop_px))
        )
        if not immediately_triggered:
            if side == SIDE_BUY:
                book["bids"].append(new_order)
            else:
                book["asks"].append(new_order)
            _sort_book(book)
            report = build_exec_report(
                cl_ord_id=cl_ord_id, order_id=order_id, trader_group_id=trader_group_id,
                exec_type=EXEC_TYPE_NEW, ord_status=STATUS_NEW,
                symbol=symbol, side=side, ord_type=ord_type,
                order_qty=order_qty, leaves_qty=order_qty, cum_qty=0,
                stop_px=stop_px,
                account=account, group_id=group_id,
                text="Ordre Stop accepté, en attente de franchissement de StopPx",
            )
            return report, {
                "statut": "en_attente", "order_id": order_id,
                "raison": "Ordre Stop en attente de déclenchement.",
                "evenements_annexes": annexes,
            }
        # Déclenché immédiatement : converti et traité comme un ordre standard.
        new_order.triggered = True
        new_order.ord_type = ORD_TYPE_MARKET if ord_type == ORD_TYPE_STOP else ORD_TYPE_LIMIT
        ord_type = new_order.ord_type

    def crosses(resting: BookOrder) -> bool:
        """Vérifie si le nouvel ordre croise le prix de l'ordre au repos."""
        if ord_type == ORD_TYPE_MARKET:
            return True
        return price >= resting.price if side == SIDE_BUY else price <= resting.price

    # ── PassiveOnlyOrder (27010) : rejet si l'ordre agresserait de la ─────────
    # liquidité visible au repos (2.13, "post-only") — un ordre Hidden au repos
    # ne compte pas comme contrepartie "visible". Cf. commentaire sur
    # _PASSIVE_ONLY_REJECT_ON_CROSS pour la simplification 100/1/2/3.
    if passive_only_order in _PASSIVE_ONLY_REJECT_ON_CROSS:
        would_cross = any(
            o.triggered and o.display_method != DISPLAY_METHOD_HIDDEN and crosses(o)
            for o in opposite
        )
        if would_cross:
            report = build_exec_report(
                cl_ord_id=cl_ord_id, order_id=order_id, trader_group_id=trader_group_id,
                exec_type=EXEC_TYPE_REJECTED, ord_status=STATUS_REJECTED,
                symbol=symbol, side=side, ord_type=ord_type,
                order_qty=order_qty, leaves_qty=0, cum_qty=0,
                price=price if price else None,
                passive_only_order=passive_only_order, account=account, group_id=group_id,
                ord_rej_reason=ORD_REJ_REASON_OTHER,
                text="PassiveOnlyOrder (27010) — rejeté : croiserait une contrepartie visible",
            )
            return report, {
                "statut": "rejete",
                "raison": "PassiveOnlyOrder — ordre rejeté car il agresserait une contrepartie visible",
                "evenements_annexes": annexes,
            }

    # ── FOK : vérification préalable (dry-run) ────────────────────────────────
    # Pour FOK on vérifie la liquidité disponible AVANT de toucher le carnet.
    # Ainsi aucun ordre au repos n'est modifié si le FOK doit être annulé.
    if tif == TIF_FOK:
        available = sum(o.leaves_qty for o in opposite if o.triggered and crosses(o))
        if available < order_qty:
            report = build_exec_report(
                cl_ord_id=cl_ord_id, order_id=order_id, trader_group_id=trader_group_id,
                exec_type=EXEC_TYPE_CANCELED, ord_status=STATUS_CANCELED,
                symbol=symbol, side=side, ord_type=ord_type,
                order_qty=order_qty, leaves_qty=order_qty, cum_qty=0,
                price=price if price else None,
                account=account, group_id=group_id,
                text="FOK annulé — liquidité insuffisante dans le carnet",
            )
            return report, {
                "statut": "annule",
                "raison": "FOK — ordre annulé car non intégralement exécutable.",
                "evenements_annexes": annexes,
            }

    executions = _match(new_order, book, side, symbol)

    cum_qty    = new_order.filled_qty
    leaves_qty = new_order.leaves_qty

    avg_px   = sum(p * q for p, q in executions) / cum_qty if cum_qty else 0.0
    last_px, last_qty = executions[-1] if executions else (0.0, 0)
    if executions:
        _record_trade(symbol, last_px)
        annexes += _trigger_stops(symbol)

    # ── Aucun match disponible ────────────────────────────────────────────────
    if cum_qty == 0:
        if ord_type == ORD_TYPE_MARKET:
            # Simulation market maker : exécution immédiate au prix marché fourni
            exec_price = market_px if market_px > 0 else price
            report = build_exec_report(
                cl_ord_id=cl_ord_id, order_id=order_id, trader_group_id=trader_group_id,
                exec_type=EXEC_TYPE_TRADE, ord_status=STATUS_FILLED,
                symbol=symbol, side=side, ord_type=ord_type,
                order_qty=order_qty, leaves_qty=0,
                cum_qty=order_qty,
                last_px=exec_price, last_qty=order_qty,
                account=account, group_id=group_id,
                text="Exécuté via simulation market maker",
            )
            _record_trade(symbol, exec_price)
            annexes += _trigger_stops(symbol)
            return report, {
                "statut":            "execute",
                "order_id":          order_id,
                "prix_execution":    exec_price,
                "quantite_executee": order_qty,
                "evenements_annexes": annexes,
            }
        elif tif == TIF_IOC:
            report = build_exec_report(
                cl_ord_id=cl_ord_id, order_id=order_id, trader_group_id=trader_group_id,
                exec_type=EXEC_TYPE_CANCELED, ord_status=STATUS_CANCELED,
                symbol=symbol, side=side, ord_type=ord_type,
                order_qty=order_qty, leaves_qty=0, cum_qty=0,
                price=price if price else None,
                account=account, group_id=group_id,
                text="IOC annulé — aucun ordre contrepartie disponible",
            )
            return report, {
                "statut": "annule",
                "raison": "IOC — aucune contrepartie disponible.",
                "evenements_annexes": annexes,
            }
        else:
            # Ordre limite (ou Pegged/Offset/Iceberg/Hidden) : repos dans le carnet
            if side == SIDE_BUY:
                book["bids"].append(new_order)
            else:
                book["asks"].append(new_order)
            _sort_book(book)
            report = build_exec_report(
                cl_ord_id=cl_ord_id, order_id=order_id, trader_group_id=trader_group_id,
                exec_type=EXEC_TYPE_NEW, ord_status=STATUS_NEW,
                symbol=symbol, side=side, ord_type=ord_type,
                order_qty=order_qty, leaves_qty=order_qty, cum_qty=0,
                price=price,
                display_qty=new_order.clip_remaining, display_method=display_method,
                min_qty=min_qty, offset_bp=offset_bp,
                account=account, group_id=group_id,
                text="Ordre limite accepté et en attente dans le carnet",
            )
            return report, {
                "statut":   "en_attente",
                "order_id": order_id,
                "evenements_annexes": annexes,
            }

    # ── Partiellement exécuté ─────────────────────────────────────────────────
    if cum_qty < order_qty:
        if tif == TIF_IOC:
            # Annuler le reste
            report = build_exec_report(
                cl_ord_id=cl_ord_id, order_id=order_id, trader_group_id=trader_group_id,
                exec_type=EXEC_TYPE_CANCELED, ord_status=STATUS_CANCELED,
                symbol=symbol, side=side, ord_type=ord_type,
                order_qty=order_qty, leaves_qty=0,
                cum_qty=cum_qty,
                last_px=last_px, last_qty=last_qty,
                price=price if price else None,
                account=account, group_id=group_id,
                text="IOC partiellement exécuté, reste annulé",
            )
        else:
            # Repos du reste dans le carnet
            # quantity = OrderQty ORIGINAL (pas le reste) et filled_qty = CumQty
            # déjà exécuté, pour que leaves_qty (= quantity - filled_qty) reste
            # correct ET que l'historique d'exécution survive tant que l'ordre
            # reste dans le carnet (nécessaire pour Order Cancel/Replace, qui
            # doit pouvoir vérifier qu'une nouvelle OrderQty ne descend pas
            # sous la quantité déjà exécutée).
            rest = BookOrder(
                order_id=order_id, cl_ord_id=cl_ord_id, owner_id=trader_group_id,
                side=side, ord_type=ord_type if ord_type != ORD_TYPE_MARKET else ORD_TYPE_LIMIT,
                quantity=order_qty, price=price, tif=tif,
                display_qty=display_qty, display_method=display_method, min_qty=min_qty,
                expire_time=expire_time, expire_date=expire_date, offset_bp=offset_bp,
                price_was_set=price_was_set, group_id=group_id, account=account,
            )
            rest.filled_qty = cum_qty
            if side == SIDE_BUY:
                book["bids"].append(rest)
            else:
                book["asks"].append(rest)
            _sort_book(book)
            report = build_exec_report(
                cl_ord_id=cl_ord_id, order_id=order_id, trader_group_id=trader_group_id,
                exec_type=EXEC_TYPE_TRADE, ord_status=STATUS_PARTIAL_FILL,
                symbol=symbol, side=side, ord_type=ord_type,
                order_qty=order_qty, leaves_qty=leaves_qty,
                cum_qty=cum_qty,
                last_px=last_px, last_qty=last_qty,
                price=price if price else None,
                account=account, group_id=group_id,
                text="Partiellement exécuté, reste en attente dans le carnet",
            )
        return report, {
            "statut":            "partiellement_execute",
            "order_id":          order_id,
            "prix_execution":    round(avg_px, 2),
            "quantite_executee": cum_qty,
            "evenements_annexes": annexes,
        }

    # ── Totalement exécuté ────────────────────────────────────────────────────
    report = build_exec_report(
        cl_ord_id=cl_ord_id, order_id=order_id, trader_group_id=trader_group_id,
        exec_type=EXEC_TYPE_TRADE, ord_status=STATUS_FILLED,
        symbol=symbol, side=side, ord_type=ord_type,
        order_qty=order_qty, leaves_qty=0,
        cum_qty=cum_qty,
        last_px=last_px, last_qty=last_qty,
        price=price if price else None,
        account=account, group_id=group_id,
        text="Ordre totalement exécuté",
    )
    return report, {
        "statut":            "execute",
        "order_id":          order_id,
        "prix_execution":    round(avg_px, 2),
        "quantite_executee": cum_qty,
        "evenements_annexes": annexes,
    }


def process_cancel(fix_msg: str) -> tuple[str, dict]:
    """
    Traite un FIX Order Cancel Request (35=F).
    Retire l'ordre du carnet et retourne un Execution Report ou Cancel Reject.
    """
    tags            = parse(fix_msg)
    party           = parse_party_ids(fix_msg)
    trader_group_id = party.get(PARTY_ROLE_TRADER_GROUP, "")
    order_id       = tags.get("37", "")
    cl_ord_id      = tags.get("11", "")
    orig_cl_ord_id = tags.get("41", "")
    symbol         = tags.get("48", "")
    side           = tags.get("54", SIDE_BUY)

    annexes = _expirer_ordres(symbol) + _trigger_stops(symbol)

    book     = _get_book(symbol)
    side_key = "bids" if side == SIDE_BUY else "asks"
    before   = len(book[side_key])
    book[side_key] = [o for o in book[side_key] if o.order_id != order_id]

    if len(book[side_key]) < before:
        report = build_exec_report(
            cl_ord_id=cl_ord_id, order_id=order_id, trader_group_id=trader_group_id,
            exec_type=EXEC_TYPE_CANCELED, ord_status=STATUS_CANCELED,
            symbol=symbol, side=side, ord_type=ORD_TYPE_LIMIT,
            order_qty=0, leaves_qty=0, cum_qty=0,
            orig_cl_ord_id=orig_cl_ord_id or None,
            text="Ordre annulé sur demande du client",
        )
        return report, {"statut": "annule", "evenements_annexes": annexes}
    else:
        reject = build_cancel_reject(
            cl_ord_id=cl_ord_id,
            orig_cl_ord_id=orig_cl_ord_id,
            order_id=order_id,
            response_to=CXL_REJ_RESPONSE_TO_CANCEL,
            reason_code=CXL_REJ_REASON_UNKNOWN_ORDER,
            reason_text="Order not found in order book",
        )
        return reject, {
            "erreur": "Ordre introuvable dans le carnet (déjà exécuté ou annulé).",
            "evenements_annexes": annexes,
        }


def process_replace(fix_msg: str) -> tuple[str, dict]:
    """
    Traite un FIX Order Cancel/Replace Request (35=G) — section 2.1.2.3.

    Règles d'amendement :
      - Prix modifié OU quantité augmentée → perte de priorité temps (l'ordre
        est retimestampé et repoussé en fin de file à son niveau de prix).
      - Quantité réduite seule → priorité temps conservée.
      - Ordre déjà filled/cancelled/absent du carnet → Order Cancel Reject
        avec OrdStatus=Rejected, même si le statut réel diffère (comportement
        documenté en 2.10.3).
      - Si le remaniement fait croiser le carnet (ex : prix relevé au-dessus
        du meilleur ask), l'ordre est immédiatement ré-exécuté contre les
        ordres au repos disponibles.
    """
    tags            = parse(fix_msg)
    party           = parse_party_ids(fix_msg)
    trader_group_id = party.get(PARTY_ROLE_TRADER_GROUP, "")

    order_id       = tags.get("37", "")
    cl_ord_id      = tags.get("11", "")
    orig_cl_ord_id = tags.get("41", "")
    symbol         = tags.get("48", "")
    side           = tags.get("54", SIDE_BUY)
    new_qty        = int(tags.get("38", 0))
    has_new_price  = "44" in tags

    annexes = _expirer_ordres(symbol) + _trigger_stops(symbol)

    book     = _get_book(symbol)
    side_key = "bids" if side == SIDE_BUY else "asks"
    existing = next((o for o in book[side_key] if o.order_id == order_id), None)

    if existing is None:
        reject = build_cancel_reject(
            cl_ord_id=cl_ord_id,
            orig_cl_ord_id=orig_cl_ord_id,
            order_id=order_id,
            response_to=CXL_REJ_RESPONSE_TO_REPLACE,
            reason_code=CXL_REJ_REASON_TOO_LATE,
            reason_text="Order not found — already filled, cancelled or unknown",
        )
        return reject, {
            "erreur": "Ordre introuvable dans le carnet (déjà exécuté ou annulé).",
            "evenements_annexes": annexes,
        }

    # OrderQty (38) ne peut jamais descendre sous la quantité déjà exécutée —
    # sinon LeavesQty (151 = OrderQty - CumQty) deviendrait négatif, ce qui
    # viole l'invariant FIX (2.1.4 : LeavesQty et CumQty s'additionnent
    # toujours pour donner OrderQty).
    if new_qty < existing.filled_qty:
        reject = build_cancel_reject(
            cl_ord_id=cl_ord_id,
            orig_cl_ord_id=orig_cl_ord_id,
            order_id=order_id,
            response_to=CXL_REJ_RESPONSE_TO_REPLACE,
            reason_code=CXL_REJ_REASON_TOO_LATE,
            reason_text=(
                f"OrderQty ({new_qty}) cannot be less than already executed "
                f"quantity ({existing.filled_qty})"
            ),
        )
        return reject, {
            "erreur": (
                f"Quantité demandée ({new_qty}) inférieure à la quantité déjà "
                f"exécutée ({existing.filled_qty})."
            ),
            "evenements_annexes": annexes,
        }

    # StopPx (99) — 2.1.2.3 : "The Stop price of a Stop/Stop Limit order
    # cannot be amended once the order has been injected into the order
    # book." `existing` est PAR DÉFINITION déjà dans le carnet à ce stade
    # (trouvé via book[side_key]), donc toute tentative d'amendement de 99
    # sur un ordre Stop/Stop Limit est rejetée, quelle que soit la valeur.
    if "99" in tags and existing.ord_type in (ORD_TYPE_STOP, ORD_TYPE_STOP_LIMIT):
        reject = build_cancel_reject(
            cl_ord_id=cl_ord_id, orig_cl_ord_id=orig_cl_ord_id, order_id=order_id,
            response_to=CXL_REJ_RESPONSE_TO_REPLACE, reason_code=CXL_REJ_REASON_OTHER,
            reason_text="StopPx (99) cannot be amended once the order is in the order book (2.1.2.3)",
        )
        return reject, {
            "erreur": "Le prix Stop (StopPx) ne peut plus être modifié une fois l'ordre injecté dans le carnet.",
            "evenements_annexes": annexes,
        }

    # DisplayMethod (1084)/DisplayQty (1138) — transitions de visibilité
    # autorisées entre l'état courant et l'état demandé (2.1.2.3/2.10.15/2.10.16).
    #
    # Cas particulier 2.10.16 : sur un ordre Random Iceberg existant, le tag
    # 1084 doit être explicitement resoumis à "3" (Random) — une simple
    # absence du tag n'est PAS traitée comme "conserver Random" ici (ce serait
    # trop permissif au regard du texte "DisplayMethod... must stay 3 or the
    # message is rejected") : le client doit prouver qu'il a bien l'intention
    # de conserver le mode Random en le renvoyant explicitement.
    new_display_qty    = int(tags["1138"]) if "1138" in tags else existing.display_qty
    current_state = _display_state(existing.display_qty, existing.display_method, existing.quantity)
    if current_state == "iceberg_random":
        forbidden = tags.get("1084") != DISPLAY_METHOD_RANDOM
        new_display_method = DISPLAY_METHOD_RANDOM
    else:
        new_display_method = tags.get("1084", existing.display_method)
        new_state = _display_state(new_display_qty, new_display_method, new_qty)
        forbidden = current_state != new_state and (
            new_state == "hidden" or current_state == "hidden"                  # 2.1.2.3 : visible/iceberg <-> hidden
            or (current_state == "visible" and new_state == "iceberg_random")   # 2.10.15
        )
    if forbidden:
        reject = build_cancel_reject(
            cl_ord_id=cl_ord_id, orig_cl_ord_id=orig_cl_ord_id, order_id=order_id,
            response_to=CXL_REJ_RESPONSE_TO_REPLACE, reason_code=CXL_REJ_REASON_OTHER,
            reason_text="DisplayMethod transition not allowed (2.1.2.3/2.10.15/2.10.16)",
        )
        return reject, {
            "erreur": "Transition de visibilité non autorisée pour cet amendement (DisplayMethod).",
            "evenements_annexes": annexes,
        }

    # Offset (40=F) — 6.4.4 : la présence/absence de Price (44) sur le
    # Cancel/Replace doit correspondre à celle du New Order d'origine.
    if existing.ord_type == ORD_TYPE_OFFSET and has_new_price != existing.price_was_set:
        reject = build_cancel_reject(
            cl_ord_id=cl_ord_id, orig_cl_ord_id=orig_cl_ord_id, order_id=order_id,
            response_to=CXL_REJ_RESPONSE_TO_REPLACE, reason_code=CXL_REJ_REASON_OTHER,
            reason_text="Price (44) presence must match the original New Order for an Offset order (6.4.4)",
        )
        return reject, {
            "erreur": "Price doit être fourni sur ce remaniement seulement s'il l'était sur l'ordre d'origine (ordre Offset).",
            "evenements_annexes": annexes,
        }

    # MinQty (110) — 6.4.4 : mêmes règles qu'en 6.4.1, réservé aux ordres Pegged.
    if "110" in tags and existing.ord_type != ORD_TYPE_PEGGED:
        reject = build_cancel_reject(
            cl_ord_id=cl_ord_id, orig_cl_ord_id=orig_cl_ord_id, order_id=order_id,
            response_to=CXL_REJ_RESPONSE_TO_REPLACE, reason_code=CXL_REJ_REASON_OTHER,
            reason_text="MinQty (110) is only applicable to pegged orders (6.4.1/6.4.4)",
        )
        return reject, {
            "erreur": "MinQty n'est applicable qu'aux ordres Pegged.",
            "evenements_annexes": annexes,
        }

    # ExpireTime (126) / ExpireDate (432) — 2.10.20 : un amendement est rejeté
    # si ExpireTime est fourni pour un ordre qui était GTD (date-based),
    # si ExpireDate est fourni pour un ordre qui était GTT (time-based via
    # GTD+ExpireTime, cf. fix_messages.py), si les deux sont fournis
    # ensemble, ou si aucun des deux n'est fourni pour un ordre GTD/GTT.
    has_new_expire_time = "126" in tags
    has_new_expire_date = "432" in tags
    if existing.tif == TIF_GTD:
        was_date_based = existing.expire_date is not None
        was_time_based = existing.expire_time is not None
        expiry_invalid = (
            (has_new_expire_time and has_new_expire_date)
            or (was_date_based and has_new_expire_time)
            or (was_time_based and has_new_expire_date)
            or (not has_new_expire_time and not has_new_expire_date)
        )
        if expiry_invalid:
            reject = build_cancel_reject(
                cl_ord_id=cl_ord_id, orig_cl_ord_id=orig_cl_ord_id, order_id=order_id,
                response_to=CXL_REJ_RESPONSE_TO_REPLACE, reason_code=CXL_REJ_REASON_OTHER,
                reason_text="ExpireTime/ExpireDate must be consistent with the original GTD/GTT order (2.10.20)",
            )
            return reject, {
                "erreur": "ExpireTime/ExpireDate incohérent avec le type (GTD/GTT) de l'ordre d'origine.",
                "evenements_annexes": annexes,
            }
        if has_new_expire_time:
            existing.expire_time = datetime.strptime(tags["126"], "%Y%m%d-%H:%M:%S.%f").replace(tzinfo=timezone.utc)
            existing.expire_date = None
        elif has_new_expire_date:
            existing.expire_date = datetime.strptime(tags["432"], "%Y%m%d").date()
            existing.expire_time = None

    new_price      = float(tags["44"]) if has_new_price else existing.price
    loses_priority = (has_new_price and new_price != existing.price) or (new_qty > existing.quantity)

    existing.quantity = new_qty
    existing.price    = new_price
    if "110" in tags:
        existing.min_qty = int(tags["110"])
    if "27018" in tags:
        existing.offset_bp = float(tags["27018"])
    if "1" in tags:
        existing.account = tags["1"]
    if "27017" in tags:
        existing.group_id = tags["27017"]
    if new_display_method != existing.display_method or new_display_qty != existing.display_qty:
        existing.display_method = new_display_method
        existing.display_qty    = new_display_qty
        existing.clip_remaining = (
            min(existing.clip_remaining if existing.clip_remaining is not None else new_display_qty,
                new_display_qty, existing.leaves_qty)
            if new_display_qty is not None else None
        )
    if loses_priority:
        existing.timestamp = datetime.now(timezone.utc)

    # Retrait temporaire pour ré-exécuter l'ordre modifié comme un ordre neuf.
    book[side_key] = [o for o in book[side_key] if o.order_id != order_id]
    _reprice_pegged(book)

    filled_before = existing.filled_qty  # cumul déjà exécuté AVANT ce remaniement
    executions = _match(existing, book, side, symbol)

    # cum_qty = cumul total (pour CumQty/OrdStatus FIX, qui portent sur toute
    # la vie de l'ordre) ; new_fill = quantité exécutée PENDANT ce remaniement
    # uniquement (c'est ce qui doit être appliqué au portefeuille — sinon un
    # replace sans nouveau croisement réappliquerait une exécution déjà
    # comptabilisée par un appel précédent).
    cum_qty    = existing.filled_qty
    new_fill   = cum_qty - filled_before
    leaves_qty = existing.leaves_qty
    avg_px     = sum(p * q for p, q in executions) / new_fill if new_fill else 0.0
    last_px, last_qty = executions[-1] if executions else (0.0, 0)
    if new_fill:
        _record_trade(symbol, last_px)
        annexes += _trigger_stops(symbol)

    if leaves_qty > 0:
        book[side_key].append(existing)
        _sort_book(book)

    if leaves_qty == 0:
        ord_status, statut = STATUS_FILLED, "execute"
    elif cum_qty > 0:
        ord_status, statut = STATUS_PARTIAL_FILL, "partiellement_execute"
    else:
        ord_status, statut = STATUS_NEW, "en_attente"
    exec_type = EXEC_TYPE_TRADE if new_fill else EXEC_TYPE_REPLACED

    report = build_exec_report(
        cl_ord_id=cl_ord_id, order_id=order_id, trader_group_id=trader_group_id,
        exec_type=exec_type, ord_status=ord_status,
        symbol=symbol, side=side, ord_type=ORD_TYPE_LIMIT,
        order_qty=new_qty, leaves_qty=leaves_qty, cum_qty=cum_qty,
        last_px=last_px, last_qty=last_qty, price=existing.price,
        stop_px=existing.stop_px,
        display_qty=existing.clip_remaining, display_method=existing.display_method,
        min_qty=existing.min_qty, offset_bp=existing.offset_bp,
        account=existing.account, group_id=existing.group_id,
        orig_cl_ord_id=orig_cl_ord_id or None,
        text="Ordre modifié" + (" et exécuté suite au remaniement" if new_fill else ""),
    )
    return report, {
        "statut":            statut,
        "order_id":          order_id,
        "prix_execution":    round(avg_px, 2) if new_fill else None,
        "quantite_executee": new_fill if new_fill else None,
        "evenements_annexes": annexes,
    }


def process_mass_cancel(fix_msg: str) -> tuple[list[str], dict]:
    """
    Traite un FIX Order Mass Cancel Request (35=q) — section 2.1.2.2 / 6.4.3.

    Retourne une LISTE de messages FIX (pas un seul) :
      [0]  = Order Mass Cancel Report (35=r), toujours en premier
      [1:] = un Execution Report (35=8, ExecType=Cancelled) par ordre
             effectivement annulé, avec ClOrdID = celui de la requête Mass
             Cancel elle-même — comportement documenté en 2.1.2.2 : "The
             server will then immediately transmit Execution Reports for
             each order that is cancelled... The ClOrdID of all such
             messages will be the ClOrdID of the Order Mass Cancel Request."

    Scope limité à "tous les ordres du compte appelant" (TargetPartyRole=76
    Trader Group), optionnellement restreint à un instrument (56) et/ou à un
    GroupID (56/57, tag 27017 — bucket client-assignable, distinct du
    Trader Group) — cette plateforme retail n'a pas de notion de mass cancel
    au niveau Member ID.
    """
    tags      = parse(fix_msg)
    cl_ord_id = tags.get("11", "")
    req_type  = tags.get("530", "")
    target_id = tags.get("1462", "")
    symbol    = tags.get("48") or None
    group_id  = tags.get("27017")
    report_id = str(uuid.uuid4())

    supported_types = (
        MASS_CANCEL_ALL_ORDERS, MASS_CANCEL_FOR_INSTRUMENT,
        MASS_CANCEL_FOR_GROUP, MASS_CANCEL_FOR_INSTRUMENT_GROUP,
    )
    # 57 (For Instrument For Group) + TargetPartyRole=76 (Trader Group) est
    # explicitement "non supporté, sera rejeté" par le vrai gateway LSE
    # (tableau des combinaisons, 6.4.3). Cette plateforme retail n'a pas de
    # notion de Member ID (rôle 1) : le TargetPartyRole émis est TOUJOURS 76
    # (cf. build_mass_cancel_request), donc le type 57 ne peut structurellement
    # jamais être valide ici — fidèle au comportement réel plutôt qu'à une
    # simplification qui laisserait passer une combinaison invalide.
    if req_type not in supported_types or req_type == MASS_CANCEL_FOR_INSTRUMENT_GROUP or (
        req_type == MASS_CANCEL_FOR_GROUP and not group_id
    ):
        report = build_mass_cancel_report(
            mass_action_report_id=report_id, cl_ord_id=cl_ord_id,
            mass_cancel_request_type=req_type,
            mass_cancel_response=MASS_CANCEL_RESPONSE_REJECTED,
            reject_reason="99",
        )
        if req_type not in supported_types:
            reason = f"MassCancelRequestType '{req_type}' non supporté."
        elif req_type == MASS_CANCEL_FOR_INSTRUMENT_GROUP:
            reason = (
                "MassCancelRequestType=57 (For Instrument For Group) + TargetPartyRole=76 "
                "(Trader Group) n'est pas supporté par le gateway LSE (6.4.3) — cette plateforme "
                "n'ayant pas de notion de Member ID, ce type ne peut jamais être utilisé ici."
            )
        else:
            reason = "GroupID (27017) requis pour un Mass Cancel de type For Group."
        return [report], {"erreur": reason}

    # 57 est toujours rejeté ci-dessus : à ce stade req_type ∈ {1, 7, 56}.
    by_instrument = req_type == MASS_CANCEL_FOR_INSTRUMENT
    by_group      = req_type == MASS_CANCEL_FOR_GROUP
    symbols = [symbol] if (by_instrument and symbol) else list(_ORDER_BOOK.keys())
    cancelled: list[tuple[str, str, BookOrder]] = []  # (symbol, side FIX, BookOrder)

    for sym in symbols:
        book = _get_book(sym)
        for side_key in ("bids", "asks"):
            side = SIDE_BUY if side_key == "bids" else SIDE_SELL
            keep = []
            for o in book[side_key]:
                if o.owner_id == target_id and (not by_group or o.group_id == group_id):
                    cancelled.append((sym, side, o))
                else:
                    keep.append(o)
            book[side_key] = keep

    mass_report = build_mass_cancel_report(
        mass_action_report_id=report_id, cl_ord_id=cl_ord_id,
        mass_cancel_request_type=req_type,
        mass_cancel_response=req_type,
        group_id=group_id if by_group else None,
        # TotalAffectedOrders (533) : connu ici car ce report est émis APRÈS
        # traitement complet du mass cancel (contrairement au vrai gateway,
        # cf. limitation 2.10.11 documentée dans le builder).
        total_affected_orders=len(cancelled),
    )
    messages = [mass_report]
    for sym, side, o in cancelled:
        messages.append(build_exec_report(
            cl_ord_id=cl_ord_id, order_id=o.order_id, trader_group_id=o.owner_id,
            exec_type=EXEC_TYPE_CANCELED, ord_status=STATUS_CANCELED,
            symbol=sym, side=side, ord_type=o.ord_type,
            order_qty=o.quantity, leaves_qty=0, cum_qty=o.filled_qty,
            account=o.account, group_id=o.group_id,
            text="Ordre annulé via Order Mass Cancel Request (35=q)",
        ))

    return messages, {"statut": "annule", "order_ids": [o.order_id for _, _, o in cancelled]}


def reload_order_book() -> int:
    """
    Recharge le carnet d'ordres depuis la DB au démarrage du pod.

    Charge tous les ordres 'en_attente' et 'partiellement_execute' pour
    reconstruire _ORDER_BOOK et éviter les orphelins après un redémarrage.
    Retourne le nombre d'ordres rechargés.

    Pour les ordres partiellement exécutés, seule la quantité restante
    (quantite - quantite_executee) est réinjectée dans le carnet.
    """
    from app.db import get_connection, get_dict_cursor  # import local pour éviter les imports circulaires

    _ORDER_BOOK.clear()
    count = 0

    _TIF_MAP: dict[str, str] = {
        "day": TIF_DAY,
        "gtc": TIF_DAY,  # "gtc" n'existe pas dans l'énumération MIT202 — cf. fix_messages.py
        "ioc": TIF_IOC,
        "fok": TIF_FOK,
        "gtd": TIF_GTD,
        "gtt": TIF_GTD,  # GTT s'exprime via GTD+ExpireTime — cf. fix_messages.py
    }

    _TYPE_MAP: dict[str, str] = {
        "marche": ORD_TYPE_MARKET,
        "limite": ORD_TYPE_LIMIT,
        "stop": ORD_TYPE_STOP,
        "stop_limite": ORD_TYPE_STOP_LIMIT,
        "iceberg": ORD_TYPE_LIMIT,
        "cache": ORD_TYPE_LIMIT,
        "pegged": ORD_TYPE_PEGGED,
        "offset": ORD_TYPE_OFFSET,
    }

    try:
        with get_connection() as conn:
            with get_dict_cursor(conn) as cur:
                cur.execute("""
                    SELECT
                        o.id::text          AS order_id,
                        o.compte_id::text   AS owner_id,
                        i.code              AS symbol,
                        o.sens,
                        o.type_ordre,
                        o.quantite,
                        o.prix_limite,
                        o.time_in_force,
                        o.stop_px,
                        o.display_qty,
                        o.display_method,
                        o.min_qty,
                        o.expire_time,
                        o.expire_date,
                        o.offset_bp,
                        o.group_id,
                        o.date_creation,
                        COALESCE(e.quantite_executee, 0) AS qte_exec
                    FROM ordres.ordres o
                    JOIN marche.instruments i ON i.id = o.instrument_id
                    LEFT JOIN ordres.executions e ON e.ordre_id = o.id
                    WHERE o.statut IN ('en_attente', 'partiellement_execute')
                    ORDER BY o.date_creation ASC
                """)
                rows = cur.fetchall()

        for r in rows:
            leaves = float(r["quantite"]) - float(r["qte_exec"])
            if leaves <= 0:
                continue

            side     = SIDE_BUY if r["sens"] == "achat" else SIDE_SELL
            ord_type = _TYPE_MAP.get(r["type_ordre"] or "limite", ORD_TYPE_LIMIT)
            tif      = _TIF_MAP.get(r["time_in_force"] or "day", TIF_DAY)
            price    = float(r["prix_limite"]) if r["prix_limite"] else 0.0

            book = _get_book(r["symbol"])
            # quantity = OrderQty original (r["quantite"]) et filled_qty = CumQty
            # déjà exécuté (r["qte_exec"]) — mêmes raisons qu'en 2.1 pour que
            # leaves_qty et la validation Cancel/Replace restent cohérents
            # après un redémarrage du pod.
            bo = BookOrder(
                order_id  = r["order_id"],
                cl_ord_id = r["order_id"],
                owner_id  = r["owner_id"],
                side      = side,
                ord_type  = ord_type,
                quantity  = int(r["quantite"]),
                price     = price,
                tif       = tif,
                timestamp = r["date_creation"],
                stop_px   = float(r["stop_px"]) if r.get("stop_px") else None,
                triggered = not (ord_type in (ORD_TYPE_STOP, ORD_TYPE_STOP_LIMIT) and r.get("stop_px")),
                display_qty    = int(r["display_qty"]) if r.get("display_qty") else None,
                display_method = r.get("display_method"),
                min_qty        = int(r["min_qty"]) if r.get("min_qty") else None,
                expire_time    = r.get("expire_time"),
                expire_date    = r.get("expire_date"),
                offset_bp      = float(r["offset_bp"]) if r.get("offset_bp") else None,
                # price_was_set n'est pas persisté (pas de colonne DB dédiée) —
                # approximé par la présence de prix_limite au rechargement ;
                # simplification documentée (cf. FIX_PROTOCOL.md), même
                # principe que le mapping TIF_GTT/TIF_DAY ci-dessus.
                price_was_set  = r.get("prix_limite") is not None,
                group_id       = r.get("group_id") or "0",
            )
            bo.filled_qty = int(r["qte_exec"])
            if side == SIDE_BUY:
                book["bids"].append(bo)
            else:
                book["asks"].append(bo)
            count += 1

        for book in _ORDER_BOOK.values():
            _sort_book(book)

        log.info("[FIX ENGINE] Carnet rechargé depuis DB : %d ordre(s) en attente.", count)

    except Exception as exc:
        log.error("[FIX ENGINE] Impossible de recharger le carnet depuis DB : %s", exc)

    return count
