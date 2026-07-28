"""
Démo reproductible — trace exacte des appels/réponses FIX 5.0/FIXT.1.1 contre le
VRAI backend (Docker LOCAL), la VRAIE base Postgres et un VRAI compte Keycloak.

Ce script est strictement local (localhost:3000/8000/9090 en dur, container
Docker "bourse-backend") — il ne prend PAS d'URL de production en paramètre,
contrairement à tests/fonctionnels/ (qui tourne, lui, en CI après déploiement
contre https://bourse.cfconsultancy.org).

Contrairement à test_fix.py (moteur en mémoire, sans DB) et test_fix_api.py
(checks API sans trace FIX), ce script :
  1. Pilote un vrai navigateur (Selenium, headless) : connexion via le
     formulaire Keycloak du compte de test "investisseur1", exactement comme
     un investisseur réel — les ordres sont ensuite soumis via le même point
     d'entrée HTTP que l'UI (window._apiCall de dashboard.html), pas par un
     appel HTTP direct hors navigateur.
  2. Nettoie les ordres existants du compte (Mass Cancel)
  3. Rejoue une séquence complète : New Order → New Order croisant → Cancel/
     Replace (invalide puis valide) → Cancel du reliquat partiel → Mass Cancel
     → types d'ordre avancés MIT202 (Stop, Iceberg, Pegged, Offset, GTD/GTT,
     TIF d'enchère, CPX, GroupID, PassiveOnly) → Mass Cancel
  4. Affiche pour chaque étape la requête API, le message FIX exact envoyé au
     moteur et la réponse FIX exacte (extraits des logs du conteneur), et la
     réponse JSON

Tous les scénarios réutilisent le symbole ATW, déjà présent dans
marche.instruments — aucun nouveau symbole DEMO* n'est créé (chaque code
inconnu serait auto-créé par _get_or_create_instrument() et resterait en
base indéfiniment). L'isolation entre types d'ordre est obtenue par un Mass
Cancel ciblé (?symbol=ATW) entre chaque section, pas par un symbole dédié.

Prérequis (LOCAL uniquement) :
  - docker compose up -d --build backend frontend  (images à jour, sur la
    machine hôte Docker locale — ports 3000/8000/9090 exposés)
  - Le compte de test "investisseur1" / "Investisseur123!" doit exister dans
    Keycloak (realm bourse-en-ligne) ET dans identite.utilisateurs +
    portefeuille.comptes (voir backend/README.md, section comptes de test).
    Si le mot de passe a été changé, le réinitialiser via kcadm.sh :
      docker exec bourse-keycloak /opt/keycloak/bin/kcadm.sh set-password \
        -r bourse-en-ligne --username investisseur1 \
        --new-password 'Investisseur123!' --temporary=false
    (après un login admin : kcadm.sh config credentials --server
     http://localhost:8080 --realm master --user <KC_ADMIN_USERNAME>
     --password <KC_ADMIN_PASSWORD>, exécuté DANS le conteneur bourse-keycloak)

Usage (depuis backend/, pour que "tests.fonctionnels.pages" soit importable) :
  python demo_fix_flow.py
"""
import json
import subprocess
import sys
import time

from selenium.webdriver.support.ui import WebDriverWait

from tests.fonctionnels.conftest import _make_driver
from tests.fonctionnels.pages.home_page import HomePage
from tests.fonctionnels.pages.keycloak_page import KeycloakPage
from tests.fonctionnels.pages.dashboard_page import DashboardPage

# ── Constantes LOCALES en dur (jamais de production ici) ──────────────────────
FRONTEND_URL       = "http://localhost:3000"
USERNAME           = "investisseur1"
USERNAME_EMAIL     = "investisseur1@bourse-en-ligne.local"
PASSWORD           = "Investisseur123!"
CONTAINER_NAME     = "bourse-backend"
POSTGRES_CONTAINER = "bourse-postgres"
POSTGRES_USER      = "bourse_admin"
POSTGRES_DB        = "bourse_db"
SOLDE_MIN          = 1_000_000.00
SYM                = "ATW"  # symbole partagé par tous les scénarios (déjà existant)

OK, FAIL, HEAD, DIM, END = (
    "\033[92m✓\033[0m", "\033[91m✗\033[0m", "\033[94m", "\033[90m", "\033[0m",
)

# ── Décodage des tags FIX (affichage pédagogique) ─────────────────────────────
TAG_NAMES = {
    "8": "BeginString", "9": "BodyLength", "10": "CheckSum",
    "35": "MsgType", "49": "SenderCompID", "56": "TargetCompID",
    "34": "MsgSeqNum", "1128": "ApplVerID", "52": "SendingTime",
    "11": "ClOrdID", "41": "OrigClOrdID", "37": "OrderID",
    "453": "NoPartyIDs", "448": "PartyID", "447": "PartyIDSource", "452": "PartyRole",
    "21": "HandlInst", "48": "SecurityID", "22": "SecurityIDSource",
    "54": "Side", "38": "OrderQty", "40": "OrdType", "44": "Price",
    "59": "TimeInForce", "581": "AccountType", "528": "OrderCapacity",
    "60": "TransactTime", "17": "ExecID", "150": "ExecType", "39": "OrdStatus",
    "32": "LastQty", "31": "LastPx", "14": "CumQty", "151": "LeavesQty", "6": "AvgPx",
    "58": "Text", "434": "CxlRejResponseTo", "102": "CxlRejReason",
    "530": "MassCancelRequestType", "531": "MassCancelResponse",
    "1461": "NoTargetPartyIDs", "1462": "TargetPartyID", "1463": "TargetPartyIDSource",
    "1464": "TargetPartyRole", "1369": "MassActionReportID", "532": "MassCancelRejectReason",
}
MSG_TYPE_NAMES = {
    "D": "New Order Single", "F": "Order Cancel Request", "G": "Order Cancel/Replace Request",
    "q": "Order Mass Cancel Request", "8": "Execution Report", "9": "Order Cancel Reject",
    "r": "Order Mass Cancel Report", "j": "Business Message Reject",
}

