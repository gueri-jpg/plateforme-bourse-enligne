"""Test fonctionnel — flux complet bourse post-déploiement.

UN seul utilisateur créé en début de test, qui traverse tout le parcours :
  page d'accueil → inscription KC → wizard profil → dashboard
  → vérification portefeuille → passage d'un ordre → déconnexion
  → re-login → déconnexion finale

Tourne contre l'URL de production déployée (BOURSE_BASE_URL).
"""
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
    # KC redirige vers le formulaire d'inscription (registrations endpoint)
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
    # KC a une session active depuis l'inscription → auto-login sans formulaire
    inscription.click_acceder_dashboard()
    dashboard.wait_url_contains("dashboard")
    assert dashboard.is_loaded(), "Le dashboard doit être accessible après inscription"

    # ── Étape 4 : Vérification du nom utilisateur ────────────────────────────
    nom = dashboard.get_user_name()
    assert len(nom) > 0, "Le nom de l'utilisateur doit apparaître dans le header"

    # ── Étape 5 : Navigation portefeuille ────────────────────────────────────
    dashboard.nav_portefeuille()
    assert dashboard.is_element_visible("#section-portefeuille"), \
        "La section portefeuille doit être visible"

    # ── Étape 6 : Passage d'un ordre d'achat ─────────────────────────────────
    # Données marché via WebSocket — skip l'ordre si indisponible (marché fermé/API)
    has_market = dashboard.wait_market_data(timeout=60)
    if has_market:
        dashboard.passer_ordre_achat(quantite=1)
        dashboard.confirmer_ordre_modal()
        assert "dashboard" in drv.current_url, \
            "Doit rester sur le dashboard après passage d'ordre"

    # ── Étape 7 : Déconnexion ─────────────────────────────────────────────────
    dashboard.go()
    dashboard.wait_url_contains("dashboard")
    dashboard.click_logout()
    dashboard.wait_url_not_contains("dashboard")
    assert "dashboard" not in drv.current_url, \
        "Doit être redirigé hors du dashboard après déconnexion"

    # ── Étape 8 : Re-login avec le compte créé ────────────────────────────────
    home.go()
    assert home.is_login_btn_visible(), "Bouton login visible après déconnexion"
    home.click_login()
    home.wait_url_contains("realms")
    kc.login(new_user["email"], new_user["password"])
    dashboard.wait_url_contains("dashboard")
    assert dashboard.is_loaded(), "Re-login doit ramener au dashboard"

    # ── Étape 9 : Déconnexion finale ──────────────────────────────────────────
    dashboard.click_logout()
    dashboard.wait_url_not_contains("dashboard")
    assert "dashboard" not in drv.current_url, "Déconnexion finale doit réussir"
