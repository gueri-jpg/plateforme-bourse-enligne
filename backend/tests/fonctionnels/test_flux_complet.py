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
"""
import time

from tests.fonctionnels.pages.home_page import HomePage
from tests.fonctionnels.pages.keycloak_page import KeycloakPage
from tests.fonctionnels.pages.inscription_page import InscriptionPage
from tests.fonctionnels.pages.dashboard_page import DashboardPage


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

    def ordre(body):
        r = dashboard.api_call("/api/ordres", "POST", body)
        assert r["ok"], f"Ordre rejeté au niveau HTTP ({body}) : {r.get('error')}"
        return r["body"]

    def mass_cancel(symbol=None, group_id=None):
        qs = "&".join(
            p for p in (f"symbol={symbol}" if symbol else "", f"group_id={group_id}" if group_id else "") if p
        )
        return dashboard.api_call(f"/api/ordres/annuler-tout{'?' + qs if qs else ''}", "PUT")

    r_credit = dashboard.api_call("/api/portefeuille/crediter-compte-test", "POST", {})
    assert r_credit["ok"], f"Crédit du compte de test échoué : {r_credit.get('error')}"

    r_clean0 = mass_cancel()
    assert r_clean0["ok"], f"Nettoyage initial (Mass Cancel) échoué : {r_clean0.get('error')}"

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
    r_replace_gtd = dashboard.api_call(f"/api/ordres/{r_gtd['id']}/modifier", "PUT", {"quantite": 8})
    assert r_replace_gtd["ok"], \
        f"Replace GTD (non-régression ExpireDate) échoué : {r_replace_gtd.get('error')}"
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
    ordre({"instrument_code": SYM, "sens": "vente", "type_ordre": "limite",
           "quantite": 10, "prix_limite": 700.0, "time_in_force": "day"})
    r_psv1 = ordre({"instrument_code": SYM, "sens": "achat", "type_ordre": "limite",
                    "quantite": 10, "prix_limite": 705.0, "passive_only": True})
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
    r_cancel_final = dashboard.api_call("/api/ordres/annuler-tout", "PUT")
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