# ── Référentiel de conformité MIT202 — extrait des tableaux 6.2.1/6.2.2/6.4.x ─
# Statut : Y = obligatoire, N = optionnel, C = conditionnel (dépend du contexte,
# ex. "si ExecType=Trade"). Format : tag -> (nom, statut, remarque).
# Un tag présent dans un message mais absent d'ici = hors spécification MIT202
# (souvent un reliquat de l'ancien dialecte FIX 4.4). Un tag "Y" absent du
# message = non-conformité (mentionnée explicitement le cas échéant).
HEADER_SPEC = {
    "8":    ("BeginString", "Y", "6.2.1"),
    "9":    ("BodyLength", "Y", "6.2.1"),
    "35":   ("MsgType", "Y", "6.2.1"),
    "49":   ("SenderCompID", "Y", "6.2.1"),
    "56":   ("TargetCompID", "Y", "6.2.1"),
    "34":   ("MsgSeqNum", "Y", "6.2.1"),
    "1128": ("ApplVerID", "N", "6.2.1 — requis si généré par le serveur"),
    "52":   ("SendingTime", "N", "6.2.1"),
    "10":   ("CheckSum", "Y", "6.2.2"),
}

MSG_SPEC: dict[str, dict[str, tuple[str, str, str]]] = {
    "D": {  # New Order Single — section 6.4.1
        "11":   ("ClOrdID", "Y", ""),
        "453":  ("NoPartyIDs", "Y", "attendu : 4 ou 5"),
        "448":  ("PartyID", "Y", "répétable"),
        "447":  ("PartyIDSource", "Y", ""),
        "452":  ("PartyRole", "Y", ""),
        "2376": ("PartyRoleQualifier", "C", "si PartyID = short code"),
        "1":    ("Account", "N", ""),
        "48":   ("SecurityID", "Y", ""),
        "22":   ("SecurityIDSource", "Y", ""),
        "40":   ("OrdType", "Y", ""),
        "1091": ("PreTradeAnonymity", "N", ""),
        "59":   ("TimeInForce", "N", ""),
        "126":  ("ExpireTime", "C", "si TimeInForce=GTD"),
        "432":  ("ExpireDate", "C", "si TimeInForce=GTD"),
        "54":   ("Side", "Y", ""),
        "38":   ("OrderQty", "Y", ""),
        "1138": ("DisplayQty", "Y", "= OrderQty (pas d'iceberg géré, toujours entièrement affiché)"),
        "1084": ("DisplayMethod", "N", ""),
        "44":   ("Price", "C", "si OrdType=Limit/StopLimit"),
        "99":   ("StopPx", "C", "si OrdType=Stop/StopLimit"),
        "581":  ("AccountType", "Y", ""),
        "528":  ("OrderCapacity", "Y", ""),
        "60":   ("TransactTime", "Y", ""),
        "526":  ("SecondaryClOrdID", "N", ""),
        "583":  ("ClOrdLinkID", "N", ""),
        "27010":("PassiveOnlyOrder", "N", ""),
        "110":  ("MinQty", "N", ""),
        "1724": ("OrderOrigination", "N", ""),
        "27017":("GroupID", "N", ""),
        "27018":("Offset", "C", "si OrdType=Offset"),
        "336":  ("TradingSessionID", "C", "\"a\"=CPX (Closing Price Crossing), sur un ordre TIF=Day"),
    },
    "F": {  # Order Cancel Request — section 6.4.2
        "11":  ("ClOrdID", "Y", ""),
        "41":  ("OrigClOrdID", "C", "si OrderID absent"),
        "37":  ("OrderID", "C", "si OrigClOrdID absent"),
        "48":  ("SecurityID", "Y", ""),
        "22":  ("SecurityIDSource", "Y", ""),
        "453": ("NoPartyIDs", "Y", "attendu : 1 ou 2"),
        "448": ("PartyID", "Y", ""),
        "447": ("PartyIDSource", "Y", ""),
        "452": ("PartyRole", "Y", ""),
        "54":  ("Side", "Y", ""),
        "60":  ("TransactTime", "Y", ""),
    },
    "G": {  # Order Cancel/Replace Request — section 6.4.4
        "11":   ("ClOrdID", "Y", ""),
        "41":   ("OrigClOrdID", "C", "si OrderID absent"),
        "37":   ("OrderID", "C", "si OrigClOrdID absent"),
        "453":  ("NoPartyIDs", "Y", "attendu : 1 ou 2"),
        "448":  ("PartyID", "Y", ""),
        "447":  ("PartyIDSource", "Y", ""),
        "452":  ("PartyRole", "Y", ""),
        "1":    ("Account", "N", ""),
        "48":   ("SecurityID", "Y", ""),
        "22":   ("SecurityIDSource", "Y", ""),
        "40":   ("OrdType", "Y", "doit correspondre à l'ordre existant"),
        "126":  ("ExpireTime", "C", "si TimeInForce=GTD"),
        "432":  ("ExpireDate", "C", "si TimeInForce=GTD"),
        "54":   ("Side", "Y", ""),
        "38":   ("OrderQty", "Y", ""),
        "1138": ("DisplayQty", "Y", "= OrderQty (pas d'iceberg géré, toujours entièrement affiché)"),
        "1084": ("DisplayMethod", "N", ""),
        "44":   ("Price", "C", "si OrdType=Limit/StopLimit"),
        "99":   ("StopPx", "C", "si OrdType=Stop/StopLimit"),
        "60":   ("TransactTime", "Y", ""),
    },
    "q": {  # Order Mass Cancel Request — section 6.4.3
        "11":    ("ClOrdID", "Y", ""),
        "530":   ("MassCancelRequestType", "Y", ""),
        "27017": ("GroupID", "C", "si scope=Group"),
        "48":    ("SecurityID", "C", "si scope=Instrument"),
        "22":    ("SecurityIDSource", "C", "si scope=Instrument"),
        "1461":  ("NoTargetPartyIDs", "Y", ""),
        "1462":  ("TargetPartyID", "Y", ""),
        "1463":  ("TargetPartyIDSource", "Y", ""),
        "1464":  ("TargetPartyRole", "Y", ""),
        "1300":  ("MarketSegmentID", "C", "si scope=Segment (non supporté par ce moteur)"),
        "60":    ("TransactTime", "Y", ""),
    },
    "8": {  # Execution Report — section 6.4.5
        "17":   ("ExecID", "Y", ""),
        "11":   ("ClOrdID", "Y", ""),
        "41":   ("OrigClOrdID", "N", ""),
        "37":   ("OrderID", "Y", ""),
        "150":  ("ExecType", "Y", ""),
        "19":   ("ExecRefID", "C", "si ExecType=TradeCancel"),
        "378":  ("ExecRestatementReason", "C", "si ExecType=Restated"),
        "39":   ("OrdStatus", "Y", ""),
        "103":  ("OrdRejReason", "C", "si ExecType=Rejected/Expired"),
        "58":   ("Text", "N", ""),
        "32":   ("LastQty", "C", "si ExecType=Trade"),
        "31":   ("LastPx", "C", "si ExecType=Trade"),
        "151":  ("LeavesQty", "Y", ""),
        "14":   ("CumQty", "Y", ""),
        "48":   ("SecurityID", "Y", ""),
        "22":   ("SecurityIDSource", "Y", ""),
        "1":    ("Account", "N", ""),
        "453":  ("NoPartyIDs", "Y", "attendu : 4, 5 ou 6"),
        "448":  ("PartyID", "Y", ""),
        "447":  ("PartyIDSource", "Y", ""),
        "452":  ("PartyRole", "Y", ""),
        "40":   ("OrdType", "Y", ""),
        "59":   ("TimeInForce", "N", ""),
        "54":   ("Side", "Y", ""),
        "38":   ("OrderQty", "Y", ""),
        "44":   ("Price", "C", "selon le type d'ordre"),
        "99":   ("StopPx", "C", "si OrdType=Stop/StopLimit"),
        "1138": ("DisplayQty", "C", "quantité actuellement affichée (Iceberg/Hidden)"),
        "1084": ("DisplayMethod", "N", ""),
        "1091": ("PreTradeAnonymity", "N", ""),
        "126":  ("ExpireTime", "C", "si TimeInForce=GTD (usage GTT)"),
        "432":  ("ExpireDate", "C", "si TimeInForce=GTD"),
        "581":  ("AccountType", "Y", ""),
        "528":  ("OrderCapacity", "Y", ""),
        "60":   ("TransactTime", "Y", ""),
        "9730": ("TradeLiquidityIndicator", "C", "si Trade/TradeCancel"),
        "880":  ("TradeMatchID (TVTIC)", "C", "si Trade/TradeCancel"),
        "278":  ("MDEntryID", "Y", "Public Order ID = order_id"),
        "110":  ("MinQty", "N", ""),
        "851":  ("LastLiquidityInd", "C", "si Trade/TradeCancel"),
        "1724": ("OrderOrigination", "N", ""),
        "27017":("GroupID", "Y", "0 = non groupé"),
        "30":   ("LastMkt", "C", "si ExecType=Trade — placeholder XLON (simulation mono-venue)"),
        "27018":("Offset", "C", "si OrdType=Offset"),
    },
    "9": {  # Order Cancel Reject — section 6.4.6
        "11":  ("ClOrdID", "Y", ""),
        "41":  ("OrigClOrdID", "N", ""),
        "37":  ("OrderID", "Y", ""),
        "39":  ("OrdStatus", "Y", ""),
        "434": ("CxlRejResponseTo", "Y", ""),
        "102": ("CxlRejReason", "Y", ""),
        "58":  ("Text", "N", ""),
    },
    "r": {  # Order Mass Cancel Report — section 6.4.7
        "1369": ("MassActionReportID", "Y", ""),
        "11":   ("ClOrdID", "Y", ""),
        "530":  ("MassCancelRequestType", "Y", ""),
        "531":  ("MassCancelResponse", "Y", ""),
        "532":  ("MassCancelRejectReason", "C", "si MassCancelResponse=0"),
        "1180": ("ApplId", "Y", "partition unique fixe (\"1\") — pas de partitionnement réel"),
    },
}


