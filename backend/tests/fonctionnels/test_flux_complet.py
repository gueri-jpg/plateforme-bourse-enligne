"""Test fonctionnel — flux complet bourse post-déploiement.

UN seul utilisateur créé en début de test, qui traverse tout le parcours :
  page d'accueil → inscription KC → wizard profil → dashboard
  → vérification portefeuille + solde → passage d'un ordre marché
  → ordre limité en_attente → carnet d'ordres → annulation → déconnexion
  → re-login → déconnexion finale

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

    # ── Étape 11 : Déconnexion finale ─────────────────────────────────────────
    dashboard.click_logout()
    dashboard.wait_url_not_contains("dashboard")
    assert "dashboard" not in drv.current_url, "Déconnexion finale doit réussir"
