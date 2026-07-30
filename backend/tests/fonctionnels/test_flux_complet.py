"""Test fonctionnel — flux complet bourse post-déploiement.

UN seul utilisateur créé en début de test, qui traverse tout le parcours :
  page d'accueil → inscription KC → wizard profil → dashboard
  → vérification portefeuille + solde → passage d'un ordre marché
  → ordre limité en_attente → carnet d'ordres → annulation
  → types d'ordre et TIF avancés MIT202 (Stop/Iceberg/Pegged/Offset/GTD/GTT/
    auctions/CPX/GroupID/PassiveOnly, via l'API sous-jacente)
  → déconnexion → re-login
  → nettoyage complet (Mass Cancel + suppression du compte de test,
    Keycloak + PostgreSQL) → vérification que le compte est bien supprimé.

Tourne contre l'URL de production déployée (BOURSE_BASE_URL).

Décodage/conformité MIT202 des messages FIX : les scénarios d'ordres
avancés (Étape 8bis) décodent aussi, quand c'est possible, les messages
[FIX OUT]/[FIX IN] réellement échangés avec le moteur — même vérification
que demo_fix_flow.py, mais lue depuis les logs du pod backend via
`kubectl logs` (deploy.yml, job "tests-fonctionnels", authentifié avec la
même identité de service que le job "deploy") plutôt que `docker logs`
(qui suppose un accès Docker local que ce job CI n'a pas). Repli sur
`docker logs` si aucune variable FIX_TRACE_K8S_NAMESPACE n'est définie
(run local). Si ni l'un ni l'autre n'est disponible, le décodage est
sauté proprement (FixTracer.disponible() == False) sans faire échouer le
test — même tolérance que has_market/has_bvc_ouverte.
"""
import os
import subprocess
import time

from tests.fonctionnels.pages.home_page import HomePage
from tests.fonctionnels.pages.keycloak_page import KeycloakPage
from tests.fonctionnels.pages.inscription_page import InscriptionPage
from tests.fonctionnels.pages.dashboard_page import DashboardPage

