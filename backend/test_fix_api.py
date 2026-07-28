"""
Tests d'intégration FIX Protocol via l'API REST.

Prérequis :
  - Backend bourse lancé sur http://localhost:8000
  - Un token Keycloak valide (investisseur)

Usage :
  python test_fix_api.py <access_token>
"""
import sys
import json
import urllib.request
import urllib.error

BASE = "http://localhost:8000"

def req(method, path, body=None, token=None):
    url = BASE + path
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    rq = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(rq) as r:
            body = r.read()
            return r.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return e.code, json.loads(body) if body else {}
        except Exception:
            return e.code, {"detail": body.decode(errors="replace")}

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
        print(f"  {FAIL} {label} {details}")
        failed += 1

token = sys.argv[1] if len(sys.argv) > 1 else None

print(f"\n{HEAD}── Tests API REST + FIX Protocol ───────────────────────────────────{END}")

if not token:
    print("  Usage : python test_fix_api.py <access_token>")
    print("  Sans token, seuls les tests sans auth sont exécutés.\n")

# ── Test 1 : Ordre limite (en_attente car pas de contrepartie) ───────────────
print("\n  Test 1 — Ordre limite BID ATW (en_attente dans carnet FIX)")
status, resp = req("POST", "/api/ordres", {
    "instrument_code": "ATW",
    "sens": "achat",
    "type_ordre": "limite",
    "quantite": 100,
    "prix_limite": 490.0,
    "time_in_force": "day"
}, token)
print(f"    HTTP {status} | {json.dumps(resp, ensure_ascii=False)}")
check("HTTP 200", status == 200, f"(got {status})")
check("Statut = en_attente", resp.get("statut") == "en_attente", str(resp))
check("fix_cl_ord_id présent", bool(resp.get("fix_cl_ord_id")))
order_id_1 = resp.get("id")

# ── Test 2 : Ordre limite ASK qui croise → exécution ────────────────────────
print("\n  Test 2 — Ordre limite ASK ATW qui croise le BID (execute)")
status, resp = req("POST", "/api/ordres", {
    "instrument_code": "ATW",
    "sens": "vente",
    "type_ordre": "limite",
    "quantite": 100,
    "prix_limite": 488.0,   # 488 < 490 → croise le bid à 490
    "time_in_force": "day"
}, token)
print(f"    HTTP {status} | {json.dumps(resp, ensure_ascii=False)}")
check("HTTP 200", status == 200, f"(got {status})")
check("Statut = execute (match croisé)", resp.get("statut") == "execute", str(resp))
check("Prix exécution = 490.0 (resting)", resp.get("prix_execution") == 490.0)
check("Quantité exécutée = 100", resp.get("quantite_executee") == 100)

# ── Test 3 : Ordre au marché (execute en séance, rejeté hors séance) ──────────
print("\n  Test 3 — Ordre marché achat IAM")
status, resp = req("POST", "/api/ordres", {
    "instrument_code": "IAM",
    "sens": "achat",
    "type_ordre": "marche",
    "quantite": 50,
    "prix_marche": 1250.0,
    "time_in_force": "day"
}, token)
print(f"    HTTP {status} | {json.dumps(resp, ensure_ascii=False)}")
check("HTTP 200", status == 200, f"(got {status})")
statut_3 = resp.get("statut")
# En séance → execute (market maker) ; hors séance → rejete (comportement FIX correct)
check("Statut FIX cohérent (execute ou rejete)",
      statut_3 in ("execute", "rejete"), str(resp))
if statut_3 == "execute":
    check("Prix exécution = 1250.0", resp.get("prix_execution") == 1250.0)
else:
    check("Raison de rejet présente dans message", "fermé" in resp.get("message", "").lower() or "ferm" in resp.get("message","").lower())

# ── Test 4 : Snapshot carnet d'ordres ────────────────────────────────────────
print("\n  Test 4 — GET /api/ordres/carnet/ATW")
status, resp = req("GET", "/api/ordres/carnet/ATW", token=token)
print(f"    HTTP {status} | {json.dumps(resp, ensure_ascii=False)}")
check("HTTP 200", status == 200)
check("symbol = ATW", resp.get("symbol") == "ATW")
check("phase présente", "phase" in resp)
check("bids liste", isinstance(resp.get("bids"), list))
check("asks liste", isinstance(resp.get("asks"), list))

# ── Test 5 : Lister les ordres ────────────────────────────────────────────────
print("\n  Test 5 — GET /api/ordres (liste)")
status, resp = req("GET", "/api/ordres", token=token)
check("HTTP 200", status == 200)
check("Réponse est une liste", isinstance(resp, list))
if isinstance(resp, list) and len(resp) > 0:
    check("Champ 'statut' présent", "statut" in resp[0])
    check("Champ 'instrument' présent", "instrument" in resp[0])
    print(f"    {len(resp)} ordre(s) trouvé(s)")

# ── Test 6 : Annulation via FIX Cancel Request ───────────────────────────────
if order_id_1:
    # Placer d'abord un ordre en attente
    status, resp_new = req("POST", "/api/ordres", {
        "instrument_code": "CIH",
        "sens": "achat",
        "type_ordre": "limite",
        "quantite": 10,
        "prix_limite": 200.0,
        "time_in_force": "day"
    }, token)
    cancel_id = resp_new.get("id")
    print(f"\n  Test 6 — Annulation ordre en_attente (FIX 35=F)")
    if cancel_id and resp_new.get("statut") == "en_attente":
        status, resp_cancel = req("PUT", f"/api/ordres/{cancel_id}/annuler", token=token)
        print(f"    HTTP {status} | {json.dumps(resp_cancel, ensure_ascii=False)}")
        check("HTTP 200", status == 200)
        check("succes = True", resp_cancel.get("succes") is True)
        check("Message FIX 35=F mentionné", "35=F" in resp_cancel.get("message", ""))
    else:
        print(f"    Ordre non placé en attente ({resp_new.get('statut')}) — test ignoré")

# ─────────────────────────────────────────────────────────────────────────────
total = passed + failed
print(f"\n{'═'*60}")
print(f"  API : {passed}/{total} tests passés", end="")
if failed == 0:
    print(f"  \033[92m✓ TOUS PASSENT\033[0m")
else:
    print(f"  \033[91m✗ {failed} ÉCHOUÉ(S)\033[0m")
print(f"{'═'*60}\n")
