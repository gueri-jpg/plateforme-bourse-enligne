"""
Tests de la couche FIX Protocol (fix_messages + fix_engine).
Exécuter : python test_fix.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

# ─────────────────────────────────────────────────────────────────────────────
# Patch pour éviter d'importer les dépendances FastAPI/DB (tests unitaires)
# ─────────────────────────────────────────────────────────────────────────────
import types

# Stub minimal pour app.services.fix_messages (import direct, pas besoin de stub)
# Stub pour les imports relatifs dans fix_engine
app_mod = types.ModuleType("app")
app_mod.services = types.ModuleType("app.services")
sys.modules["app"] = app_mod
sys.modules["app.services"] = app_mod.services

# Importer fix_messages directement
import importlib.util

def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod  = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod

BASE = os.path.dirname(__file__)

fix_msg = load_module(
    "app.services.fix_messages",
    os.path.join(BASE, "app", "services", "fix_messages.py"),
)
fix_eng = load_module(
    "app.services.fix_engine",
    os.path.join(BASE, "app", "services", "fix_engine.py"),
)

# ─────────────────────────────────────────────────────────────────────────────

OK   = "\033[92m✓\033[0m"
FAIL = "\033[91m✗\033[0m"
HEAD = "\033[94m"
END  = "\033[0m"

passed = 0
failed = 0

def check(label, condition, details=""):
    global passed, failed
    if condition:
        print(f"  {OK} {label}")
        passed += 1
    else:
        print(f"  {FAIL} {label}")
        if details:
            print(f"      → {details}")
        failed += 1

TRADER_GROUP = "compte-test-001"

# ═════════════════════════════════════════════════════════════════════════════
# 1. Tests fix_messages.py
# ═════════════════════════════════════════════════════════════════════════════
print(f"\n{HEAD}── 1. fix_messages.py — Constructeurs FIX 5.0/FIXT.1.1 ────────────{END}")

# New Order Single (35=D) - ordre limite
msg_d = fix_msg.build_new_order(
    cl_ord_id="TEST-001", trader_group_id=TRADER_GROUP, symbol="ATW",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_LIMIT,
    quantity=100, price=490.0, time_in_force=fix_msg.TIF_DAY,
)
tags_d  = fix_msg.parse(msg_d)
party_d = fix_msg.parse_party_ids(msg_d)

check("MsgType = D (New Order Single)",    tags_d.get("35") == "D")
check("BeginString = FIXT.1.1",            tags_d.get("8")  == "FIXT.1.1")
check("ApplVerID = 9 (FIX50SP2)",          tags_d.get("1128") == "9")
check("SenderCompID = CFC_BOURSE",         tags_d.get("49") == "CFC_BOURSE")
check("TargetCompID = LSE_GATEWAY",        tags_d.get("56") == "LSE_GATEWAY")
check("SecurityID (48) = ATW",             tags_d.get("48") == "ATW")
check("SecurityIDSource (22) = 8",         tags_d.get("22") == "8")
check("Side = 1 (achat)",                  tags_d.get("54") == "1")
check("OrderQty = 100",                    tags_d.get("38") == "100")
check("OrdType = 2 (limite)",              tags_d.get("40") == "2")
check("Price = 490.0000",                  tags_d.get("44") == "490.0000")
check("TimeInForce = 0 (Day)",             tags_d.get("59") == "0")
check("OrderCapacity = A (AOTC)",          tags_d.get("528") == "A")
check("AccountType = 1 (Client)",          tags_d.get("581") == "1")
check("DisplayQty (1138) = OrderQty (pas d'iceberg)", tags_d.get("1138") == "100")
check("HandlInst (21) absent — hors spec MIT202 6.4.1", "21" not in tags_d)
check("ClOrdID présent",                   bool(tags_d.get("11")))
check("CheckSum présent (tag 10)",         bool(tags_d.get("10")))
check("PartyID Trader Group (76) = compte", party_d.get(fix_msg.PARTY_ROLE_TRADER_GROUP) == TRADER_GROUP)
check("PartyID Client ID (3) = None (0)",   party_d.get(fix_msg.PARTY_ROLE_CLIENT_ID) == "0")
check("PartyID Executing Trader (12) = CLIENT (3)",
      party_d.get(fix_msg.PARTY_ROLE_EXECUTING_TRADER) == "3")

# New Order Single - ordre marché (pas de tag 44)
msg_mkt = fix_msg.build_new_order(
    cl_ord_id="TEST-002", trader_group_id=TRADER_GROUP, symbol="IAM",
    side=fix_msg.SIDE_SELL, ord_type=fix_msg.ORD_TYPE_MARKET,
    quantity=50,
)
tags_mkt = fix_msg.parse(msg_mkt)
check("Ordre marché : OrdType = 1",        tags_mkt.get("40") == "1")
check("Ordre marché : pas de tag 44",      "44" not in tags_mkt)
check("Ordre marché : Side = 2 (vente)",   tags_mkt.get("54") == "2")

# Numéros de séquence réels et croissants (section 4.2.1)
msg_a = fix_msg.build_new_order(
    cl_ord_id="SEQ-A", trader_group_id=TRADER_GROUP, symbol="ATW",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_MARKET, quantity=1,
)
msg_b = fix_msg.build_new_order(
    cl_ord_id="SEQ-B", trader_group_id=TRADER_GROUP, symbol="ATW",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_MARKET, quantity=1,
)
seq_a = int(fix_msg.parse(msg_a)["34"])
seq_b = int(fix_msg.parse(msg_b)["34"])
check("MsgSeqNum (34) incrémente réellement entre deux messages sortants", seq_b == seq_a + 1)

# Order Cancel Request (35=F)
msg_f = fix_msg.build_cancel_request(
    orig_cl_ord_id="TEST-001", cl_ord_id="TEST-003",
    order_id="order-uuid-001", trader_group_id=TRADER_GROUP,
    symbol="ATW", side=fix_msg.SIDE_BUY,
)
tags_f = fix_msg.parse(msg_f)
check("Cancel Request : MsgType = F",      tags_f.get("35") == "F")
check("Cancel Request : OrigClOrdID (41)", tags_f.get("41") == "TEST-001")
check("Cancel Request : OrderID (37)",     tags_f.get("37") == "order-uuid-001")
check("Cancel Request : SecurityID (48)",  tags_f.get("48") == "ATW")

# Order Cancel/Replace Request (35=G)
msg_g = fix_msg.build_replace_request(
    orig_cl_ord_id="TEST-001", cl_ord_id="TEST-004",
    order_id="order-uuid-001", trader_group_id=TRADER_GROUP,
    symbol="ATW", side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_LIMIT,
    order_qty=150, price=493.0,
)
tags_g = fix_msg.parse(msg_g)
check("Replace Request : MsgType = G",     tags_g.get("35") == "G")
check("Replace Request : OrderQty = 150",  tags_g.get("38") == "150")
check("Replace Request : Price = 493.0000", tags_g.get("44") == "493.0000")

# Order Mass Cancel Request (35=q)
msg_q = fix_msg.build_mass_cancel_request(
    cl_ord_id="TEST-005", mass_cancel_request_type=fix_msg.MASS_CANCEL_ALL_ORDERS,
    trader_group_id=TRADER_GROUP,
)
tags_q = fix_msg.parse(msg_q)
check("Mass Cancel Request : MsgType = q", tags_q.get("35") == "q")
check("Mass Cancel Request : 530 = 7 (All Orders)", tags_q.get("530") == "7")
check("Mass Cancel Request : TargetPartyID (1462)", tags_q.get("1462") == TRADER_GROUP)

# Parseur
raw = "8=FIXT.1.1\x019=50\x0135=D\x0154=1\x0138=200\x01"
parsed = fix_msg.parse(raw)
check("parse() : tag 35 = D",             parsed.get("35") == "D")
check("parse() : tag 54 = 1",             parsed.get("54") == "1")
check("parse() : tag 38 = 200",           parsed.get("38") == "200")

# ═════════════════════════════════════════════════════════════════════════════
# 2. Tests fix_engine.py
# ═════════════════════════════════════════════════════════════════════════════
print(f"\n{HEAD}── 2. fix_engine.py — Moteur de matching ───────────────────────────{END}")

# Forcer la phase CONTINUOUS pour les tests
original_phase = fix_eng.get_market_phase
fix_eng.get_market_phase = lambda: fix_eng.MarketPhase.CONTINUOUS

def _new_order(cl_ord_id, symbol, side, ord_type, quantity, price=None, tif=fix_msg.TIF_DAY, trader=TRADER_GROUP):
    return fix_msg.build_new_order(
        cl_ord_id=cl_ord_id, trader_group_id=trader, symbol=symbol,
        side=side, ord_type=ord_type, quantity=quantity, price=price, time_in_force=tif,
    )

# ── Test 2.1 : Ordre limite sans contrepartie → en_attente ──────────────────
print("\n  Scénario A — Ordre limite sans contrepartie (en_attente dans le carnet)")
fix_eng._ORDER_BOOK.clear()

msg = _new_order("A-001", "TEST1", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, 100, price=490.0)
_, result = fix_eng.process_new_order(msg)
check("Statut = en_attente",              result["statut"] == "en_attente", str(result))
check("Ordre dans le carnet (bids)",      len(fix_eng._ORDER_BOOK.get("TEST1", {}).get("bids", [])) == 1)

# ── Test 2.2 : Ordre au marché → simulation market maker (execute) ───────────
print("\n  Scénario B — Ordre au marché → exécution market maker")
fix_eng._ORDER_BOOK.clear()

msg = _new_order("B-001", "TEST2", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_MARKET, 50)
# Injecter le prix marché via tag 99
msg = msg.rstrip("\x01") + "\x0199=1250.0000\x01"
_, result = fix_eng.process_new_order(msg)
check("Statut = execute (market maker)",  result["statut"] == "execute", str(result))
check("Prix exécution = 1250.0",          result.get("prix_execution") == 1250.0)
check("Quantité exécutée = 50",           result.get("quantite_executee") == 50)

# ── Test 2.3 : Matching acheteur / vendeur ───────────────────────────────────
print("\n  Scénario C — Matching acheteur ↔ vendeur (exécution croisée)")
fix_eng._ORDER_BOOK.clear()

msg_ask = _new_order("C-SELL", "TEST3", fix_msg.SIDE_SELL, fix_msg.ORD_TYPE_LIMIT, 80, price=492.0)
_, r_ask = fix_eng.process_new_order(msg_ask)
check("Ask en attente dans le carnet",    r_ask["statut"] == "en_attente", str(r_ask))
check("Carnet asks non vide",             len(fix_eng._ORDER_BOOK.get("TEST3", {}).get("asks", [])) == 1)

msg_bid = _new_order("C-BUY", "TEST3", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, 80, price=495.0)
report_bid, r_bid = fix_eng.process_new_order(msg_bid)
check("Acheteur : statut = execute",      r_bid["statut"] == "execute", str(r_bid))
check("Prix exécution = 492.0 (resting)", r_bid.get("prix_execution") == 492.0)
check("Quantité exécutée = 80",           r_bid.get("quantite_executee") == 80)
check("Carnet asks vidé après match",     len(fix_eng._ORDER_BOOK.get("TEST3", {}).get("asks", [])) == 0)

tags_exec = fix_msg.parse(report_bid)
check("Exec Report (Trade) : AvgPx (6) absent — hors spec 6.4.5", "6" not in tags_exec)
check("Exec Report : MDEntryID (278) présent (Public Order ID)", tags_exec.get("278") == r_bid["order_id"])
check("Exec Report : GroupID (27017) présent",   tags_exec.get("27017") == "0")
check("Exec Report (Trade) : TradeMatchID/TVTIC (880) présent", bool(tags_exec.get("880")))
check("Exec Report (Trade) : LastMkt (30) présent",             tags_exec.get("30") == "XLON")
check("Exec Report (Trade) : TradeLiquidityIndicator (9730)",   tags_exec.get("9730") == "R")

# ── Test 2.4 : Exécution partielle ──────────────────────────────────────────
print("\n  Scénario D — Exécution partielle (asks insuffisants)")
fix_eng._ORDER_BOOK.clear()

msg_ask = _new_order("D-SELL", "TEST4", fix_msg.SIDE_SELL, fix_msg.ORD_TYPE_LIMIT, 30, price=500.0)
fix_eng.process_new_order(msg_ask)

msg_bid = _new_order("D-BUY", "TEST4", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, 100, price=502.0)
_, r_partial = fix_eng.process_new_order(msg_bid)
check("Statut = partiellement_execute",   r_partial["statut"] == "partiellement_execute", str(r_partial))
check("Quantité exécutée = 30",           r_partial.get("quantite_executee") == 30)
check("Prix exécution = 500.0",           r_partial.get("prix_execution") == 500.0)
check("Reste (70) dans les bids",         len(fix_eng._ORDER_BOOK.get("TEST4", {}).get("bids", [])) == 1)

# ── Test 2.5 : FOK annulé ───────────────────────────────────────────────────
print("\n  Scénario E — FOK annulé (liquidité insuffisante)")
fix_eng._ORDER_BOOK.clear()

msg_ask = _new_order("E-SELL", "TEST5", fix_msg.SIDE_SELL, fix_msg.ORD_TYPE_LIMIT, 20, price=300.0)
fix_eng.process_new_order(msg_ask)

msg_fok = _new_order("E-BUY-FOK", "TEST5", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, 100,
                      price=305.0, tif=fix_msg.TIF_FOK)
_, r_fok = fix_eng.process_new_order(msg_fok)
check("FOK : statut = annule",            r_fok["statut"] == "annule", str(r_fok))
check("FOK : ask restauré dans le carnet", len(fix_eng._ORDER_BOOK.get("TEST5", {}).get("asks", [])) == 1)

# ── Test 2.6 : Annulation d'un ordre ────────────────────────────────────────
print("\n  Scénario F — Annulation d'un ordre en attente")
fix_eng._ORDER_BOOK.clear()

msg_lim = _new_order("F-001", "TEST6", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, 50, price=450.0)
_, r_placed = fix_eng.process_new_order(msg_lim)
order_id_placed = r_placed.get("order_id")
check("Ordre placé en attente",           r_placed["statut"] == "en_attente")

msg_cancel = fix_msg.build_cancel_request(
    orig_cl_ord_id="F-001", cl_ord_id="F-002",
    order_id=order_id_placed, trader_group_id=TRADER_GROUP,
    symbol="TEST6", side=fix_msg.SIDE_BUY,
)
_, r_cancel = fix_eng.process_cancel(msg_cancel)
check("Ordre annulé via 35=F",            r_cancel.get("statut") == "annule", str(r_cancel))
check("Carnet vide après annulation",     len(fix_eng._ORDER_BOOK.get("TEST6", {}).get("bids", [])) == 0)

# ── Test 2.7 : Rejet si marché fermé (ordre marché) ─────────────────────────
print("\n  Scénario G — Rejet ordre marché hors séance")
fix_eng.get_market_phase = lambda: fix_eng.MarketPhase.CLOSED

msg_mkt = _new_order("G-001", "TEST7", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_MARKET, 10)
msg_mkt = msg_mkt.rstrip("\x01") + "\x0199=500.0\x01"
_, r_rej = fix_eng.process_new_order(msg_mkt)
check("Rejeté si marché fermé",           r_rej["statut"] == "rejete", str(r_rej))
check("Message d'erreur présent",         "raison" in r_rej)

# ── Test 2.8 : Snapshot carnet d'ordres ─────────────────────────────────────
print("\n  Scénario H — Snapshot carnet d'ordres")
fix_eng.get_market_phase = lambda: fix_eng.MarketPhase.CONTINUOUS
fix_eng._ORDER_BOOK.clear()

for price, qty, cl_id in [(490, 100, "H-1"), (492, 50, "H-2"), (488, 200, "H-3")]:
    m = _new_order(cl_id, "ATW", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, qty, price=float(price))
    fix_eng.process_new_order(m)

snapshot = fix_eng.get_order_book_snapshot("ATW")
bids = snapshot["bids"]
check("Snapshot : 3 bids présents",       len(bids) == 3)
check("Priorité prix : bid[0].prix = 492", bids[0]["prix"] == 492.0)
check("Priorité prix : bid[1].prix = 490", bids[1]["prix"] == 490.0)
check("Priorité prix : bid[2].prix = 488", bids[2]["prix"] == 488.0)
check("Snapshot contient phase de marché", "phase" in snapshot)

# ── Test 2.9 : Cancel/Replace — amendement sans croisement ─────────────────
print("\n  Scénario I — Order Cancel/Replace (35=G) : réduction de quantité, priorité conservée")
fix_eng._ORDER_BOOK.clear()

msg_orig = _new_order("I-001", "TEST9", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, 100, price=490.0)
_, r_orig = fix_eng.process_new_order(msg_orig)
order_id_i = r_orig["order_id"]
ts_before  = fix_eng._ORDER_BOOK["TEST9"]["bids"][0].timestamp

msg_replace = fix_msg.build_replace_request(
    orig_cl_ord_id="I-001", cl_ord_id="I-002", order_id=order_id_i,
    trader_group_id=TRADER_GROUP, symbol="TEST9", side=fix_msg.SIDE_BUY,
    ord_type=fix_msg.ORD_TYPE_LIMIT, order_qty=60, price=490.0,
)
_, r_replace = fix_eng.process_replace(msg_replace)
check("Replace : statut = en_attente",    r_replace["statut"] == "en_attente", str(r_replace))
bids_after = fix_eng._ORDER_BOOK["TEST9"]["bids"]
check("Replace : quantité réduite à 60",  bids_after[0].quantity == 60)
check("Replace : priorité temps conservée (réduction seule)", bids_after[0].timestamp == ts_before)

# ── Test 2.9b : Cancel/Replace — rejet si nouvelle quantité < déjà exécutée ──
print("\n  Scénario I2 — Order Cancel/Replace (35=G) : rejet si OrderQty < CumQty déjà exécuté")
fix_eng._ORDER_BOOK.clear()

msg_ask2 = _new_order("I2-SELL", "TEST9B", fix_msg.SIDE_SELL, fix_msg.ORD_TYPE_LIMIT, 60, price=490.0)
fix_eng.process_new_order(msg_ask2)
msg_bid2 = _new_order("I2-BUY", "TEST9B", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, 100, price=490.0)
_, r_bid2 = fix_eng.process_new_order(msg_bid2)
check("Setup : 60/100 déjà exécutés",      r_bid2["statut"] == "partiellement_execute", str(r_bid2))
order_id_i2 = r_bid2["order_id"]

msg_replace_bad = fix_msg.build_replace_request(
    orig_cl_ord_id="I2-BUY", cl_ord_id="I2-REPL", order_id=order_id_i2,
    trader_group_id=TRADER_GROUP, symbol="TEST9B", side=fix_msg.SIDE_BUY,
    ord_type=fix_msg.ORD_TYPE_LIMIT, order_qty=20, price=490.0,
)
reject_msg, r_replace_bad = fix_eng.process_replace(msg_replace_bad)
check("Replace : rejeté (20 < 60 déjà exécuté)", "erreur" in r_replace_bad, str(r_replace_bad))
bids_i2 = fix_eng._ORDER_BOOK["TEST9B"]["bids"]
check("Replace rejeté : ordre inchangé dans le carnet (quantity=100)",
      bids_i2[0].quantity == 100 if bids_i2 else False)
tags_reject = fix_msg.parse(reject_msg)
check("Order Cancel Reject : TransactTime (60) absent — hors spec 6.4.6", "60" not in tags_reject)

# ── Test 2.9c : Cancel/Replace valide sans nouveau croisement → pas de ──────
# ré-application d'une exécution déjà comptabilisée (bug trouvé en démo réelle)
print("\n  Scénario I3 — Order Cancel/Replace (35=G) : réduction valide sans nouveau croisement")
msg_replace_ok = fix_msg.build_replace_request(
    orig_cl_ord_id="I2-BUY", cl_ord_id="I2-REPL2", order_id=order_id_i2,
    trader_group_id=TRADER_GROUP, symbol="TEST9B", side=fix_msg.SIDE_BUY,
    ord_type=fix_msg.ORD_TYPE_LIMIT, order_qty=70, price=490.0,
)
_, r_replace_ok = fix_eng.process_replace(msg_replace_ok)
check("Replace valide : statut = partiellement_execute", r_replace_ok["statut"] == "partiellement_execute", str(r_replace_ok))
check("Replace valide : pas de NOUVELLE exécution (prix_execution=None)",
      r_replace_ok.get("prix_execution") is None, str(r_replace_ok))
check("Replace valide : pas de NOUVELLE exécution (quantite_executee=None)",
      r_replace_ok.get("quantite_executee") is None, str(r_replace_ok))

# ── Test 2.10 : Cancel/Replace — prix relevé, déclenche une exécution ──────
print("\n  Scénario J — Order Cancel/Replace (35=G) : prix relevé croise le carnet")
fix_eng._ORDER_BOOK.clear()

msg_ask = _new_order("J-SELL", "TEST10", fix_msg.SIDE_SELL, fix_msg.ORD_TYPE_LIMIT, 50, price=500.0)
fix_eng.process_new_order(msg_ask)

msg_bid = _new_order("J-BUY", "TEST10", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, 50, price=495.0)
_, r_bid = fix_eng.process_new_order(msg_bid)
order_id_j = r_bid["order_id"]
check("Bid initial en attente (ne croise pas)", r_bid["statut"] == "en_attente", str(r_bid))

msg_replace_up = fix_msg.build_replace_request(
    orig_cl_ord_id="J-BUY", cl_ord_id="J-REPL", order_id=order_id_j,
    trader_group_id=TRADER_GROUP, symbol="TEST10", side=fix_msg.SIDE_BUY,
    ord_type=fix_msg.ORD_TYPE_LIMIT, order_qty=50, price=501.0,
)
_, r_replace_up = fix_eng.process_replace(msg_replace_up)
check("Replace : exécuté après remontée du prix", r_replace_up["statut"] == "execute", str(r_replace_up))
check("Replace : prix d'exécution = 500.0 (resting)", r_replace_up.get("prix_execution") == 500.0)

# ── Test 2.11 : Mass Cancel — tous les ordres du compte ────────────────────
print("\n  Scénario K — Order Mass Cancel Request (35=q) : tous les ordres du compte")
fix_eng._ORDER_BOOK.clear()

fix_eng.process_new_order(_new_order("K-1", "ATW", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, 10, price=100.0))
fix_eng.process_new_order(_new_order("K-2", "IAM", fix_msg.SIDE_SELL, fix_msg.ORD_TYPE_LIMIT, 20, price=200.0))
fix_eng.process_new_order(_new_order("K-3", "ATW", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, 5, price=99.0, trader="autre-compte"))

msg_mass = fix_msg.build_mass_cancel_request(
    cl_ord_id="K-MASS", mass_cancel_request_type=fix_msg.MASS_CANCEL_ALL_ORDERS,
    trader_group_id=TRADER_GROUP,
)
messages_mass, r_mass = fix_eng.process_mass_cancel(msg_mass)
check("Mass Cancel : 2 ordres annulés (pas celui d'un autre compte)", len(r_mass["order_ids"]) == 2, str(r_mass))
check("Mass Cancel : l'ordre d'un autre compte reste dans le carnet",
      len(fix_eng._ORDER_BOOK["ATW"]["bids"]) == 1)

# 2.1.2.2 : le Mass Cancel Report doit être suivi d'un Execution Report par
# ordre annulé, avec ClOrdID = celui de la requête Mass Cancel elle-même.
check("Mass Cancel : messages = 1 Mass Cancel Report + 2 Execution Reports",
      len(messages_mass) == 3, str(messages_mass))
tags_mass_report = fix_msg.parse(messages_mass[0])
check("Mass Cancel : messages[0] = Mass Cancel Report (35=r)", tags_mass_report.get("35") == "r")
for exec_msg in messages_mass[1:]:
    tags_exec_mass = fix_msg.parse(exec_msg)
    check("Mass Cancel : Execution Report (35=8) avec ClOrdID = celui du Mass Cancel",
          tags_exec_mass.get("35") == "8" and tags_exec_mass.get("11") == "K-MASS", str(tags_exec_mass))

# ── Test 2.12 : Ordre Stop — déclenchement par franchissement de StopPx ─────
print("\n  Scénario L — Ordre Stop (déclenchement par franchissement de StopPx)")
fix_eng._ORDER_BOOK.clear()
fix_eng._LAST_TRADE_PX.clear()

fix_eng.process_new_order(_new_order("L-SELL0", "TEST11", fix_msg.SIDE_SELL, fix_msg.ORD_TYPE_LIMIT, 100, price=500.0))
_, r_l0 = fix_eng.process_new_order(_new_order("L-BUY0", "TEST11", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, 100, price=500.0))
check("Setup : premier prix négocié = 500.0", fix_eng._LAST_TRADE_PX.get("TEST11") == 500.0, str(r_l0))

msg_stop = fix_msg.build_new_order(
    cl_ord_id="L-STOP", trader_group_id=TRADER_GROUP, symbol="TEST11",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_STOP, quantity=50,
    stop_px=505.0,
)
_, r_stop = fix_eng.process_new_order(msg_stop)
check("Stop : accepté, en attente de déclenchement", r_stop["statut"] == "en_attente", str(r_stop))
stop_orders = [o for o in fix_eng._ORDER_BOOK["TEST11"]["bids"] if o.order_id == r_stop["order_id"]]
check("Stop : présent dans le carnet, non déclenché (triggered=False)",
      len(stop_orders) == 1 and stop_orders[0].triggered is False)

fix_eng.process_new_order(_new_order("L-SELL1", "TEST11", fix_msg.SIDE_SELL, fix_msg.ORD_TYPE_LIMIT, 20, price=506.0))
_, r_l1 = fix_eng.process_new_order(_new_order("L-BUY1", "TEST11", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, 20, price=506.0))
annexes_l = r_l1.get("evenements_annexes", [])
stop_annex = next((a for a in annexes_l if a["order_id"] == r_stop["order_id"]), None)
check("Stop : déclenché et exécuté (annexe présente, simulation market maker)",
      stop_annex is not None and stop_annex["statut"] == "execute", str(annexes_l))

# ── Test 2.13 : Iceberg (Fixed Peak) — clip visible et réapprovisionnement ──
print("\n  Scénario M — Iceberg (Fixed Peak) : clip visible et réapprovisionnement")
fix_eng._ORDER_BOOK.clear()

msg_iceberg = fix_msg.build_new_order(
    cl_ord_id="M-ICE", trader_group_id=TRADER_GROUP, symbol="TEST12",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_LIMIT, quantity=100,
    price=500.0, display_qty=20,
)
_, r_ice = fix_eng.process_new_order(msg_iceberg)
check("Iceberg : accepté en attente", r_ice["statut"] == "en_attente", str(r_ice))
ice_order = fix_eng._ORDER_BOOK["TEST12"]["bids"][0]
check("Iceberg : clip initial = 20 (display_qty)", ice_order.clip_remaining == 20)
snap_ice = fix_eng.get_order_book_snapshot("TEST12")
check("Iceberg : snapshot affiche 20 (pas 100)", snap_ice["bids"][0]["quantite"] == 20)
ts_ice_before = ice_order.timestamp

fix_eng.process_new_order(_new_order("M-SELL1", "TEST12", fix_msg.SIDE_SELL, fix_msg.ORD_TYPE_LIMIT, 15, price=500.0))
check("Iceberg : clip réduit à 5 après un fill de 15", ice_order.clip_remaining == 5)

fix_eng.process_new_order(_new_order("M-SELL2", "TEST12", fix_msg.SIDE_SELL, fix_msg.ORD_TYPE_LIMIT, 10, price=500.0))
check("Iceberg : clip réapprovisionné à 20 après épuisement", ice_order.clip_remaining == 20)
check("Iceberg : leaves_qty = 75 après 25 exécutés au total", ice_order.leaves_qty == 75)
check("Iceberg : réapprovisionnement fait perdre la priorité (nouveau timestamp)",
      ice_order.timestamp > ts_ice_before)

# ── Test 2.14 : Hidden — absent du snapshot, participe au matching ─────────
print("\n  Scénario N — Hidden : absent du snapshot mais participe au matching")
fix_eng._ORDER_BOOK.clear()

msg_hidden = fix_msg.build_new_order(
    cl_ord_id="N-HID", trader_group_id=TRADER_GROUP, symbol="TEST13",
    side=fix_msg.SIDE_SELL, ord_type=fix_msg.ORD_TYPE_LIMIT, quantity=40,
    price=510.0, display_qty=0, display_method=fix_msg.DISPLAY_METHOD_HIDDEN,
)
_, r_hid = fix_eng.process_new_order(msg_hidden)
check("Hidden : accepté en attente", r_hid["statut"] == "en_attente", str(r_hid))
snap_hid = fix_eng.get_order_book_snapshot("TEST13")
check("Hidden : absent du snapshot (asks vide)", len(snap_hid["asks"]) == 0)

_, r_hid_match = fix_eng.process_new_order(
    _new_order("N-BUY", "TEST13", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, 40, price=510.0)
)
check("Hidden : participe quand même au matching (execute)", r_hid_match["statut"] == "execute", str(r_hid_match))

# ── Test 2.15 : Pegged — prix au midpoint du BBO + MES (MinQty) ────────────
print("\n  Scénario O — Ordre Pegged : prix au midpoint du BBO + MES (MinQty)")
fix_eng._ORDER_BOOK.clear()

fix_eng.process_new_order(_new_order("O-SELL0", "TEST14", fix_msg.SIDE_SELL, fix_msg.ORD_TYPE_LIMIT, 100, price=502.0))
fix_eng.process_new_order(_new_order("O-BUY0", "TEST14", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, 100, price=498.0))

msg_pegged = fix_msg.build_new_order(
    cl_ord_id="O-PEG", trader_group_id=TRADER_GROUP, symbol="TEST14",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_PEGGED, quantity=50,
    min_qty=30,
)
_, r_peg = fix_eng.process_new_order(msg_pegged)
check("Pegged : accepté en attente", r_peg["statut"] == "en_attente", str(r_peg))
peg_order = next(o for o in fix_eng._ORDER_BOOK["TEST14"]["bids"] if o.order_id == r_peg["order_id"])
check("Pegged : prix = midpoint(498, 502) = 500.0", peg_order.price == 500.0, str(peg_order.price))

_, r_small_sell = fix_eng.process_new_order(
    _new_order("O-SELL-SMALL", "TEST14", fix_msg.SIDE_SELL, fix_msg.ORD_TYPE_LIMIT, 10, price=500.0)
)
check("Pegged/MES : fill sous MinQty(30) refusé (vendeur reste en attente)",
      r_small_sell["statut"] == "en_attente", str(r_small_sell))
check("Pegged : quantité inchangée après le fill refusé (toujours 50)", peg_order.leaves_qty == 50)

_, r_big_sell = fix_eng.process_new_order(
    _new_order("O-SELL-BIG", "TEST14", fix_msg.SIDE_SELL, fix_msg.ORD_TYPE_LIMIT, 40, price=500.0)
)
check("Pegged/MES : fill >= MinQty accepté (vendeur exécuté)", r_big_sell["statut"] == "execute", str(r_big_sell))
check("Pegged : leaves_qty = 10 après le fill de 40", peg_order.leaves_qty == 10)

# ── Test 2.16 : Offset — prix = DRP ± DRP×Offset (2.1.1.2) ─────────────────
print("\n  Scénario P — Ordre Offset : prix = DRP ± DRP×Offset (2.1.1.2)")
fix_eng._ORDER_BOOK.clear()
fix_eng._LAST_TRADE_PX.clear()

fix_eng.process_new_order(_new_order("P-SELL0", "TEST15", fix_msg.SIDE_SELL, fix_msg.ORD_TYPE_LIMIT, 10, price=400.0))
fix_eng.process_new_order(_new_order("P-BUY0", "TEST15", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, 10, price=400.0))
check("Setup : DRP approximé (dernier prix négocié) = 400.0", fix_eng._LAST_TRADE_PX.get("TEST15") == 400.0)

msg_offset = fix_msg.build_new_order(
    cl_ord_id="P-OFFSET", trader_group_id=TRADER_GROUP, symbol="TEST15",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_OFFSET, quantity=20,
    time_in_force=fix_msg.TIF_ATC, offset_bp=100.0,
)
_, r_offset = fix_eng.process_new_order(msg_offset)
check("Offset : accepté en attente", r_offset["statut"] == "en_attente", str(r_offset))
offset_order = fix_eng._ORDER_BOOK["TEST15"]["bids"][0]
check("Offset : prix = DRP + DRP×1% = 404.0 (BUY, offset positif)", offset_order.price == 404.0, str(offset_order.price))

# ── Test 2.17 : Expiration GTD (ExpireDate dépassée) ────────────────────────
print("\n  Scénario Q — Expiration GTD (ExpireDate dépassée)")
fix_eng._ORDER_BOOK.clear()

msg_gtd = fix_msg.build_new_order(
    cl_ord_id="Q-GTD", trader_group_id=TRADER_GROUP, symbol="TEST16",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_LIMIT, quantity=10,
    price=300.0, time_in_force=fix_msg.TIF_GTD, expire_date="20200101",
)
_, r_gtd = fix_eng.process_new_order(msg_gtd)
check("GTD : accepté en attente (expiration pas encore vérifiée à la soumission)",
      r_gtd["statut"] == "en_attente", str(r_gtd))
check("GTD : présent dans le carnet juste après soumission", len(fix_eng._ORDER_BOOK["TEST16"]["bids"]) == 1)

_, r_touch = fix_eng.process_new_order(_new_order("Q-TOUCH", "TEST16", fix_msg.SIDE_SELL, fix_msg.ORD_TYPE_LIMIT, 5, price=999.0))
annexes_q = r_touch.get("evenements_annexes", [])
expired_annex = next((a for a in annexes_q if a["order_id"] == r_gtd["order_id"]), None)
check("GTD : expiré au sweep suivant (annexe statut=expire)",
      expired_annex is not None and expired_annex["statut"] == "expire", str(annexes_q))
check("GTD : retiré du carnet", len(fix_eng._ORDER_BOOK["TEST16"]["bids"]) == 0)

# ── Test 2.18 : Expiration DAY en clôture (2.1.1 : fin de séance) ──────────
print("\n  Scénario R — Expiration DAY en clôture (2.1.1 : fin de séance)")
fix_eng._ORDER_BOOK.clear()
fix_eng.get_market_phase = lambda: fix_eng.MarketPhase.CONTINUOUS

fix_eng.process_new_order(_new_order("R-DAY", "TEST17", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, 10, price=250.0, tif=fix_msg.TIF_DAY))
check("DAY : présent dans le carnet en séance", len(fix_eng._ORDER_BOOK["TEST17"]["bids"]) == 1)

fix_eng.get_market_phase = lambda: fix_eng.MarketPhase.CLOSED
msg_touch_cancel = fix_msg.build_cancel_request(
    orig_cl_ord_id="none", cl_ord_id="R-TOUCH", order_id="inexistant",
    trader_group_id=TRADER_GROUP, symbol="TEST17", side=fix_msg.SIDE_SELL,
)
_, r_touch_r = fix_eng.process_cancel(msg_touch_cancel)
annexes_r = r_touch_r.get("evenements_annexes", [])
check("DAY : expiré en clôture (sweep déclenché par un autre appel)",
      any(a["statut"] == "expire" for a in annexes_r), str(annexes_r))
check("DAY : retiré du carnet après clôture", len(fix_eng._ORDER_BOOK["TEST17"]["bids"]) == 0)

# ── Test 2.19 : TIF OPG — parqué en pré-ouverture, exécuté en continu ──────
print("\n  Scénario S — TIF OPG : parqué en pré-ouverture, exécuté en continu (simplification assumée)")
fix_eng._ORDER_BOOK.clear()
fix_eng.get_market_phase = lambda: fix_eng.MarketPhase.PRE_OPEN

msg_opg = fix_msg.build_new_order(
    cl_ord_id="S-OPG", trader_group_id=TRADER_GROUP, symbol="TEST18",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_LIMIT, quantity=30,
    price=350.0, time_in_force=fix_msg.TIF_OPG,
)
_, r_opg = fix_eng.process_new_order(msg_opg)
check("OPG : parqué en pré-ouverture (comme n'importe quel ordre aujourd'hui)",
      r_opg["statut"] == "en_attente", str(r_opg))

fix_eng.get_market_phase = lambda: fix_eng.MarketPhase.CONTINUOUS
_, r_opg_match = fix_eng.process_new_order(
    _new_order("S-SELL", "TEST18", fix_msg.SIDE_SELL, fix_msg.ORD_TYPE_LIMIT, 30, price=350.0)
)
check("OPG : exécuté en continu via le matching réactif standard", r_opg_match["statut"] == "execute", str(r_opg_match))

# ── Test 2.20 : CPX — croisement au prix de clôture ────────────────────────
print("\n  Scénario T — CPX : croisement au prix de clôture")
fix_eng._ORDER_BOOK.clear()
fix_eng._CPX_QUEUE.clear()
fix_eng._LAST_TRADE_PX.clear()
fix_eng.get_market_phase = lambda: fix_eng.MarketPhase.CONTINUOUS

fix_eng.process_new_order(_new_order("T-SELL0", "TEST19", fix_msg.SIDE_SELL, fix_msg.ORD_TYPE_LIMIT, 10, price=620.0))
fix_eng.process_new_order(_new_order("T-BUY0", "TEST19", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, 10, price=620.0))

msg_cpx_buy = fix_msg.build_new_order(
    cl_ord_id="T-CPX-BUY", trader_group_id=TRADER_GROUP, symbol="TEST19",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_LIMIT, quantity=25,
    time_in_force=fix_msg.TIF_DAY, trading_session_id=fix_msg.TRADING_SESSION_ID_CPX,
)
_, r_cpx_buy = fix_eng.process_new_order(msg_cpx_buy)
check("CPX : mis en attente du prix de clôture", r_cpx_buy["statut"] == "en_attente", str(r_cpx_buy))
check("CPX : en file d'attente dédiée (pas dans le carnet visible)",
      len(fix_eng._CPX_QUEUE.get("TEST19", [])) == 1)

msg_cpx_sell = fix_msg.build_new_order(
    cl_ord_id="T-CPX-SELL", trader_group_id=TRADER_GROUP, symbol="TEST19",
    side=fix_msg.SIDE_SELL, ord_type=fix_msg.ORD_TYPE_LIMIT, quantity=25,
    time_in_force=fix_msg.TIF_DAY, trading_session_id=fix_msg.TRADING_SESSION_ID_CPX,
)
fix_eng.process_new_order(msg_cpx_sell)

fix_eng.get_market_phase = lambda: fix_eng.MarketPhase.CLOSED
msg_touch_cpx = fix_msg.build_cancel_request(
    orig_cl_ord_id="none", cl_ord_id="T-TOUCH", order_id="inexistant",
    trader_group_id=TRADER_GROUP, symbol="TEST19", side=fix_msg.SIDE_SELL,
)
_, r_touch_t = fix_eng.process_cancel(msg_touch_cpx)
annexes_t = r_touch_t.get("evenements_annexes", [])
check("CPX : croisé au prix de clôture (620.0)",
      any(a.get("prix_execution") == 620.0 and a["statut"] == "execute" for a in annexes_t), str(annexes_t))
check("CPX : file vidée après dénouement", fix_eng._CPX_QUEUE.get("TEST19") == [])

# ── Test 2.21 : Cancel/Replace — StopPx non amendable (2.1.2.3) ────────────
print("\n  Scénario U — Cancel/Replace : StopPx non amendable une fois dans le carnet (2.1.2.3)")
fix_eng.get_market_phase = lambda: fix_eng.MarketPhase.CONTINUOUS
fix_eng._ORDER_BOOK.clear()

msg_stop_u = fix_msg.build_new_order(
    cl_ord_id="U-STOP", trader_group_id=TRADER_GROUP, symbol="TEST20",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_STOP, quantity=10,
    stop_px=100.0,
)
_, r_u = fix_eng.process_new_order(msg_stop_u)
order_id_u = r_u["order_id"]
check("Setup : Stop en attente", r_u["statut"] == "en_attente", str(r_u))

msg_replace_stop = fix_msg.build_replace_request(
    orig_cl_ord_id="U-STOP", cl_ord_id="U-REPL", order_id=order_id_u,
    trader_group_id=TRADER_GROUP, symbol="TEST20", side=fix_msg.SIDE_BUY,
    ord_type=fix_msg.ORD_TYPE_STOP, order_qty=10, stop_px=110.0,
)
reject_u, r_u_reject = fix_eng.process_replace(msg_replace_stop)
check("StopPx : amendement rejeté (2.1.2.3)", "erreur" in r_u_reject, str(r_u_reject))
tags_reject_u = fix_msg.parse(reject_u)
check("StopPx : Order Cancel Reject (35=9)", tags_reject_u.get("35") == "9")
stop_orders_u = [o for o in fix_eng._ORDER_BOOK["TEST20"]["bids"] if o.order_id == order_id_u]
check("StopPx : valeur inchangée dans le carnet (100.0)",
      len(stop_orders_u) == 1 and stop_orders_u[0].stop_px == 100.0)

# ── Test 2.22 : Cancel/Replace — transitions DisplayMethod ─────────────────
print("\n  Scénario V — Cancel/Replace : transitions DisplayMethod (2.1.2.3/2.10.15/2.10.16)")
fix_eng._ORDER_BOOK.clear()

msg_vis = _new_order("V-VIS", "TEST21", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, 100, price=200.0)
_, r_vis = fix_eng.process_new_order(msg_vis)
order_id_v = r_vis["order_id"]

msg_to_random = fix_msg.build_replace_request(
    orig_cl_ord_id="V-VIS", cl_ord_id="V-R1", order_id=order_id_v,
    trader_group_id=TRADER_GROUP, symbol="TEST21", side=fix_msg.SIDE_BUY,
    ord_type=fix_msg.ORD_TYPE_LIMIT, order_qty=100, price=200.0,
    display_qty=20, display_method=fix_msg.DISPLAY_METHOD_RANDOM,
)
_, r_to_random = fix_eng.process_replace(msg_to_random)
check("DisplayMethod : visible → Random Iceberg REJETÉ (2.10.15)", "erreur" in r_to_random, str(r_to_random))

msg_to_fixed = fix_msg.build_replace_request(
    orig_cl_ord_id="V-VIS", cl_ord_id="V-R2", order_id=order_id_v,
    trader_group_id=TRADER_GROUP, symbol="TEST21", side=fix_msg.SIDE_BUY,
    ord_type=fix_msg.ORD_TYPE_LIMIT, order_qty=100, price=200.0,
    display_qty=20,
)
_, r_to_fixed = fix_eng.process_replace(msg_to_fixed)
check("DisplayMethod : visible → Fixed Peak Iceberg AUTORISÉ (2.10.15)", "erreur" not in r_to_fixed, str(r_to_fixed))
order_v = fix_eng._ORDER_BOOK["TEST21"]["bids"][0]
check("DisplayMethod : display_qty appliqué (20)", order_v.display_qty == 20)

fix_eng._ORDER_BOOK.clear()
msg_rand = fix_msg.build_new_order(
    cl_ord_id="V-RAND", trader_group_id=TRADER_GROUP, symbol="TEST22",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_LIMIT, quantity=100,
    price=200.0, display_qty=20, display_method=fix_msg.DISPLAY_METHOD_RANDOM,
)
_, r_rand = fix_eng.process_new_order(msg_rand)
order_id_rand = r_rand["order_id"]

msg_rand_to_fixed = fix_msg.build_replace_request(
    orig_cl_ord_id="V-RAND", cl_ord_id="V-R3", order_id=order_id_rand,
    trader_group_id=TRADER_GROUP, symbol="TEST22", side=fix_msg.SIDE_BUY,
    ord_type=fix_msg.ORD_TYPE_LIMIT, order_qty=100, price=200.0,
    display_qty=20,
)
_, r_rand_to_fixed = fix_eng.process_replace(msg_rand_to_fixed)
check("DisplayMethod : Random → Fixed Peak REJETÉ (2.10.16, doit rester Random)",
      "erreur" in r_rand_to_fixed, str(r_rand_to_fixed))

msg_rand_keep = fix_msg.build_replace_request(
    orig_cl_ord_id="V-RAND", cl_ord_id="V-R3B", order_id=order_id_rand,
    trader_group_id=TRADER_GROUP, symbol="TEST22", side=fix_msg.SIDE_BUY,
    ord_type=fix_msg.ORD_TYPE_LIMIT, order_qty=90, price=200.0,
    display_qty=20, display_method=fix_msg.DISPLAY_METHOD_RANDOM,
)
_, r_rand_keep = fix_eng.process_replace(msg_rand_keep)
check("DisplayMethod : Random → Random (1084=3 explicitement resoumis) AUTORISÉ (2.10.16)",
      "erreur" not in r_rand_keep, str(r_rand_keep))

fix_eng._ORDER_BOOK.clear()
msg_vis2 = _new_order("V-VIS2", "TEST23", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, 50, price=210.0)
_, r_vis2 = fix_eng.process_new_order(msg_vis2)
order_id_v2 = r_vis2["order_id"]
msg_to_hidden = fix_msg.build_replace_request(
    orig_cl_ord_id="V-VIS2", cl_ord_id="V-R4", order_id=order_id_v2,
    trader_group_id=TRADER_GROUP, symbol="TEST23", side=fix_msg.SIDE_BUY,
    ord_type=fix_msg.ORD_TYPE_LIMIT, order_qty=50, price=210.0,
    display_qty=0, display_method=fix_msg.DISPLAY_METHOD_HIDDEN,
)
_, r_to_hidden = fix_eng.process_replace(msg_to_hidden)
check("DisplayMethod : visible → Hidden REJETÉ (2.1.2.3)", "erreur" in r_to_hidden, str(r_to_hidden))

# ── Test 2.23 : Iceberg — ExecType=Restated(D) au réapprovisionnement ──────
print("\n  Scénario W — Iceberg : ExecType=Restated(D) émis au réapprovisionnement (6.4.5)")
fix_eng._ORDER_BOOK.clear()
captured_w: list[str] = []
original_log_fix = fix_eng._log_fix
fix_eng._log_fix = lambda msg: captured_w.append(msg)

msg_ice_w = fix_msg.build_new_order(
    cl_ord_id="W-ICE", trader_group_id=TRADER_GROUP, symbol="TEST24",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_LIMIT, quantity=100,
    price=300.0, display_qty=20,
)
fix_eng.process_new_order(msg_ice_w)
fix_eng.process_new_order(_new_order("W-SELL", "TEST24", fix_msg.SIDE_SELL, fix_msg.ORD_TYPE_LIMIT, 20, price=300.0))
fix_eng._log_fix = original_log_fix

restated_w = [m for m in captured_w if fix_msg.parse(m).get("150") == fix_msg.EXEC_TYPE_RESTATED]
check("Iceberg : au moins un Execution Report ExecType=Restated(D) émis", len(restated_w) >= 1, str(captured_w))
if restated_w:
    tags_restated_w = fix_msg.parse(restated_w[0])
    check("Iceberg : ExecRestatementReason(378) = 100 (réapprovisionnement)",
          tags_restated_w.get("378") == fix_msg.EXEC_RESTATEMENT_REASON_REPLENISHMENT, str(tags_restated_w))

# ── Test 2.24 : Cancel/Replace — Price (44) conditionnel pour Offset (6.4.4) ─
print("\n  Scénario X — Cancel/Replace : Price (44) conditionnel pour un ordre Offset (6.4.4)")
fix_eng._ORDER_BOOK.clear()
fix_eng._LAST_TRADE_PX.clear()

fix_eng.process_new_order(_new_order("X-SELL0", "TEST25", fix_msg.SIDE_SELL, fix_msg.ORD_TYPE_LIMIT, 10, price=400.0))
fix_eng.process_new_order(_new_order("X-BUY0", "TEST25", fix_msg.SIDE_BUY, fix_msg.ORD_TYPE_LIMIT, 10, price=400.0))

msg_offset_x = fix_msg.build_new_order(
    cl_ord_id="X-OFFSET", trader_group_id=TRADER_GROUP, symbol="TEST25",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_OFFSET, quantity=20,
    time_in_force=fix_msg.TIF_ATC, offset_bp=100.0,
)
_, r_offset_x = fix_eng.process_new_order(msg_offset_x)
order_id_x = r_offset_x["order_id"]

msg_replace_bad_price = fix_msg.build_replace_request(
    orig_cl_ord_id="X-OFFSET", cl_ord_id="X-R1", order_id=order_id_x,
    trader_group_id=TRADER_GROUP, symbol="TEST25", side=fix_msg.SIDE_BUY,
    ord_type=fix_msg.ORD_TYPE_OFFSET, order_qty=20, price=404.0, offset_bp=100.0,
)
_, r_bad_price = fix_eng.process_replace(msg_replace_bad_price)
check("Offset : remaniement rejeté si Price fourni alors qu'absent à l'origine (6.4.4)",
      "erreur" in r_bad_price, str(r_bad_price))

msg_replace_ok_price = fix_msg.build_replace_request(
    orig_cl_ord_id="X-OFFSET", cl_ord_id="X-R2", order_id=order_id_x,
    trader_group_id=TRADER_GROUP, symbol="TEST25", side=fix_msg.SIDE_BUY,
    ord_type=fix_msg.ORD_TYPE_OFFSET, order_qty=25, offset_bp=150.0,
)
_, r_ok_price = fix_eng.process_replace(msg_replace_ok_price)
check("Offset : remaniement accepté sans Price (cohérent avec l'origine)",
      "erreur" not in r_ok_price, str(r_ok_price))

# ── Test 2.25 : Mass Cancel ciblé par GroupID (530=56/57, tag 27017) ───────
print("\n  Scénario Y — Mass Cancel ciblé par GroupID (530=56/57, 27017)")
fix_eng._ORDER_BOOK.clear()

msg_g1 = fix_msg.build_new_order(
    cl_ord_id="Y-G1", trader_group_id=TRADER_GROUP, symbol="TEST26",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_LIMIT, quantity=10,
    price=50.0, group_id="7",
)
fix_eng.process_new_order(msg_g1)
msg_g2 = fix_msg.build_new_order(
    cl_ord_id="Y-G2", trader_group_id=TRADER_GROUP, symbol="TEST26",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_LIMIT, quantity=15,
    price=49.0, group_id="8",
)
fix_eng.process_new_order(msg_g2)

msg_mass_group = fix_msg.build_mass_cancel_request(
    cl_ord_id="Y-MASS", mass_cancel_request_type=fix_msg.MASS_CANCEL_FOR_GROUP,
    trader_group_id=TRADER_GROUP, group_id="7",
)
_, r_mass_group = fix_eng.process_mass_cancel(msg_mass_group)
check("Mass Cancel For Group : seul le groupe 7 est annulé (1 ordre)",
      len(r_mass_group.get("order_ids", [])) == 1, str(r_mass_group))
check("Mass Cancel For Group : le groupe 8 reste dans le carnet",
      len(fix_eng._ORDER_BOOK["TEST26"]["bids"]) == 1)

msg_mass_no_group = fix_msg.build_mass_cancel_request(
    cl_ord_id="Y-MASS2", mass_cancel_request_type=fix_msg.MASS_CANCEL_FOR_GROUP,
    trader_group_id=TRADER_GROUP,
)
reports_no_group, r_no_group = fix_eng.process_mass_cancel(msg_mass_no_group)
check("Mass Cancel For Group sans GroupID : rejeté", "erreur" in r_no_group, str(r_no_group))

# ── Test 2.26 : PassiveOnlyOrder (27010) ───────────────────────────────────
print("\n  Scénario Z — PassiveOnlyOrder (27010) : rejet si croiserait une contrepartie visible")
fix_eng._ORDER_BOOK.clear()

fix_eng.process_new_order(_new_order("Z-SELL0", "TEST27", fix_msg.SIDE_SELL, fix_msg.ORD_TYPE_LIMIT, 50, price=600.0))

msg_passive = fix_msg.build_new_order(
    cl_ord_id="Z-BUY", trader_group_id=TRADER_GROUP, symbol="TEST27",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_LIMIT, quantity=50,
    price=605.0, passive_only_order=fix_msg.PASSIVE_ONLY_NO_VISIBLE_MATCH,
)
_, r_passive = fix_eng.process_new_order(msg_passive)
check("PassiveOnlyOrder : rejeté car croiserait le ask visible à 600.0",
      r_passive["statut"] == "rejete", str(r_passive))
check("PassiveOnlyOrder : ask non consommé (toujours 50 en attente)",
      fix_eng._ORDER_BOOK["TEST27"]["asks"][0].leaves_qty == 50)

msg_passive_ok = fix_msg.build_new_order(
    cl_ord_id="Z-BUY2", trader_group_id=TRADER_GROUP, symbol="TEST27",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_LIMIT, quantity=50,
    price=590.0, passive_only_order=fix_msg.PASSIVE_ONLY_NO_VISIBLE_MATCH,
)
_, r_passive_ok = fix_eng.process_new_order(msg_passive_ok)
check("PassiveOnlyOrder : accepté quand il ne croise rien",
      r_passive_ok["statut"] == "en_attente", str(r_passive_ok))

# ── Test 2.27 : MinQty (110) réservé aux ordres Pegged DAY/GTT ─────────────
print("\n  Scénario AA — MinQty (110) réservé aux ordres Pegged DAY/GTT (6.4.1)")
fix_eng._ORDER_BOOK.clear()

msg_minqty_limit = fix_msg.build_new_order(
    cl_ord_id="AA-1", trader_group_id=TRADER_GROUP, symbol="TEST28",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_LIMIT, quantity=10,
    price=50.0, min_qty=5,
)
_, r_minqty_limit = fix_eng.process_new_order(msg_minqty_limit)
check("MinQty sur un ordre Limit (non-pegged) : REJETÉ", r_minqty_limit["statut"] == "rejete", str(r_minqty_limit))

msg_minqty_ioc = fix_msg.build_new_order(
    cl_ord_id="AA-2", trader_group_id=TRADER_GROUP, symbol="TEST28",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_PEGGED, quantity=10,
    min_qty=5, time_in_force=fix_msg.TIF_IOC,
)
_, r_minqty_ioc = fix_eng.process_new_order(msg_minqty_ioc)
check("MinQty sur un ordre Pegged IOC : REJETÉ", r_minqty_ioc["statut"] == "rejete", str(r_minqty_ioc))

msg_minqty_ok = fix_msg.build_new_order(
    cl_ord_id="AA-3", trader_group_id=TRADER_GROUP, symbol="TEST28",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_PEGGED, quantity=10,
    min_qty=5,
)
_, r_minqty_ok = fix_eng.process_new_order(msg_minqty_ok)
check("MinQty sur un ordre Pegged DAY : accepté", r_minqty_ok["statut"] == "en_attente", str(r_minqty_ok))

# ── Test 2.28 : PassiveOnlyOrder + ordre entièrement caché ─────────────────
print("\n  Scénario AB — PassiveOnlyOrder (27010) incompatible avec un ordre Hidden (6.4.1)")
fix_eng._ORDER_BOOK.clear()

msg_hidden_passive = fix_msg.build_new_order(
    cl_ord_id="AB-1", trader_group_id=TRADER_GROUP, symbol="TEST29",
    side=fix_msg.SIDE_SELL, ord_type=fix_msg.ORD_TYPE_LIMIT, quantity=40,
    price=510.0, display_qty=0, display_method=fix_msg.DISPLAY_METHOD_HIDDEN,
    passive_only_order=fix_msg.PASSIVE_ONLY_NEW_VISIBLE_BBO,
)
_, r_hidden_passive = fix_eng.process_new_order(msg_hidden_passive)
check("Hidden + PassiveOnlyOrder=100 : REJETÉ", r_hidden_passive["statut"] == "rejete", str(r_hidden_passive))

msg_hidden_passive_99 = fix_msg.build_new_order(
    cl_ord_id="AB-2", trader_group_id=TRADER_GROUP, symbol="TEST29",
    side=fix_msg.SIDE_SELL, ord_type=fix_msg.ORD_TYPE_LIMIT, quantity=40,
    price=510.0, display_qty=0, display_method=fix_msg.DISPLAY_METHOD_HIDDEN,
    passive_only_order=fix_msg.PASSIVE_ONLY_NO_VISIBLE_MATCH,
)
_, r_hidden_passive_99 = fix_eng.process_new_order(msg_hidden_passive_99)
check("Hidden + PassiveOnlyOrder=99 : autorisé (6.4.4)", r_hidden_passive_99["statut"] == "en_attente", str(r_hidden_passive_99))

# ── Test 2.29 : ExpireTime/ExpireDate sur Cancel/Replace (2.10.20) ─────────
print("\n  Scénario AC — Cancel/Replace : cohérence ExpireTime/ExpireDate pour un ordre GTD/GTT (2.10.20)")
fix_eng._ORDER_BOOK.clear()

msg_gtd_ac = fix_msg.build_new_order(
    cl_ord_id="AC-GTD", trader_group_id=TRADER_GROUP, symbol="TEST30",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_LIMIT, quantity=10,
    price=300.0, time_in_force=fix_msg.TIF_GTD, expire_date="20261231",
)
_, r_gtd_ac = fix_eng.process_new_order(msg_gtd_ac)
order_id_ac = r_gtd_ac["order_id"]
check("Setup : ordre GTD (ExpireDate) en attente", r_gtd_ac["statut"] == "en_attente", str(r_gtd_ac))

msg_replace_both = fix_msg.build_replace_request(
    orig_cl_ord_id="AC-GTD", cl_ord_id="AC-R1", order_id=order_id_ac,
    trader_group_id=TRADER_GROUP, symbol="TEST30", side=fix_msg.SIDE_BUY,
    ord_type=fix_msg.ORD_TYPE_LIMIT, order_qty=10, price=300.0,
    expire_time="20261231-15:00:00.000000", expire_date="20261231",
)
_, r_replace_both = fix_eng.process_replace(msg_replace_both)
check("Replace GTD : ExpireTime + ExpireDate ensemble REJETÉ", "erreur" in r_replace_both, str(r_replace_both))

msg_replace_wrong_type = fix_msg.build_replace_request(
    orig_cl_ord_id="AC-GTD", cl_ord_id="AC-R2", order_id=order_id_ac,
    trader_group_id=TRADER_GROUP, symbol="TEST30", side=fix_msg.SIDE_BUY,
    ord_type=fix_msg.ORD_TYPE_LIMIT, order_qty=10, price=300.0,
    expire_time="20261231-15:00:00.000000",
)
_, r_replace_wrong_type = fix_eng.process_replace(msg_replace_wrong_type)
check("Replace GTD (ExpireDate d'origine) : ExpireTime seul REJETÉ (2.10.20)",
      "erreur" in r_replace_wrong_type, str(r_replace_wrong_type))

msg_replace_neither = fix_msg.build_replace_request(
    orig_cl_ord_id="AC-GTD", cl_ord_id="AC-R3", order_id=order_id_ac,
    trader_group_id=TRADER_GROUP, symbol="TEST30", side=fix_msg.SIDE_BUY,
    ord_type=fix_msg.ORD_TYPE_LIMIT, order_qty=15, price=300.0,
)
_, r_replace_neither = fix_eng.process_replace(msg_replace_neither)
check("Replace GTD : ni ExpireTime ni ExpireDate REJETÉ (2.10.20)",
      "erreur" in r_replace_neither, str(r_replace_neither))

msg_replace_ok_ac = fix_msg.build_replace_request(
    orig_cl_ord_id="AC-GTD", cl_ord_id="AC-R4", order_id=order_id_ac,
    trader_group_id=TRADER_GROUP, symbol="TEST30", side=fix_msg.SIDE_BUY,
    ord_type=fix_msg.ORD_TYPE_LIMIT, order_qty=15, price=300.0,
    expire_date="20261231",
)
_, r_replace_ok_ac = fix_eng.process_replace(msg_replace_ok_ac)
check("Replace GTD : ExpireDate reconduit (même type) accepté", "erreur" not in r_replace_ok_ac, str(r_replace_ok_ac))

msg_replace_orig_echo = fix_msg.build_replace_request(
    orig_cl_ord_id="AC-GTD", cl_ord_id="AC-R5", order_id=order_id_ac,
    trader_group_id=TRADER_GROUP, symbol="TEST30", side=fix_msg.SIDE_BUY,
    ord_type=fix_msg.ORD_TYPE_LIMIT, order_qty=15, price=300.0,
    expire_date="20261231",
)
report_orig_echo, r_orig_echo = fix_eng.process_replace(msg_replace_orig_echo)
tags_orig_echo = fix_msg.parse(report_orig_echo)
check("OrigClOrdID (41) échoé sur l'Exec Report du replace",
      tags_orig_echo.get("41") == "AC-GTD", str(tags_orig_echo))

# ── Test 2.30 : MassCancelRequestType=57 toujours rejeté sur cette plateforme
print("\n  Scénario AD — Mass Cancel 57 (For Instrument For Group) : toujours rejeté (6.4.3)")
fix_eng._ORDER_BOOK.clear()

msg_g1_ad = fix_msg.build_new_order(
    cl_ord_id="AD-G1", trader_group_id=TRADER_GROUP, symbol="TEST31",
    side=fix_msg.SIDE_BUY, ord_type=fix_msg.ORD_TYPE_LIMIT, quantity=10,
    price=50.0, group_id="9",
)
fix_eng.process_new_order(msg_g1_ad)

msg_mass_57 = fix_msg.build_mass_cancel_request(
    cl_ord_id="AD-MASS", mass_cancel_request_type=fix_msg.MASS_CANCEL_FOR_INSTRUMENT_GROUP,
    trader_group_id=TRADER_GROUP, symbol="TEST31", group_id="9",
)
reports_57, r_57 = fix_eng.process_mass_cancel(msg_mass_57)
check("Mass Cancel 57 (For Instrument For Group) : rejeté (TargetPartyRole=76 non supporté)",
      "erreur" in r_57, str(r_57))
check("Mass Cancel 57 : l'ordre reste dans le carnet", len(fix_eng._ORDER_BOOK["TEST31"]["bids"]) == 1)

# ── Test 2.31 : GroupID/TotalAffectedOrders échoés sur Order Mass Cancel Report
print("\n  Scénario AE — Order Mass Cancel Report : GroupID (27017) + TotalAffectedOrders (533)")
msg_mass_56 = fix_msg.build_mass_cancel_request(
    cl_ord_id="AE-MASS", mass_cancel_request_type=fix_msg.MASS_CANCEL_FOR_GROUP,
    trader_group_id=TRADER_GROUP, group_id="9",
)
reports_56, r_56 = fix_eng.process_mass_cancel(msg_mass_56)
check("Mass Cancel 56 : 1 ordre annulé", len(r_56.get("order_ids", [])) == 1, str(r_56))
tags_mass_56 = fix_msg.parse(reports_56[0])
check("Mass Cancel Report : GroupID (27017) échoé = 9", tags_mass_56.get("27017") == "9", str(tags_mass_56))
check("Mass Cancel Report : TotalAffectedOrders (533) = 1", tags_mass_56.get("533") == "1", str(tags_mass_56))

# Restaurer
fix_eng.get_market_phase = original_phase

# ═════════════════════════════════════════════════════════════════════════════
# Résultat final
# ═════════════════════════════════════════════════════════════════════════════
total = passed + failed
print(f"\n{'═'*60}")
print(f"  Résultat : {passed}/{total} tests passés", end="")
if failed == 0:
    print(f"  \033[92m✓ TOUS LES TESTS PASSENT\033[0m")
else:
    print(f"  \033[91m✗ {failed} ÉCHOUÉ(S)\033[0m")
print(f"{'═'*60}\n")

sys.exit(0 if failed == 0 else 1)
