"""
FIX 4.4 message builder and parser — simulation LSE (London Stock Exchange).

FIX (Financial Information eXchange) est le protocole standard de messagerie
pour le routage d'ordres entre brokers et marchés financiers.
Ce module implémente le sous-ensemble FIX 4.4 compatible LSE.

Références :
  - FIX Protocol 4.4 Specification (fixprotocol.org)
  - LSE Millennium Exchange Technical Specification
"""
import uuid
from datetime import datetime, timezone

# Séparateur de champs FIX (ASCII SOH = 0x01)
SOH = "\x01"

# ── Types de messages (Tag 35 = MsgType) ──────────────────────────────────────
MSG_NEW_ORDER     = "D"   # New Order Single
MSG_CANCEL_REQ    = "F"   # Order Cancel Request
MSG_REPLACE_REQ   = "G"   # Order Cancel/Replace Request
MSG_EXEC_REPORT   = "8"   # Execution Report
MSG_CANCEL_REJECT = "9"   # Order Cancel Reject

# ── Type d'ordre (Tag 40 = OrdType) ───────────────────────────────────────────
ORD_TYPE_MARKET = "1"   # Au marché
ORD_TYPE_LIMIT  = "2"   # À cours limité
ORD_TYPE_STOP   = "3"   # Stop

# ── Sens (Tag 54 = Side) ──────────────────────────────────────────────────────
SIDE_BUY  = "1"   # Achat
SIDE_SELL = "2"   # Vente

# ── Durée de validité (Tag 59 = TimeInForce) ──────────────────────────────────
TIF_DAY = "0"   # Valable la journée (défaut)
TIF_GTC = "1"   # Good Till Cancelled
TIF_IOC = "3"   # Immediate Or Cancel
TIF_FOK = "4"   # Fill Or Kill

# ── Statut ordre (Tag 39 = OrdStatus) ────────────────────────────────────────
STATUS_NEW          = "0"   # Nouveau / accepté
STATUS_PARTIAL_FILL = "1"   # Partiellement exécuté
STATUS_FILLED       = "2"   # Totalement exécuté
STATUS_CANCELED     = "4"   # Annulé
STATUS_REJECTED     = "8"   # Rejeté
STATUS_PENDING_NEW  = "A"   # En attente d'acceptation

# ── Type d'exécution (Tag 150 = ExecType) ─────────────────────────────────────
EXEC_TYPE_NEW          = "0"
EXEC_TYPE_PARTIAL_FILL = "1"
EXEC_TYPE_FILL         = "2"
EXEC_TYPE_CANCELED     = "4"
EXEC_TYPE_REJECTED     = "8"
EXEC_TYPE_PENDING_NEW  = "A"

# ── Identifiants des contreparties ────────────────────────────────────────────
SENDER_COMP_ID = "CFC_BOURSE"    # Broker (nous)
TARGET_COMP_ID = "LSE_GATEWAY"   # Passerelle de marché simulée


# ── Utilitaires internes ───────────────────────────────────────────────────────

def _timestamp() -> str:
    """Horodatage FIX format : YYYYMMDD-HH:MM:SS.mmm (UTC)."""
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H:%M:%S.%f")[:-3]


def _checksum(raw: str) -> str:
    """Checksum FIX : somme des valeurs ASCII modulo 256, sur 3 chiffres."""
    return str(sum(ord(c) for c in raw) % 256).zfill(3)


def _seq_num() -> str:
    """Numéro de séquence FIX simulé (pseudo-aléatoire pour le POC)."""
    return str(uuid.uuid4().int % 1_000_000).zfill(6)


def _build(msg_type: str, fields: dict[str, str]) -> str:
    """
    Assemble un message FIX 4.4 complet :
    BeginString + BodyLength + header + body + CheckSum.
    """
    header = {
        "35": msg_type,
        "49": SENDER_COMP_ID,
        "56": TARGET_COMP_ID,
        "34": _seq_num(),
        "52": _timestamp(),
    }
    body = ""
    for tag, val in {**header, **fields}.items():
        body += f"{tag}={val}{SOH}"

    prefix = f"8=FIX.4.4{SOH}9={len(body)}{SOH}"
    full   = prefix + body
    return full + f"10={_checksum(full)}{SOH}"