def fail(msg: str) -> None:
    print(f"\n{FAIL} {msg}\n")
    sys.exit(1)


def _assurer_solde_minimum() -> None:
    """
    Garantit que investisseur1 dispose d'au moins SOLDE_MIN MAD avant de
    lancer la démo. investisseur1 est un compte fixture PARTAGÉ (réutilisé
    par toutes les exécutions passées de ce script et par des tests
    manuels) : son solde dérive au fil du temps, ce qui rendrait cette démo
    non reproductible si on comptait sur un solde résiduel suffisant. Accès
    direct au conteneur Postgres via `docker exec` — cohérent avec le reste
    de ce script, strictement local (cf. _docker_logs_full ci-dessous, qui
    accède déjà directement au conteneur backend).
    """
    sql = (
        f"UPDATE portefeuille.comptes SET solde_especes = {SOLDE_MIN} "
        f"WHERE utilisateur_id = (SELECT id FROM identite.utilisateurs WHERE email = '{USERNAME_EMAIL}') "
        f"AND solde_especes < {SOLDE_MIN};"
    )
    try:
        subprocess.run(
            ["docker", "exec", POSTGRES_CONTAINER, "psql", "-U", POSTGRES_USER, "-d", POSTGRES_DB, "-c", sql],
            capture_output=True, text=True, timeout=15, check=True,
        )
    except FileNotFoundError:
        fail("Commande 'docker' introuvable — ce script doit tourner sur la machine hôte Docker locale.")
    except subprocess.CalledProcessError as exc:
        fail(f"Impossible de garantir le solde minimum de '{USERNAME}' : {exc.stderr}")


