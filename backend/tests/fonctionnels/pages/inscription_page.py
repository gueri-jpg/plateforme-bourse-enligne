from .base_page import BasePage


class InscriptionPage(BasePage):
    """Wizard d'inscription bourse (inscription.html) — 4 étapes + écran final."""

    STEP1_CONTENT = "#step1"
    STEP5_CONTENT = "#step5"
    BTN_DASHBOARD = ".btn-dashboard"

    def go(self):
        super().go("/inscription.html")

    def is_loaded(self) -> bool:
        return self.is_element_visible(self.STEP1_CONTENT)

    def passer_toutes_etapes(self):
        """Passe les étapes 1→4 via JS puis attend l'écran final (step5)."""
        # goTo(5) est la fonction JS du wizard qui affiche directement la step finale
        self.wait_for(self.STEP1_CONTENT)
        self.js("goTo(5)")
        self.wait_for(self.STEP5_CONTENT)

    def click_acceder_dashboard(self):
        """Clic sur 'Accéder à mon espace' (lancerConnexion) — déclenche le PKCE login."""
        self.click(self.BTN_DASHBOARD)

    def fill_step1(self, telephone: str = "+212600000001"):
        """Remplit les infos minimales de l'étape 1 (les autres champs sont optionnels)."""
        self.wait_for(self.STEP1_CONTENT)
        try:
            self.fill("#telephone", telephone)
        except Exception:
            pass
        self.click("#step1 .btn-next")