# ── Parseur ────────────────────────────────────────────────────────────────────

def parse(fix_msg: str) -> dict[str, str]:
    """
    Parse un message FIX et retourne un dict {tag: valeur}.

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


# ── Constructeurs de messages ─────────────────────────────────────────────────

def build_new_order(
    cl_ord_id: str,
    symbol: str,
    side: str,
    ord_type: str,
    quantity: int,
    price: float | None = None,
    time_in_force: str = TIF_DAY,
) -> str:
    """
    Construit un message FIX New Order Single (35=D).

    Tags principaux :
      11=ClOrdID    21=HandlInst   55=Symbol
      54=Side       38=OrderQty    40=OrdType
      44=Price      59=TimeInForce 60=TransactTime
    """
    fields: dict[str, str] = {
        "11": cl_ord_id,
        "21": "1",            # HandlInst : exécution automatique, sans intervention
        "55": symbol,
        "54": side,
        "38": str(quantity),
        "40": ord_type,
        "59": time_in_force,
        "60": _timestamp(),
    }
    if ord_type == ORD_TYPE_LIMIT and price is not None:
        fields["44"] = f"{price:.4f}"
    return _build(MSG_NEW_ORDER, fields)


def build_cancel_request(
    orig_cl_ord_id: str,
    cl_ord_id: str,
    order_id: str,
    symbol: str,
    side: str,
    quantity: int,
) -> str:
    """
    Construit un message FIX Order Cancel Request (35=F).

    Tags principaux :
      41=OrigClOrdID   11=ClOrdID   37=OrderID
      55=Symbol        54=Side      38=OrderQty
    """
    return _build(MSG_CANCEL_REQ, {
        "41": orig_cl_ord_id,
        "11": cl_ord_id,
        "37": order_id,
        "55": symbol,
        "54": side,
        "38": str(quantity),
        "60": _timestamp(),
    })


def build_exec_report(
    cl_ord_id: str,
    order_id: str,
    exec_type: str,
    ord_status: str,
    symbol: str,
    side: str,
    ord_type: str,
    order_qty: int,
    leaves_qty: int,
    cum_qty: int,
    avg_px: float,
    last_px: float = 0.0,
    last_qty: int = 0,
    price: float | None = None,
    text: str = "",
) -> str:
    """
    Construit un FIX Execution Report (35=8).

    Tags principaux :
      17=ExecID   150=ExecType   39=OrdStatus
      37=OrderID  11=ClOrdID     55=Symbol
      54=Side     38=OrderQty    31=LastPx
      32=LastQty  14=CumQty      151=LeavesQty
      6=AvgPx     58=Text
    """
    fields: dict[str, str] = {
        "17":  str(uuid.uuid4()),
        "20":  "0",             # ExecTransType : New
        "150": exec_type,
        "39":  ord_status,
        "11":  cl_ord_id,
        "37":  order_id,
        "55":  symbol,
        "54":  side,
        "40":  ord_type,
        "38":  str(order_qty),
        "32":  str(last_qty),
        "31":  f"{last_px:.4f}",
        "14":  str(cum_qty),
        "151": str(leaves_qty),
        "6":   f"{avg_px:.4f}",
        "60":  _timestamp(),
    }
    if price is not None:
        fields["44"] = f"{price:.4f}"
    if text:
        fields["58"] = text
    return _build(MSG_EXEC_REPORT, fields)


def build_cancel_reject(
    cl_ord_id: str,
    orig_cl_ord_id: str,
    order_id: str,
    reason: str,
) -> str:
    """
    Construit un FIX Order Cancel Reject (35=9).

    Tags principaux :
      37=OrderID   11=ClOrdID   41=OrigClOrdID
      102=CxlRejReason          58=Text
    """
    return _build(MSG_CANCEL_REJECT, {
        "37":  order_id,
        "11":  cl_ord_id,
        "41":  orig_cl_ord_id,
        "39":  STATUS_REJECTED,
        "102": "1",             # CxlRejReason : Unknown Order
        "58":  reason,
        "60":  _timestamp(),
    })