# ── Extraction des messages FIX depuis les logs du conteneur ─────────────────
#
# `docker logs --since <timestamp précis>` s'est révélé peu fiable sur cette
# machine (Docker 29.5.3) : avec une fenêtre de quelques secondes/minutes, il
# retourne silencieusement 0 ligne même quand des entrées correspondantes
# existent bel et bien (reproductible indépendamment de tout code applicatif,
# y compris pour un simple GET /docs) — alors que `--since 1h` ou une date
# seule fonctionnent. Plutôt que de dépendre de ce filtrage par timestamp, on
# récupère l'intégralité des logs à chaque appel et on ne garde que le
# nouveau contenu apparu depuis le dernier relevé (comparaison de longueur) :
# robuste face aux décalages d'horloge et aux quirks de granularité de
# `--since`, au prix d'un `docker logs` complet (volume négligeable sur la
# durée d'exécution de ce script). Fonctionne uniquement sur la machine hôte
# Docker LOCALE (accès direct au conteneur "bourse-backend").

_logs_baseline_len: int | None = None


def _docker_logs_full() -> str:
    try:
        out = subprocess.run(
            ["docker", "logs", CONTAINER_NAME],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15,
        )
    except FileNotFoundError:
        fail("Commande 'docker' introuvable — ce script doit tourner sur la machine hôte Docker locale.")
    return out.stdout + out.stderr


def _snapshot_logs() -> None:
    """Mémorise la longueur des logs actuels — tout ce qui apparaîtra après
    ce point sera considéré comme "nouveau" par _new_logs_since_snapshot()."""
    global _logs_baseline_len
    _logs_baseline_len = len(_docker_logs_full())


def _new_logs_since_snapshot() -> str:
    """Retourne uniquement les logs apparus depuis le dernier _snapshot_logs()."""
    global _logs_baseline_len
    full = _docker_logs_full()
    baseline = _logs_baseline_len or 0
    new = full[baseline:] if len(full) > baseline else ""
    _logs_baseline_len = len(full)
    return new


