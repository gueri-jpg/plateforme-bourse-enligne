"""
Moteur de matching FIX simulé — protocole LSE FIX 4.4, heures BVC Casablanca.

Simule le comportement du London Stock Exchange (LSE) Millennium Exchange :
  - Carnet d'ordres en mémoire par instrument (bids / asks)
  - Matching par priorité prix-temps (price-time priority)
  - Phases de marché adaptées à la BVC (Casablanca, Africa/Casablanca)
  - Sémantiques IOC et FOK
  - Retourne des FIX Execution Reports (35=8) pour chaque changement d'état

Phases BVC :
  PRE_OPEN   : 08h30 – 09h00  (ordres acceptés, pas de matching)
  CONTINUOUS : 09h00 – 15h30  (matching en continu)
  CLOSED     : hors horaires  (ordres au marché rejetés)
"""
import uuid
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from app.services.fix_messages import (
    parse,
    build_exec_report,
    build_cancel_reject,
    ORD_TYPE_MARKET, ORD_TYPE_LIMIT,
    SIDE_BUY, SIDE_SELL,
    TIF_IOC, TIF_FOK,
    STATUS_NEW, STATUS_PARTIAL_FILL, STATUS_FILLED,
    STATUS_CANCELED, STATUS_REJECTED, STATUS_PENDING_NEW,
    EXEC_TYPE_NEW, EXEC_TYPE_PARTIAL_FILL, EXEC_TYPE_FILL,
    EXEC_TYPE_CANCELED, EXEC_TYPE_REJECTED, EXEC_TYPE_PENDING_NEW,
)

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
    side:       str
    ord_type:   str
    quantity:   int
    price:      float     # Prix limite (0.0 pour les ordres au marché)
    tif:        str
    timestamp:  datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    filled_qty: int = 0

    @property
    def leaves_qty(self) -> int:
        return self.quantity - self.filled_qty


# Carnet d'ordres en mémoire : symbole → {"bids": [...], "asks": [...]}
_ORDER_BOOK: dict[str, dict[str, list[BookOrder]]] = {}


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


def get_order_book_snapshot(symbol: str) -> dict:
    """Retourne un instantané lisible du carnet d'ordres."""
    book = _get_book(symbol)
    _sort_book(book)
    return {
        "symbol": symbol,
        "phase":  get_market_phase(),
        "bids": [
            {"prix": o.price, "quantite": o.leaves_qty, "ordre_id": o.order_id}
            for o in book["bids"]
        ],
        "asks": [
            {"prix": o.price, "quantite": o.leaves_qty, "ordre_id": o.order_id}
            for o in book["asks"]
        ],
    }


# ── Moteur de matching ────────────────────────────────────────────────────────