# ── Décodage FIX + conformité MIT202 (même référentiel que demo_fix_flow.py) ──
_TAG_NAMES = {
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
_MSG_TYPE_NAMES = {
    "D": "New Order Single", "F": "Order Cancel Request", "G": "Order Cancel/Replace Request",
    "q": "Order Mass Cancel Request", "8": "Execution Report", "9": "Order Cancel Reject",
    "r": "Order Mass Cancel Report", "j": "Business Message Reject",
}
_HEADER_SPEC = {
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
_MSG_SPEC: dict[str, dict[str, tuple[str, str, str]]] = {
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


def _tags_manquants(raw_fix: str, msg_type: str) -> list[tuple[str, str, str]]:
    """Tags marqués obligatoires ("Y") par MIT202 pour msg_type mais absents
    du message raw_fix effectivement transmis."""
    spec = _MSG_SPEC.get(msg_type, {})
    seen_tags = {f.partition("=")[0] for f in raw_fix.split("|") if "=" in f}
    return [
        (tag, name, ref) for tag, (name, status, ref) in spec.items()
        if status == "Y" and tag not in seen_tags
    ]


def _decode_fix(raw_fix: str, msg_type: str) -> str:
    """Décode un message FIX tag par tag, annoté de son statut MIT202
    (obligatoire/conditionnel/optionnel) — même logique que demo_fix_flow.py."""
    spec = _MSG_SPEC.get(msg_type, {})
    seen_tags: set[str] = set()
    lines = [f"  RAW  : {raw_fix}"]
    for field in raw_fix.split("|"):
        if "=" not in field:
            continue
        tag, _, val = field.partition("=")
        seen_tags.add(tag)
        if tag in _HEADER_SPEC:
            name, status, ref = _HEADER_SPEC[tag]
        elif tag in spec:
            name, status, ref = spec[tag]
        else:
            name, status, ref = _TAG_NAMES.get(tag, f"(tag {tag})"), "?", "HORS SPEC MIT202"
        ref_str = f" [{ref}]" if ref else ""
        lines.append(f"    {status:>1} {tag:>5} {name:<24} = {val}{ref_str}")
    missing = _tags_manquants(raw_fix, msg_type)
    if missing:
        lines.append("  Tags obligatoires (MIT202) ABSENTS :")
        for tag, name, ref in missing:
            lines.append(f"      - {tag} {name}" + (f" ({ref})" if ref else ""))
    return "\n".join(lines)


class _FixTracer:
    """
    Lit les logs applicatifs du backend pour extraire et décoder les
    messages [FIX OUT]/[FIX IN] échangés depuis le dernier snapshot(), et
    vérifie leur conformité structurelle MIT202 (tags obligatoires
    présents) — même vérification que demo_fix_flow.py, mais avec deux
    sources de logs possibles :
      - kubectl logs -n <namespace> -l <selector> (si FIX_TRACE_K8S_NAMESPACE
        est défini - cf. deploy.yml, job "tests-fonctionnels") : lit le VRAI
        pod backend de production ;
      - docker logs <container> (repli local, run direct sur la machine
        Docker de développement).
    Si aucune des deux n'est disponible, disponible() renvoie False et
    tracer_et_verifier() ne renvoie jamais de non-conformité — l'appelant
    doit rester tolérant (comme has_market/has_bvc_ouverte), pas faire
    échouer le test faute d'accès aux logs.
    """

    def __init__(self, docker_container: str = "bourse-backend"):
        self.docker_container = docker_container
        self.k8s_namespace = os.environ.get("FIX_TRACE_K8S_NAMESPACE")
        self.k8s_selector = os.environ.get("FIX_TRACE_K8S_SELECTOR", "app.kubernetes.io/component=backend")
        self._baseline_len: dict[str, int] = {}
        self._mode: str | None = None

    def _cmd_ok(self, cmd: list[str]) -> bool:
        try:
            return subprocess.run(cmd, capture_output=True, text=True, timeout=10).returncode == 0
        except Exception:
            return False

    def _mode_detecte(self) -> str:
        if self._mode is not None:
            return self._mode
        if self.k8s_namespace and self._cmd_ok(
            ["kubectl", "get", "pods", "-n", self.k8s_namespace, "-l", self.k8s_selector]
        ):
            self._mode = "k8s"
        elif self._cmd_ok(["docker", "logs", "--tail", "1", self.docker_container]):
            self._mode = "docker"
        else:
            self._mode = "absent"
        return self._mode

    def disponible(self) -> bool:
        return self._mode_detecte() != "absent"

    def _pods(self) -> list[str]:
        """
        Liste les pods correspondant au sélecteur. Le backend tourne avec
        plusieurs réplicas en production (values.yaml, replicaCount.backend)
        et le load-balancer Kubernetes répartit les requêtes entre eux — voir
        _logs_par_pod pour pourquoi chaque pod doit être diffé séparément.
        """
        out = subprocess.run(
            ["kubectl", "get", "pods", "-n", self.k8s_namespace, "-l", self.k8s_selector,
             "-o", "jsonpath={.items[*].metadata.name}"],
            capture_output=True, text=True, timeout=10,
        )
        return out.stdout.split() if out.returncode == 0 else []

    def _logs_par_pod(self) -> dict[str, str]:
        """
        Logs bruts par pod (clé = nom du pod, ou le nom du conteneur Docker
        en mode local). Un `kubectl logs -l <selector>` concatène les logs de
        TOUS les pods correspondants, pod par pod (pas entrelacés par
        horodatage) : avec 2+ réplicas, si le pod A grossit entre deux
        appels, tout le texte du/des pod(s) suivant(s) dans cette
        concaténation se décale d'autant — un diff par simple longueur totale
        de caractères (comme avant) fait alors passer les nouvelles lignes du
        pod A pour "déjà vues", puisqu'elles atterrissent avant l'ancien
        offset. Ne diffe correctement que si on isole chaque pod.
        """
        mode = self._mode_detecte()
        if mode == "k8s":
            logs: dict[str, str] = {}
            for pod in self._pods():
                out = subprocess.run(
                    ["kubectl", "logs", "-n", self.k8s_namespace, pod,
                     "--all-containers=true", "--prefix=true", "--tail=5000"],
                    capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
                )
                logs[pod] = out.stdout + out.stderr
            return logs
        elif mode == "docker":
            out = subprocess.run(
                ["docker", "logs", self.docker_container],
                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15,
            )
            return {self.docker_container: out.stdout + out.stderr}
        return {}

    def snapshot(self) -> None:
        if self.disponible():
            self._baseline_len = {pod: len(logs) for pod, logs in self._logs_par_pod().items()}

    def tracer_et_verifier(self, print_fn=print) -> list[str]:
        if not self.disponible():
            return []
        logs_actuels = self._logs_par_pod()
        nouvelles_lignes: list[str] = []
        for pod, full in logs_actuels.items():
            baseline = self._baseline_len.get(pod, 0)
            nouveau = full[baseline:] if len(full) > baseline else ""
            nouvelles_lignes.extend(nouveau.splitlines())
        self._baseline_len = {pod: len(full) for pod, full in logs_actuels.items()}

        problemes = []
        for l in nouvelles_lignes:
            # Découper sur le marqueur applicatif "[FIX OUT]"/"[FIX IN]"
            # lui-même, pas sur le premier "] " de la ligne : avec
            # `kubectl logs --prefix=true`, la ligne porte AUSSI un préfixe
            # "[pod/xxx] " ajouté par kubectl avant le log applicatif
            # (horodatage, logger, PUIS "[FIX OUT]") — s'arrêter au premier
            # "] " laisserait ce préfixe + le log applicatif dans "raw".
            if "[FIX OUT]" in l:
                raw = l.split("[FIX OUT]", 1)[1].strip()
                arrow = "→ FIX ENVOYÉ AU MOTEUR"
            elif "[FIX IN]" in l:
                raw = l.split("[FIX IN]", 1)[1].strip()
                arrow = "← FIX REÇU DU MOTEUR"
            else:
                continue
            tags35 = raw.split("35=")[1].split("|")[0] if "35=" in raw else "?"
            print_fn(f"\n  {arrow}  [MsgType 35={tags35} → {_MSG_TYPE_NAMES.get(tags35, tags35)}]")
            print_fn(_decode_fix(raw, tags35))
            manquants = _tags_manquants(raw, tags35)
            if manquants:
                noms = ", ".join(f"{t} {n}" for t, n, _ in manquants)
                problemes.append(f"[MsgType {tags35}] tags obligatoires absents : {noms} — {raw}")
        return problemes


def test_flux_complet(session_driver, base_url, new_user):
    drv = session_driver
    home        = HomePage(drv, base_url)
    kc          = KeycloakPage(drv, base_url)
    inscription = InscriptionPage(drv, base_url)
    dashboard   = DashboardPage(drv, base_url)

    # ── Vérification page d'accueil ──────────────────────────────────────────
    home.go()
    assert home.is_login_btn_visible(),    "Bouton Se connecter doit être visible"
    assert home.is_register_btn_visible(), "Bouton Ouvrir un compte doit être visible"

    # ── Mauvais login → reste sur KC ─────────────────────────────────────────
    home.click_login()
    home.wait_url_contains("realms")
    kc.login(new_user["email"], "MauvaisMotDePasse!")
    assert kc.is_on_keycloak(), "Mauvais mot de passe doit rester sur KC"

    # ── Étape 1 : Inscription via KC ─────────────────────────────────────────
    home.go()
    home.click_register()
    home.wait_url_contains("realms")
    kc.register(
        first_name=new_user["first_name"],
        last_name=new_user["last_name"],
        email=new_user["email"],
        password=new_user["password"],
    )

    # KC redirige vers callback.html → puis vers inscription.html
    inscription.wait_url_contains("inscription")
    assert "inscription" in drv.current_url, "Après inscription KC → doit atterrir sur inscription.html"

    # ── Étape 2 : Wizard d'inscription (passer toutes les étapes) ────────────
    assert inscription.is_loaded(), "Le wizard d'inscription doit être chargé"
    inscription.passer_toutes_etapes()

    # Clic sur 'Accéder à mon espace' → lancerConnexion() → PKCE KC
    inscription.click_acceder_dashboard()
    dashboard.wait_url_contains("dashboard")
    assert dashboard.is_loaded(), "Le dashboard doit être accessible après inscription"

    # ── Étape 3 : Vérification du nom utilisateur ─────────────────────────────
    nom = dashboard.get_user_name()
    assert len(nom) > 0, "Le nom de l'utilisateur doit apparaître dans le header"

    # ── Étape 4 : Navigation portefeuille + vérification solde ───────────────
    dashboard.nav_portefeuille()
    assert dashboard.is_element_visible("#section-portefeuille"), \
        "La section portefeuille doit être visible"
    assert dashboard.is_element_visible(dashboard.CT_SOLDE), \
        "La zone solde #ct-solde doit être rendue dans le portefeuille"

    # ── Étape 5 : Passage d'un ordre au marché ────────────────────────────────
    # Les données marché arrivent via WebSocket — skip si indisponible (marché fermé/API)
    has_market = dashboard.wait_market_data(timeout=60)
    if has_market:
        dashboard.clear_form_msg()
        dashboard.passer_ordre_achat(quantite=1)
        dashboard.confirmer_ordre_modal()
        msg_marche = dashboard.wait_form_result(timeout=15)
        assert msg_marche, "#form-msg doit afficher un résultat après ordre marché"
        assert "dashboard" in drv.current_url, \
            "Doit rester sur le dashboard après passage d'ordre"

    # ── Étape 6 : Ordre limité en_attente ────────────────────────────────────
    # Prix intentionnellement très bas (1 MAD) → ne s'exécutera jamais → en_attente
    if has_market:
        instrument = dashboard.get_first_instrument()
        dashboard.clear_form_msg()
        dashboard.passer_ordre_limite(
            instrument=instrument,
            quantite=1,
            prix_limite=1.0,
            sens="achat",
        )
        dashboard.confirmer_ordre_modal()
        msg_limite = dashboard.wait_form_result(timeout=15)
        assert msg_limite, "#form-msg doit afficher un résultat après ordre limité"

        # ── Étape 7 : Carnet d'ordres ─────────────────────────────────────────
        dashboard.nav_carnet()
        assert dashboard.is_element_visible("#section-carnet"), \
            "La section carnet d'ordres doit être visible"
        count = dashboard.get_ordre_count()
        assert count > 0, f"Carnet doit contenir au moins 1 ordre (got {count})"
        has_rows = dashboard.wait_carnet_orders(timeout=10)
        assert has_rows, "#hist-rows doit contenir des ordres après passage"

        # ── Étape 8 : Annulation de l'ordre en attente ────────────────────────
        if dashboard.is_element_visible(dashboard.CANCEL_BTN_SEL):
            dashboard.click_annuler_first()
            time.sleep(2)  # rafraîchissement asynchrone du carnet (doCancelOrder → chargerOrdres)
            assert dashboard.is_element_visible("#section-carnet"), \
                "Section carnet doit rester visible après annulation"

    # ── Étape 8bis : Types d'ordre et TIF avancés MIT202 (FIX 5.0/FIXT.1.1) ──
    # Port intégral des scénarios de demo_fix_flow.py + des correctifs Phase
    # 4/5 (MinQty, non-régression ExpireTime/ExpireDate au replace, GroupID
    # Mass Cancel, rejet MassCancelRequestType=57), via dashboard.api_call() :
    # le formulaire UI n'expose pas ces champs (Stop/Iceberg/Pegged/Offset/
    # GroupID/PassiveOnly/MinQty), donc on passe par le même point d'entrée
    # HTTP que l'UI (window._apiCall). Indépendant de has_market (chaque
    # scénario utilise des prix explicites, pas les données WebSocket temps
    # réel). Conception validée par smoke-test contre le backend local réel
    # avant portage ici :
    #   - Un seul symbole PARTAGÉ et déjà existant (ATW, utilisé ailleurs
    #     dans ce projet) — pas de DEMO* dédié par scénario : chaque code
    #     inconnu de marche.instruments serait auto-créé par
    #     _get_or_create_instrument() et polluerait cette table en
    #     PRODUCTION à chaque run CI (vérifié : 16+ lignes DEMO* déjà
    #     accumulées en local par des runs antérieurs de demo_fix_flow.py).
    #     L'isolation entre phases est obtenue par un Mass Cancel ciblé
    #     (?symbol=ATW) en fin de chaque phase, pas par un symbole dédié.
    #   - Un compte fraîchement inscrit démarre à solde_especes=0 et n'a
    #     aucune position : impossible de passer le moindre ordre
    #     d'achat/vente sans financement. Le seul dépôt "normal"
    #     (POST /api/portefeuille/depot) exige un vrai paiement vérifié
    #     côté banque, hors de portée ici. On utilise donc
    #     POST /api/portefeuille/crediter-compte-test, réservé aux comptes
    #     dont l'email correspond au format généré par new_user()
    #     ci-dessus — sans effet sur un compte réel (cf. portefeuille.py).
    #
    # NB : le rejet "Hidden + PassiveOnlyOrder=100/1/2/3" (6.4.1) n'est PAS
    # exerçable via cette API REST — OrdreIn.passive_only (bool) ne produit
    # jamais que la valeur FIX 99 (cf. commentaire dans ordres_bourse.py,
    # confirmé par smoke-test). Ce cas reste couvert au niveau moteur par
    # test_fix.py (Scénario AB).
    SYM = "ATW"
    fix_tracer = _FixTracer()

    # Rejets HTTP tolérés : vérifiés dans passer_ordre() AVANT toute
    # construction de message FIX (solde/position), donc rien à décoder pour
    # ces cas précis. Attendus quand pre_buy (ordre au marché) a lui-même été
    # rejeté faute de séance BVC ouverte (09h00-15h30 Casablanca) — les
    # ventes qui suivent n'ont alors aucune position à céder. On tolère et
    # on continue (comme demo_fix_flow.py, qui n'interrompt jamais sa
    # séquence sur ce type de rejet) plutôt que de sauter tout le bloc de
    # scénarios : la plupart sont des ordres limite (achats), jamais
    # bloqués par l'horaire, et produisent bien un message FIX à décoder.
    _ERREURS_TOLEREES = ("quantité insuffisante", "solde insuffisant")

    def ordre(body):
        fix_tracer.snapshot()
        r = dashboard.api_call("/api/ordres", "POST", body)
        if not r["ok"]:
            erreur = (r.get("error") or "").lower()
            if any(m in erreur for m in _ERREURS_TOLEREES):
                print(f"\n  (toléré — position/solde indisponible) {body} : {r['error']}")
                return {"statut": "position_indisponible", "id": None}
            assert False, f"Ordre rejeté au niveau HTTP ({body}) : {r['error']}"
        problemes = fix_tracer.tracer_et_verifier()
        assert not problemes, "Non-conformité MIT202 (tags obligatoires absents) :\n" + "\n".join(problemes)
        return r["body"]

    def mass_cancel(symbol=None, group_id=None):
        qs = "&".join(
            p for p in (f"symbol={symbol}" if symbol else "", f"group_id={group_id}" if group_id else "") if p
        )
        fix_tracer.snapshot()
        r = dashboard.api_call(f"/api/ordres/annuler-tout{'?' + qs if qs else ''}", "PUT")
        problemes = fix_tracer.tracer_et_verifier()
        assert not problemes, "Non-conformité MIT202 (tags obligatoires absents) :\n" + "\n".join(problemes)
        return r

    r_credit = dashboard.api_call("/api/portefeuille/crediter-compte-test", "POST", {})
    assert r_credit["ok"], f"Crédit du compte de test échoué : {r_credit.get('error')}"

    r_clean0 = mass_cancel()
    assert r_clean0["ok"], f"Nettoyage initial (Mass Cancel) échoué : {r_clean0.get('error')}"

    # Ordre au marché servant à établir la position initiale : rejeté hors
    # séance BVC (09h00-15h30 Casablanca) — cf.
    # fix_engine.get_market_phase()/MarketPhase.CLOSED, un rejet FIX légitime,
    # pas un bug. Sans ce préalable, les ventes qui suivent (Stop/Iceberg/
    # Hidden/Pegged/Offset/GTD/GTT/PassiveOnly) seront tolérées comme
    # "position indisponible" par ordre() ci-dessus plutôt que de sauter tout
    # le bloc : les achats (la majorité des scénarios), eux, sont des ordres
    # limite jamais bloqués par l'horaire et s'exécutent/se décodent toujours.
    ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "marche",
           "quantite": 400, "prix_marche": 490.0})

    # -- Stop / Stop Limit : acceptés non déclenchés, puis déclenchement réel --
    ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "stop",
           "quantite": 5, "prix_marche": 500.0, "stop_px": 505.0})
    ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "stop_limite",
           "quantite": 5, "stop_px": 505.0, "prix_limite": 506.0})
    ordre({"instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
           "quantite": 20, "prix_limite": 506.0, "time_in_force": "day"})
    ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
           "quantite": 20, "prix_limite": 506.0, "time_in_force": "day"})

    # -- Correctif Phase 4/5 : MinQty rejeté hors Pegged DAY/GTT (6.4.1/6.4.4) --
    r_minqty = ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
                       "quantite": 5, "prix_limite": 500.0, "min_qty": 3})
    assert r_minqty["statut"] == "rejete", "MinQty sur un ordre Limit doit être rejeté"
    r_p1 = mass_cancel(symbol=SYM)
    assert r_p1["ok"], f"Mass Cancel fin phase Stop échoué : {r_p1.get('error')}"

    # -- Iceberg Fixed Peak : clip visible + réapprovisionnement -----------------
    ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "iceberg",
           "quantite": 50, "prix_limite": 90.0, "display_qty": 10})
    snap_ice1 = dashboard.api_call(f"/api/ordres/carnet/{SYM}", "GET")
    assert snap_ice1["ok"], f"Snapshot carnet échoué : {snap_ice1.get('error')}"
    ordre({"instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
           "quantite": 6, "prix_limite": 90.0, "time_in_force": "day"})
    ordre({"instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
           "quantite": 6, "prix_limite": 90.0, "time_in_force": "day"})
    r_p2 = mass_cancel(symbol=SYM)
    assert r_p2["ok"], f"Mass Cancel fin phase Iceberg Fixed Peak échoué : {r_p2.get('error')}"

    # -- Iceberg Random Replenished : taille de clip variable après réappro ----
    ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "iceberg",
           "quantite": 50, "prix_limite": 90.0, "display_qty": 10, "display_method": "random"})
    ordre({"instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
           "quantite": 10, "prix_limite": 90.0, "time_in_force": "day"})
    r_p3 = mass_cancel(symbol=SYM)
    assert r_p3["ok"], f"Mass Cancel fin phase Iceberg Random échoué : {r_p3.get('error')}"

    # -- Hidden : invisible dans le carnet, participe quand même au matching --
    ordre({"instrument_code": SYM, "sens": "vente", "type_ordre": "cache",
           "quantite": 40, "prix_limite": 510.0})
    snap_hid = dashboard.api_call(f"/api/ordres/carnet/{SYM}", "GET")
    assert snap_hid["ok"], f"Snapshot carnet échoué : {snap_hid.get('error')}"
    ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
           "quantite": 40, "prix_limite": 510.0, "time_in_force": "day"})
    r_p4 = mass_cancel(symbol=SYM)
    assert r_p4["ok"], f"Mass Cancel fin phase Hidden échoué : {r_p4.get('error')}"

    # -- Pegged : prix au midpoint du BBO + MES (MinQty) -------------------------
    ordre({"instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
           "quantite": 100, "prix_limite": 102.0, "time_in_force": "day"})
    ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
           "quantite": 100, "prix_limite": 98.0, "time_in_force": "day"})
    ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "pegged",
           "quantite": 50, "min_qty": 30})
    ordre({"instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
           "quantite": 10, "prix_limite": 100.0, "time_in_force": "day"})
    ordre({"instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
           "quantite": 40, "prix_limite": 100.0, "time_in_force": "day"})

    # -- Correctif Phase 4/5 : MinQty incompatible avec Pegged IOC/FOK (6.4.1) --
    r_peg_ioc = ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "pegged",
                        "quantite": 50, "min_qty": 30, "time_in_force": "ioc"})
    assert r_peg_ioc["statut"] == "rejete", "MinQty sur un Pegged IOC doit être rejeté"
    r_p5 = mass_cancel(symbol=SYM)
    assert r_p5["ok"], f"Mass Cancel fin phase Pegged échoué : {r_p5.get('error')}"

    # -- Offset : prix = DRP ± DRP×Offset (2.1.1.2) ------------------------------
    ordre({"instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
           "quantite": 10, "prix_limite": 400.0, "time_in_force": "day"})
    ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
           "quantite": 10, "prix_limite": 400.0, "time_in_force": "day"})
    ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "offset",
           "quantite": 20, "offset_bp": 100.0, "time_in_force": "atc"})
    r_p6 = mass_cancel(symbol=SYM)
    assert r_p6["ok"], f"Mass Cancel fin phase Offset échoué : {r_p6.get('error')}"

    # -- TIF GTD/GTT : expiration + non-régression Cancel/Replace (2.10.20) ----
    r_gtd = ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
                   "quantite": 10, "prix_limite": 300.0,
                   "time_in_force": "gtd", "expire_date": "2030-01-01"})
    # Correctif Phase 4/5 : ordres_bourse.py doit reconduire ExpireDate
    # automatiquement sur le replace — sans ce correctif, le moteur rejette
    # tout replace d'un ordre GTD dont Expire{Time,Date} n'est pas répété.
    # r_gtd["id"] est toujours valide (achat, non bloqué par l'horaire).
    fix_tracer.snapshot()
    r_replace_gtd = dashboard.api_call(f"/api/ordres/{r_gtd['id']}/modifier", "PUT", {"quantite": 8})
    assert r_replace_gtd["ok"], \
        f"Replace GTD (non-régression ExpireDate) échoué : {r_replace_gtd.get('error')}"
    problemes_replace = fix_tracer.tracer_et_verifier()
    assert not problemes_replace, \
        "Non-conformité MIT202 (tags obligatoires absents) :\n" + "\n".join(problemes_replace)
    ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
           "quantite": 10, "prix_limite": 300.0,
           "time_in_force": "gtt", "expire_time": "2020-01-01T00:00:00Z"})
    ordre({"instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
           "quantite": 5, "prix_limite": 999.0, "time_in_force": "day"})
    r_p7 = mass_cancel(symbol=SYM)
    assert r_p7["ok"], f"Mass Cancel fin phase GTD/GTT échoué : {r_p7.get('error')}"

    # -- TIF d'enchère OPG/ATC/GFX/GFA/GFS : acceptation FIX (35=D) --------------
    # Simplification assumée (cf. FIX_PROTOCOL.md) : pas d'algorithme
    # d'uncrossing multilatéral dédié — ces TIF suivent le chemin déjà codé
    # pour la pré-ouverture/le continu selon la phase réelle au moment de
    # l'appel ; on démontre ici l'acceptation FIX, pas le comportement
    # d'enchère (qui dépend de l'heure de Casablanca au moment du run).
    for tif in ("opg", "atc", "gfx", "gfa", "gfs"):
        ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
               "quantite": 10, "prix_limite": 200.0, "time_in_force": tif})
    r_p8 = mass_cancel(symbol=SYM)
    assert r_p8["ok"], f"Mass Cancel fin phase Auctions échoué : {r_p8.get('error')}"

    # -- TIF CPX : mise en file d'attente du prix de clôture ---------------------
    ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
           "quantite": 15, "prix_limite": 250.0, "time_in_force": "cpx"})
    ordre({"instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
           "quantite": 15, "prix_limite": 250.0, "time_in_force": "cpx"})
    r_p9 = mass_cancel(symbol=SYM)
    assert r_p9["ok"], f"Mass Cancel fin phase CPX échoué : {r_p9.get('error')}"

    # -- Correctif Phase 4/5 : GroupID (27017) + Mass Cancel ciblé (530=56/57) --
    ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
           "quantite": 10, "prix_limite": 80.0, "group_id": "7"})
    ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
           "quantite": 12, "prix_limite": 79.0, "group_id": "8"})
    r_grp = mass_cancel(group_id="7")
    assert r_grp["ok"], f"Mass Cancel GroupID=7 (530=56) échoué : {r_grp.get('error')}"

    # MassCancelRequestType=57 (For Instrument For Group) : ce moteur n'a pas
    # de notion de Member ID (TargetPartyRole=76 uniquement) → toujours
    # rejeté par le gateway LSE réel (6.4.3), reproduit ici volontairement
    # (cf. test_fix.py Scénario AD) plutôt que simulé comme fonctionnel.
    r_57 = mass_cancel(symbol=SYM, group_id="8")
    assert not r_57["ok"], "MassCancelRequestType=57 doit être rejeté (non supporté, 6.4.3)"
    r_p10 = mass_cancel(symbol=SYM)
    assert r_p10["ok"], f"Mass Cancel fin phase GroupID échoué : {r_p10.get('error')}"

    # -- PassiveOnlyOrder (27010) : rejet si croisement d'une contrepartie visible
    r_psv_ask = ordre({"instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
                        "quantite": 10, "prix_limite": 700.0, "time_in_force": "day"})
    r_psv1 = ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
                    "quantite": 10, "prix_limite": 705.0, "passive_only": True})
    # L'assertion de rejet ne tient que si l'ask visible a réellement été
    # posé (sinon, hors séance, rien à croiser -> l'achat serait accepté,
    # pas rejeté, sans que ce soit une non-conformité).
    if r_psv_ask["statut"] != "position_indisponible":
        assert r_psv1["statut"] == "rejete", "PassiveOnly qui croiserait un ask visible doit être rejeté"
    r_psv2 = ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
                    "quantite": 10, "prix_limite": 690.0, "passive_only": True})
    assert r_psv2["statut"] != "rejete", "PassiveOnly qui ne croise rien doit être accepté"

    # ── Étape 9 : Déconnexion ─────────────────────────────────────────────────
    dashboard.go()
    dashboard.wait_url_contains("dashboard")
    dashboard.click_logout()
    dashboard.wait_url_not_contains("dashboard")
    assert "dashboard" not in drv.current_url, \
        "Doit être redirigé hors du dashboard après déconnexion"

    # ── Étape 10 : Re-login avec le compte créé ───────────────────────────────
    home.go()
    assert home.is_login_btn_visible(), "Bouton login visible après déconnexion"
    home.click_login()
    home.wait_url_contains("realms")
    kc.login(new_user["email"], new_user["password"])
    dashboard.wait_url_contains("dashboard")
    assert dashboard.is_loaded(), "Re-login doit ramener au dashboard"

    # ── Étape 11 : Nettoyage — Mass Cancel + suppression du compte de test ───
    # Le compte créé par ce test est réel (Keycloak + PostgreSQL). Le runner
    # CI (cf. deploy.yml, job "tests-fonctionnels") tourne après déploiement
    # contre la production et n'a accès qu'à la surface HTTPS publique — donc
    # aucun accès direct à la DB ni à l'API admin Keycloak. La suppression
    # passe forcément par ce endpoint self-service (DELETE /api/utilisateurs/
    # moi), qui supprime en cascade ordres/portefeuille/profil PostgreSQL
    # puis l'utilisateur Keycloak (cf. app/routers/compte_utilisateur.py).
    r_cancel_final = mass_cancel()
    assert r_cancel_final["ok"], f"Nettoyage final (Mass Cancel) échoué : {r_cancel_final.get('error')}"

    r_delete = dashboard.api_call("/api/utilisateurs/moi", "DELETE")
    assert r_delete["ok"], f"Suppression du compte de test échouée : {r_delete.get('error')}"

    # ── Étape 12 : Vérification de la suppression effective ──────────────────
    r_check = dashboard.api_call("/api/utilisateurs/moi/otp", "GET")
    assert not r_check["ok"], "Le compte applicatif doit être introuvable après suppression"

    home.go()
    home.click_login()
    home.wait_url_contains("realms")
    kc.login(new_user["email"], new_user["password"])
    assert kc.is_on_keycloak(), \
        "Une re-connexion après suppression du compte doit échouer (utilisateur Keycloak supprimé)"