def decode(raw_fix: str, msg_type: str) -> str:
    """
    Décode un message FIX tag par tag ET annote chaque tag avec son statut
    documenté par MIT202 (obligatoire/optionnel/conditionnel + section), en
    combinant HEADER_SPEC (commun à tous les messages) et MSG_SPEC[msg_type]
    (spécifique à ce type de message).

    À la fin, signale les tags marqués obligatoires ("Y") par le document mais
    absents du message effectivement transmis — c'est la vérification de
    conformité structurelle demandée : "pour chaque tag, comparer avec ce qui
    est exigé par le document".
    """
    # Le routeur logge déjà les messages FIX avec "|" comme séparateur (pas les
    # octets SOH \x01 bruts) — cf. `fix_msg.replace("\x01", "|")` dans
    # ordres_bourse.py — donc on découpe sur "|" ici, pas sur \x01.
    spec = MSG_SPEC.get(msg_type, {})
    seen_tags: set[str] = set()

    lines = [f"  RAW  : {raw_fix}"]
    lines.append("  ┌─ décodage + conformité MIT202 ─────────────────────────────────────")
    for field in raw_fix.split("|"):
        if "=" not in field:
            continue
        tag, _, val = field.partition("=")
        seen_tags.add(tag)

        if tag in HEADER_SPEC:
            name, status, ref = HEADER_SPEC[tag]
        elif tag in spec:
            name, status, ref = spec[tag]
        else:
            name, status, ref = TAG_NAMES.get(tag, f"(tag {tag})"), "?", "HORS SPEC MIT202"

        if status == "Y":
            marker = f"{OK} Y"
        elif status == "C":
            marker = f"{DIM}~ C{END}"
        elif status == "N":
            marker = f"{DIM}  N{END}"
        else:
            marker = f"{FAIL} ? "
        ref_str = f" [{ref}]" if ref else ""
        lines.append(f"  │ {marker} {tag:>5} {name:<24} = {val}{ref_str}")
    lines.append("  └──────────────────────────────────────────────────────────────────")

    missing = [
        (tag, name, ref) for tag, (name, status, ref) in spec.items()
        if status == "Y" and tag not in seen_tags
    ]
    if missing:
        lines.append(f"  {FAIL} Tags obligatoires (MIT202) ABSENTS de ce message :")
        for tag, name, ref in missing:
            lines.append(f"      - {tag} {name}" + (f" ({ref})" if ref else ""))
    else:
        lines.append(f"  {OK} Tous les tags obligatoires MIT202 pour ce type de message sont présents.")

    return "\n".join(lines)


def call(dashboard, label: str, method: str, path: str, body=None):
    """Exécute un appel API via le navigateur (dashboard.api_call, même point
    d'entrée que l'UI) et affiche requête / messages FIX / réponse.

    Retourne (ok, body_ou_None) — "ok" reflète le succès HTTP (True pour un
    rejet métier "statut": "rejete", qui reste une réponse 200 ; False pour
    une HTTPException backend, ex. 400/404)."""
    print(f"\n{HEAD}{'─'*78}{END}")
    print(f"{HEAD}  {label}{END}")
    print(f"{HEAD}{'─'*78}{END}")
    print(f"  Appel API : {method} {path}")
    if body is not None:
        print(f"  Corps     : {json.dumps(body, ensure_ascii=False)}")

    _snapshot_logs()
    result = dashboard.api_call(path, method, body)
    time.sleep(0.15)  # laisser le temps au log applicatif de s'écrire

    logs = _new_logs_since_snapshot()
    fix_lines = [l for l in logs.splitlines() if "[FIX OUT]" in l or "[FIX IN]" in l]
    for l in fix_lines:
        direction, raw = l.split("] ", 1) if "] " in l else (l, "")
        raw = raw.strip()
        tags35 = raw.split("35=")[1].split("|")[0] if "35=" in raw else "?"
        arrow = "→ FIX ENVOYÉ AU MOTEUR" if "[FIX OUT]" in l else "← FIX REÇU DU MOTEUR"
        msg_name = MSG_TYPE_NAMES.get(tags35, tags35)
        print(f"\n  {arrow}  [MsgType 35={tags35} → {msg_name}]")
        print(decode(raw, tags35))

    if result["ok"]:
        print(f"\n  Réponse OK : {json.dumps(result['body'], ensure_ascii=False)}")
        return True, result["body"]
    print(f"\n  Réponse ERREUR : {result['error']}")
    return False, None