def process_new_order(fix_msg: str) -> tuple[str, dict]:
    """
    Traite un FIX New Order Single (35=D).

    Retourne (exec_report_fix, result_dict) où result_dict contient :
      - statut          : "execute" | "partiellement_execute" | "en_attente" | "annule" | "rejete"
      - prix_execution  : float | None
      - quantite_executee : int | None
      - raison          : str (en cas de rejet/annulation)

    Algorithme de matching LSE (price-time priority) :
      1. Ordres au marché  → match immédiat au meilleur prix disponible
         Si pas de contrepartie → exécuté au prix fourni (simulation market maker)
      2. Ordres limite     → match si le prix croise le carnet, sinon repos dans le carnet
      3. IOC               → remplit ce qui est disponible, annule le reste
      4. FOK               → remplit entièrement ou annule tout
    """
    tags      = parse(fix_msg)
    cl_ord_id = tags.get("11", str(uuid.uuid4()))
    symbol    = tags.get("55", "")
    side      = tags.get("54", SIDE_BUY)
    ord_type  = tags.get("40", ORD_TYPE_LIMIT)
    order_qty = int(tags.get("38", 0))
    price     = float(tags.get("44", 0)) if "44" in tags else 0.0
    tif       = tags.get("59", "0")
    market_px = float(tags.get("99", 0)) if "99" in tags else price   # Prix marché fourni

    # Pour permettre la correspondance avec l'ID DB lors des annulations,
    # on utilise le cl_ord_id comme order_id dans le carnet.
    order_id = cl_ord_id
    phase    = get_market_phase()

    # ── Rejection : ordre au marché hors séance ───────────────────────────────
    if phase == MarketPhase.CLOSED and ord_type == ORD_TYPE_MARKET:
        report = build_exec_report(
            cl_ord_id=cl_ord_id, order_id=order_id,
            exec_type=EXEC_TYPE_REJECTED, ord_status=STATUS_REJECTED,
            symbol=symbol, side=side, ord_type=ord_type,
            order_qty=order_qty, leaves_qty=0, cum_qty=0, avg_px=0.0,
            text="Marché fermé — ordres au marché rejetés hors séance BVC",
        )
        return report, {
            "statut": "rejete",
            "raison": "Marché fermé. La BVC est ouverte lun-ven 09h00-15h30 (Casablanca).",
        }

    # ── File d'attente pré-ouverture ──────────────────────────────────────────
    if phase == MarketPhase.PRE_OPEN:
        book = _get_book(symbol)
        new_order = BookOrder(
            order_id=order_id, cl_ord_id=cl_ord_id,
            side=side, ord_type=ord_type,
            quantity=order_qty, price=price, tif=tif,
        )
        if side == SIDE_BUY:
            book["bids"].append(new_order)
        else:
            book["asks"].append(new_order)
        _sort_book(book)
        report = build_exec_report(
            cl_ord_id=cl_ord_id, order_id=order_id,
            exec_type=EXEC_TYPE_PENDING_NEW, ord_status=STATUS_PENDING_NEW,
            symbol=symbol, side=side, ord_type=ord_type,
            order_qty=order_qty, leaves_qty=order_qty, cum_qty=0, avg_px=0.0,
            price=price if price else None,
            text="Ordre mis en file d'attente pré-ouverture BVC",
        )
        return report, {
            "statut":   "en_attente",
            "order_id": order_id,
            "raison":   "Pré-ouverture — ordre accepté, sera traité à 09h00.",
        }

    # ── Séance continue : matching ────────────────────────────────────────────
    book     = _get_book(symbol)
    _sort_book(book)
    opposite = book["asks"] if side == SIDE_BUY else book["bids"]

    new_order = BookOrder(
        order_id=order_id, cl_ord_id=cl_ord_id,
        side=side, ord_type=ord_type,
        quantity=order_qty, price=price, tif=tif,
    )

    def crosses(resting: BookOrder) -> bool:
        """Vérifie si le nouvel ordre croise le prix de l'ordre au repos."""
        if ord_type == ORD_TYPE_MARKET:
            return True
        return price >= resting.price if side == SIDE_BUY else price <= resting.price

    # ── FOK : vérification préalable (dry-run) ────────────────────────────────
    # Pour FOK on vérifie la liquidité disponible AVANT de toucher le carnet.
    # Ainsi aucun ordre au repos n'est modifié si le FOK doit être annulé.
    if tif == TIF_FOK:
        available = sum(o.leaves_qty for o in opposite if crosses(o))
        if available < order_qty:
            report = build_exec_report(
                cl_ord_id=cl_ord_id, order_id=order_id,
                exec_type=EXEC_TYPE_CANCELED, ord_status=STATUS_CANCELED,
                symbol=symbol, side=side, ord_type=ord_type,
                order_qty=order_qty, leaves_qty=order_qty, cum_qty=0, avg_px=0.0,
                price=price if price else None,
                text="FOK annulé — liquidité insuffisante dans le carnet",
            )
            return report, {
                "statut": "annule",
                "raison": "FOK — ordre annulé car non intégralement exécutable.",
            }

    executions: list[tuple[float, int]] = []   # (prix, quantité) de chaque fill

    i = 0
    while i < len(opposite) and new_order.leaves_qty > 0:
        resting = opposite[i]
        if not crosses(resting):
            break
        fill_qty   = min(new_order.leaves_qty, resting.leaves_qty)
        fill_price = resting.price if resting.price > 0 else market_px
        new_order.filled_qty += fill_qty
        resting.filled_qty   += fill_qty
        executions.append((fill_price, fill_qty))
        if resting.leaves_qty == 0:
            opposite.pop(i)
        else:
            i += 1

    cum_qty    = new_order.filled_qty
    leaves_qty = new_order.leaves_qty

    avg_px   = sum(p * q for p, q in executions) / cum_qty if cum_qty else 0.0
    last_px, last_qty = executions[-1] if executions else (0.0, 0)

    # ── Aucun match disponible ────────────────────────────────────────────────
    if cum_qty == 0:
        if ord_type == ORD_TYPE_MARKET:
            # Simulation market maker : exécution immédiate au prix marché fourni
            exec_price = market_px if market_px > 0 else price
            report = build_exec_report(
                cl_ord_id=cl_ord_id, order_id=order_id,
                exec_type=EXEC_TYPE_FILL, ord_status=STATUS_FILLED,
                symbol=symbol, side=side, ord_type=ord_type,
                order_qty=order_qty, leaves_qty=0,
                cum_qty=order_qty, avg_px=exec_price,
                last_px=exec_price, last_qty=order_qty,
                text="Exécuté via simulation market maker",
            )
            return report, {
                "statut":            "execute",
                "order_id":          order_id,
                "prix_execution":    exec_price,
                "quantite_executee": order_qty,
            }
        elif tif == TIF_IOC:
            report = build_exec_report(
                cl_ord_id=cl_ord_id, order_id=order_id,
                exec_type=EXEC_TYPE_CANCELED, ord_status=STATUS_CANCELED,
                symbol=symbol, side=side, ord_type=ord_type,
                order_qty=order_qty, leaves_qty=0, cum_qty=0, avg_px=0.0,
                price=price if price else None,
                text="IOC annulé — aucun ordre contrepartie disponible",
            )
            return report, {
                "statut": "annule",
                "raison": "IOC — aucune contrepartie disponible.",
            }
        else:
            # Ordre limite : repos dans le carnet
            if side == SIDE_BUY:
                book["bids"].append(new_order)
            else:
                book["asks"].append(new_order)
            _sort_book(book)
            report = build_exec_report(
                cl_ord_id=cl_ord_id, order_id=order_id,
                exec_type=EXEC_TYPE_NEW, ord_status=STATUS_NEW,
                symbol=symbol, side=side, ord_type=ord_type,
                order_qty=order_qty, leaves_qty=order_qty, cum_qty=0, avg_px=0.0,
                price=price,
                text="Ordre limite accepté et en attente dans le carnet",
            )
            return report, {
                "statut":   "en_attente",
                "order_id": order_id,
            }

    # ── Partiellement exécuté ─────────────────────────────────────────────────
    if cum_qty < order_qty:
        if tif == TIF_IOC:
            # Annuler le reste
            report = build_exec_report(
                cl_ord_id=cl_ord_id, order_id=order_id,
                exec_type=EXEC_TYPE_CANCELED, ord_status=STATUS_CANCELED,
                symbol=symbol, side=side, ord_type=ord_type,
                order_qty=order_qty, leaves_qty=0,
                cum_qty=cum_qty, avg_px=avg_px,
                last_px=last_px, last_qty=last_qty,
                price=price if price else None,
                text="IOC partiellement exécuté, reste annulé",
            )
        else:
            # Repos du reste dans le carnet
            rest = BookOrder(
                order_id=order_id, cl_ord_id=cl_ord_id,
                side=side, ord_type=ORD_TYPE_LIMIT,
                quantity=leaves_qty, price=price, tif=tif,
            )
            if side == SIDE_BUY:
                book["bids"].append(rest)
            else:
                book["asks"].append(rest)
            _sort_book(book)
            report = build_exec_report(
                cl_ord_id=cl_ord_id, order_id=order_id,
                exec_type=EXEC_TYPE_PARTIAL_FILL, ord_status=STATUS_PARTIAL_FILL,
                symbol=symbol, side=side, ord_type=ord_type,
                order_qty=order_qty, leaves_qty=leaves_qty,
                cum_qty=cum_qty, avg_px=avg_px,
                last_px=last_px, last_qty=last_qty,
                price=price if price else None,
                text="Partiellement exécuté, reste en attente dans le carnet",
            )
        return report, {
            "statut":            "partiellement_execute",
            "order_id":          order_id,
            "prix_execution":    round(avg_px, 2),
            "quantite_executee": cum_qty,
        }

    # ── Totalement exécuté ────────────────────────────────────────────────────
    report = build_exec_report(
        cl_ord_id=cl_ord_id, order_id=order_id,
        exec_type=EXEC_TYPE_FILL, ord_status=STATUS_FILLED,
        symbol=symbol, side=side, ord_type=ord_type,
        order_qty=order_qty, leaves_qty=0,
        cum_qty=cum_qty, avg_px=avg_px,
        last_px=last_px, last_qty=last_qty,
        price=price if price else None,
        text="Ordre totalement exécuté",
    )
    return report, {
        "statut":            "execute",
        "order_id":          order_id,
        "prix_execution":    round(avg_px, 2),
        "quantite_executee": cum_qty,
    }