def main():
    print(f"{HEAD}{'═'*78}{END}")
    print(f"{HEAD}  DÉMO FIX 5.0/FIXT.1.1 — plateforme-bourse-enligne (MIT202 LSE, LOCAL){END}")
    print(f"{HEAD}{'═'*78}{END}")
    print(f"\n  Légende de conformité (par tag, d'après les tableaux 6.2/6.4 de MIT202) :")
    print(f"    {OK} Y  = obligatoire, présent")
    print(f"    {DIM}~ C{END}  = conditionnel (dépend du contexte), présent")
    print(f"    {DIM}  N{END}  = optionnel, présent")
    print(f"    {FAIL} ? = tag hors spécification MIT202 (héritage FIX 4.4, etc.)")

    print(f"\n{DIM}Vérification du solde de '{USERNAME}' (minimum garanti : {SOLDE_MIN:,.2f} MAD)...{END}")
    _assurer_solde_minimum()

    print(f"\n{DIM}Connexion navigateur (headless, {FRONTEND_URL}) via Keycloak — compte '{USERNAME}'...{END}")
    driver = _make_driver()
    try:
        home      = HomePage(driver, FRONTEND_URL)
        kc        = KeycloakPage(driver, FRONTEND_URL)
        dashboard = DashboardPage(driver, FRONTEND_URL)

        home.go()
        home.click_login()
        home.wait_url_contains("realms")
        kc.login(USERNAME, PASSWORD)
        # callback.js effectue l'échange de code PKCE en asynchrone PUIS
        # redirige vers inscription.html OU dashboard.html selon un
        # heuristique purement CLIENT (localStorage["bourse_profil_<sub>"],
        # posé par le wizard — sans rapport avec l'état réel du profil en
        # base). Il faut attendre que cet échange se termine (l'un des deux
        # redirects) AVANT d'intervenir, sinon naviguer trop tôt interrompt
        # le fetch du token en cours et aucun token n'est jamais enregistré.
        WebDriverWait(driver, 60).until(
            lambda d: "inscription" in d.current_url or "dashboard" in d.current_url
        )
        if "dashboard" not in driver.current_url:
            # "investisseur1" est un compte fixture déjà complet côté
            # backend/DB (voir backend/README.md) : les tokens sont déjà
            # enregistrés à ce stade, donc on navigue directement vers
            # dashboard.html plutôt que de suivre le wizard d'inscription.
            dashboard.go()
            dashboard.wait_url_contains("dashboard")
        if not dashboard.is_loaded():
            fail(f"Connexion échouée pour '{USERNAME}' — le dashboard ne s'est pas chargé.")
        print(f"{OK} Connecté, dashboard chargé.")

        n = 0

        def step(label_suffix, method, path, body=None):
            nonlocal n
            r = call(dashboard, f"ÉTAPE {n} — {label_suffix}", method, path, body)
            n += 1
            return r

        def pre_buy(quantite: int, prix: float) -> None:
            """
            Achat au marché pour garantir une position avant un ordre de vente
            et établir le dernier prix négocié (utile pour Stop/Offset). Un
            ordre Market s'exécute toujours instantanément via la simulation
            market maker (aucune contrepartie requise).
            """
            step(f"Pré-achat position {SYM} ({quantite} @ {prix} MAD — 35=D, market maker)",
                 "POST", "/api/ordres", {
                     "instrument_code": SYM, "sens": "achat", "type_ordre": "marche",
                     "quantite": quantite, "prix_marche": prix,
                 })

        def mass_cancel(label_suffix, symbol=None, group_id=None):
            qs = "&".join(
                p for p in (f"symbol={symbol}" if symbol else "", f"group_id={group_id}" if group_id else "") if p
            )
            path = "/api/ordres/annuler-tout" + (f"?{qs}" if qs else "")
            return step(label_suffix, "PUT", path)

        mass_cancel("Nettoyage : annuler tous les ordres existants du compte (35=q)")

        _, r2 = step("Vente limite ATW 40 @ 488 MAD (New Order Single, 35=D)",
                     "POST", "/api/ordres", {
                         "instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
                         "quantite": 40, "prix_limite": 488.0, "time_in_force": "day",
                     })

        _, r3 = step("Achat limite ATW 100 @ 490 MAD (croise → partiellement exécuté, 35=D)",
                     "POST", "/api/ordres", {
                         "instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
                         "quantite": 100, "prix_limite": 490.0, "time_in_force": "day",
                     })
        ordre_id = r3.get("id") if r3 else None

        step("Modification INVALIDE : réduire à 20 (< 40 déjà exécuté) — 35=G",
             "PUT", f"/api/ordres/{ordre_id}/modifier", {"quantite": 20})

        step("Modification VALIDE : réduire à 90 (>= 40 déjà exécuté) — 35=G",
             "PUT", f"/api/ordres/{ordre_id}/modifier", {"quantite": 90})

        step("Annuler le reliquat d'un ordre partiellement exécuté (35=F)",
             "PUT", f"/api/ordres/{ordre_id}/annuler")

        mass_cancel("Nettoyage : Mass Cancel (35=q)")

        # ── Types d'ordre et TIF avancés MIT202 — couverture complète ─────────
        # Tous les scénarios ci-dessous réutilisent SYM=ATW (déjà existant en
        # base) au lieu de symboles DEMO* dédiés, avec un Mass Cancel ciblé
        # (?symbol=ATW) en fin de section pour repartir d'un carnet propre —
        # évite d'accumuler de nouveaux symboles dans marche.instruments à
        # chaque exécution de cette démo.
        pre_buy(400, 490.0)

        # -- Stop / Stop Limit : acceptés non déclenchés, puis déclenchement --
        step("Ordre Stop achat (StopPx=505, non déclenché — 35=D)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "achat", "type_ordre": "stop",
                 "quantite": 5, "prix_marche": 500.0, "stop_px": 505.0,
             })
        step("Ordre Stop Limit achat (StopPx=505/Price=506, non déclenché — 35=D)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "achat", "type_ordre": "stop_limite",
                 "quantite": 5, "stop_px": 505.0, "prix_limite": 506.0,
             })
        step("Vente 20 @ 506 (établit un nouveau prix négocié qui franchit StopPx=505)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
                 "quantite": 20, "prix_limite": 506.0, "time_in_force": "day",
             })
        step("Achat croisant à 506 (déclenche les Stop/Stop Limit en attente)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
                 "quantite": 20, "prix_limite": 506.0, "time_in_force": "day",
             })
        step("Lister les ordres : confirme le déclenchement Stop/Stop Limit (GET /api/ordres)",
             "GET", "/api/ordres")
        mass_cancel(f"Nettoyage fin de section Stop/Stop Limit : Mass Cancel ciblé {SYM}", symbol=SYM)

        # -- Iceberg Fixed Peak : clip visible + réapprovisionnement ---------
        step("Iceberg Fixed Peak achat 50 (DisplayQty=10 — 35=D)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "achat", "type_ordre": "iceberg",
                 "quantite": 50, "prix_limite": 90.0, "display_qty": 10,
             })
        step("Snapshot : le bid Iceberg n'affiche que 10, pas 50",
             "GET", f"/api/ordres/carnet/{SYM}")
        step("Vente 6 @ 90 (fill partiel du clip visible, pas encore épuisé)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
                 "quantite": 6, "prix_limite": 90.0, "time_in_force": "day",
             })
        step("Snapshot : clip réduit à 4",
             "GET", f"/api/ordres/carnet/{SYM}")
        step("Vente 6 @ 90 (épuise le clip → réapprovisionnement automatique)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
                 "quantite": 6, "prix_limite": 90.0, "time_in_force": "day",
             })
        step("Snapshot : clip réapprovisionné à 10 (nouvelle priorité temps)",
             "GET", f"/api/ordres/carnet/{SYM}")
        mass_cancel(f"Nettoyage fin de section Iceberg Fixed Peak : Mass Cancel ciblé {SYM}", symbol=SYM)

        # -- Iceberg Random Replenished : taille de clip variable après réappro
        step("Iceberg Random Replenished achat 50 (DisplayQty=10 — 35=D)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "achat", "type_ordre": "iceberg",
                 "quantite": 50, "prix_limite": 90.0, "display_qty": 10, "display_method": "random",
             })
        step("Snapshot : clip initial = 10",
             "GET", f"/api/ordres/carnet/{SYM}")
        step("Vente 10 @ 90 (épuise le clip → réapprovisionnement ALÉATOIRE entre 5 et 10)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
                 "quantite": 10, "prix_limite": 90.0, "time_in_force": "day",
             })
        step("Snapshot : nouveau clip (taille variable, pas toujours 10 comme Fixed Peak)",
             "GET", f"/api/ordres/carnet/{SYM}")
        mass_cancel(f"Nettoyage fin de section Iceberg Random : Mass Cancel ciblé {SYM}", symbol=SYM)

        # -- Hidden : invisible dans le carnet, participe quand même au matching
        step("Ordre Hidden vente 40 @ 510 (DisplayMethod=hidden — 35=D)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "vente", "type_ordre": "cache",
                 "quantite": 40, "prix_limite": 510.0,
             })
        step("Snapshot : l'ask masqué n'apparaît pas dans le carnet",
             "GET", f"/api/ordres/carnet/{SYM}")
        step("Achat 40 @ 510 : exécuté malgré l'absence de l'ask dans le carnet",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
                 "quantite": 40, "prix_limite": 510.0, "time_in_force": "day",
             })
        mass_cancel(f"Nettoyage fin de section Hidden : Mass Cancel ciblé {SYM}", symbol=SYM)

        # -- Pegged : prix au midpoint du BBO + MES (MinQty) -----------------
        step("Setup : ask à 102 (New Order, 35=D)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
                 "quantite": 100, "prix_limite": 102.0, "time_in_force": "day",
             })
        step("Setup : bid à 98",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
                 "quantite": 100, "prix_limite": 98.0, "time_in_force": "day",
             })
        step("Ordre Pegged achat 50, MinQty=30 (prix = midpoint = 100 — 35=D)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "achat", "type_ordre": "pegged",
                 "quantite": 50, "min_qty": 30,
             })
        step("Snapshot : le bid Pegged est à 100.0 (midpoint 98/102)",
             "GET", f"/api/ordres/carnet/{SYM}")
        step("Vente 10 @ 100 (< MinQty=30 → refusé, le vendeur reste en attente)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
                 "quantite": 10, "prix_limite": 100.0, "time_in_force": "day",
             })
        step("Vente 40 @ 100 (>= MinQty=30 → accepté, exécuté contre le Pegged)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
                 "quantite": 40, "prix_limite": 100.0, "time_in_force": "day",
             })
        step("Correctif Phase 4/5 — MinQty incompatible avec Pegged IOC (rejeté, 6.4.1)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "achat", "type_ordre": "pegged",
                 "quantite": 50, "min_qty": 30, "time_in_force": "ioc",
             })
        mass_cancel(f"Nettoyage fin de section Pegged : Mass Cancel ciblé {SYM}", symbol=SYM)

        # -- Offset : prix = DRP ± DRP×Offset (2.1.1.2) ----------------------
        step("Setup : dernier prix négocié = 400 (vente + achat croisant, 35=D)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
                 "quantite": 10, "prix_limite": 400.0, "time_in_force": "day",
             })
        step("Achat croisant à 400",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
                 "quantite": 10, "prix_limite": 400.0, "time_in_force": "day",
             })
        step("Ordre Offset achat 20, Offset=100bp, TIF=ATC (35=D)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "achat", "type_ordre": "offset",
                 "quantite": 20, "offset_bp": 100.0, "time_in_force": "atc",
             })
        step("Snapshot : le bid Offset est à 404.0 (DRP=400 + DRP×1%, achat/offset positif)",
             "GET", f"/api/ordres/carnet/{SYM}")
        mass_cancel(f"Nettoyage fin de section Offset : Mass Cancel ciblé {SYM}", symbol=SYM)

        # -- TIF GTD / GTT : expiration + non-régression Cancel/Replace ------
        _, r_gtd = step("Ordre limite achat, TIF=GTD, ExpireDate future (35=D)",
                        "POST", "/api/ordres", {
                            "instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
                            "quantite": 10, "prix_limite": 300.0,
                            "time_in_force": "gtd", "expire_date": "2030-01-01",
                        })
        # Correctif Phase 4/5 : ordres_bourse.py reconduit ExpireDate
        # automatiquement sur le replace — sans ce correctif, le moteur
        # rejette tout replace d'un ordre GTD dont Expire{Time,Date} n'est
        # pas répété (2.10.20).
        step("Replace GTD (non-régression : ExpireDate reconduit automatiquement) — 35=G",
             "PUT", f"/api/ordres/{r_gtd['id']}/modifier", {"quantite": 8})
        step("Ordre limite achat, TIF=GTT, ExpireTime déjà dépassée (35=D)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
                 "quantite": 10, "prix_limite": 300.0,
                 "time_in_force": "gtt", "expire_time": "2020-01-01T00:00:00Z",
             })
        step("Un second ordre déclenche le sweep d'expiration",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
                 "quantite": 5, "prix_limite": 999.0, "time_in_force": "day",
             })
        step("Lister les ordres : confirme le statut 'expire' de l'ordre GTT (GET /api/ordres)",
             "GET", "/api/ordres")
        mass_cancel(f"Nettoyage fin de section GTD/GTT : Mass Cancel ciblé {SYM}", symbol=SYM)

        # -- TIF d'enchère OPG/ATC/GFX/GFA/GFS : acceptés quelle que soit la
        # phase — simplification assumée (cf. FIX_PROTOCOL.md) : ce moteur
        # n'implémente pas d'algorithme d'uncrossing multilatéral dédié — ces
        # TIF suivent le chemin déjà codé pour la pré-ouverture/le continu
        # selon la phase RÉELLE au moment de l'appel. On démontre ici
        # l'ACCEPTATION FIX de chaque valeur (tag 59 correct), pas le
        # comportement d'enchère à proprement parler.
        for tif in ("opg", "atc", "gfx", "gfa", "gfs"):
            step(f"Ordre limite achat, TIF={tif.upper()} (35=D)",
                 "POST", "/api/ordres", {
                     "instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
                     "quantite": 10, "prix_limite": 200.0, "time_in_force": tif,
                 })
        mass_cancel(f"Nettoyage fin de section TIF d'enchère : Mass Cancel ciblé {SYM}", symbol=SYM)

        # -- TIF CPX : mis en file d'attente du prix de clôture --------------
        step("Ordre CPX achat (TradingSessionID=336=a — 35=D)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
                 "quantite": 15, "prix_limite": 250.0, "time_in_force": "cpx",
             })
        step("Ordre CPX vente (35=D)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
                 "quantite": 15, "prix_limite": 250.0, "time_in_force": "cpx",
             })
        mass_cancel(f"Nettoyage fin de section CPX : Mass Cancel ciblé {SYM}", symbol=SYM)

        # -- GroupID (27017) : Mass Cancel ciblé par groupe (530=56 For Group)
        step("Ordre limite achat groupe=7 (GroupID=27017 — 35=D)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
                 "quantite": 10, "prix_limite": 80.0, "group_id": "7",
             })
        step("Ordre limite achat groupe=8 (autre groupe, ne doit PAS être annulé)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
                 "quantite": 12, "prix_limite": 79.0, "group_id": "8",
             })
        mass_cancel("Mass Cancel ciblé GroupID=7 (530=56 For Group)", group_id="7")
        step("Snapshot : seul l'ordre du groupe 8 reste dans le carnet",
             "GET", f"/api/ordres/carnet/{SYM}")

        # Correctif Phase 4/5 : MassCancelRequestType=57 (For Instrument For
        # Group) — ce moteur n'a pas de notion de Member ID
        # (TargetPartyRole=76 uniquement) → toujours rejeté par le gateway
        # LSE réel (6.4.3), reproduit ici volontairement (cf. test_fix.py
        # Scénario AD) plutôt que simulé comme fonctionnel.
        step(f"MassCancelRequestType=57 (symbol={SYM}+group_id=8) — toujours rejeté (6.4.3)",
             "PUT", f"/api/ordres/annuler-tout?symbol={SYM}&group_id=8")
        mass_cancel(f"Nettoyage fin de section GroupID : Mass Cancel ciblé {SYM}", symbol=SYM)

        # -- PassiveOnlyOrder (27010) : rejet si croiserait une contrepartie
        # visible
        step("Ask visible à 700 (35=D)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
                 "quantite": 10, "prix_limite": 700.0, "time_in_force": "day",
             })
        step("Achat PassiveOnly à 705 (croiserait le ask visible → REJETÉ, 27010=99)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
                 "quantite": 10, "prix_limite": 705.0, "passive_only": True,
             })
        step("Achat PassiveOnly à 690 (ne croise rien → accepté, repos dans le carnet)",
             "POST", "/api/ordres", {
                 "instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
                 "quantite": 10, "prix_limite": 690.0, "passive_only": True,
             })

        mass_cancel("Nettoyage final de tous les ordres avancés : Mass Cancel (35=q)")

        print(f"\n{HEAD}{'═'*78}{END}")
        print(f"{DIM}Limite connue (non corrigée) : lorsqu'un ordre au repos d'un AUTRE appel est\n"
              f"exécuté par la contrepartie courante, seul l'appelant HTTP reçoit une mise à\n"
              f"jour — l'ordre au repos n'est notifié/persisté qu'au prochain redémarrage\n"
              f"(reload_order_book). Voir la conversation pour le détail.{END}")
        print(f"{HEAD}{'═'*78}{END}\n")
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