def process_cancel(fix_msg: str) -> tuple[str, dict]:
    """
    Traite un FIX Order Cancel Request (35=F).
    Retire l'ordre du carnet et retourne un Execution Report ou Cancel Reject.
    """
    tags           = parse(fix_msg)
    order_id       = tags.get("37", "")
    cl_ord_id      = tags.get("11", "")
    orig_cl_ord_id = tags.get("41", "")
    symbol         = tags.get("55", "")
    side           = tags.get("54", SIDE_BUY)

    book     = _get_book(symbol)
    side_key = "bids" if side == SIDE_BUY else "asks"
    before   = len(book[side_key])
    book[side_key] = [o for o in book[side_key] if o.order_id != order_id]

    if len(book[side_key]) < before:
        report = build_exec_report(
            cl_ord_id=cl_ord_id, order_id=order_id,
            exec_type=EXEC_TYPE_CANCELED, ord_status=STATUS_CANCELED,
            symbol=symbol, side=side, ord_type=ORD_TYPE_LIMIT,
            order_qty=0, leaves_qty=0, cum_qty=0, avg_px=0.0,
            text="Ordre annulé sur demande du client",
        )
        return report, {"statut": "annule"}
    else:
        reject = build_cancel_reject(
            cl_ord_id=cl_ord_id,
            orig_cl_ord_id=orig_cl_ord_id,
            order_id=order_id,
            reason="Order not found in order book",
        )
        return reject, {"erreur": "Ordre introuvable dans le carnet (déjà exécuté ou annulé)."}


