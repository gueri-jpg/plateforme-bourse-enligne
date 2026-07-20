from .base_page import BasePage


class KeycloakPage(BasePage):
    """Page Keycloak partagée : login et registration (formulaires standard KC)."""

    # Champs communs login / registration
    USERNAME   = "#username"
    EMAIL      = "#email"
    FIRST_NAME = "#firstName"
    LAST_NAME  = "#lastName"
    PASSWORD   = "#password"
    PWD_CONFIRM = "#password-confirm"

    # Boutons de soumission (KC génère des noms différents selon le flow)
    SUBMIT_BTN    = "input[type='submit'], button[type='submit']"
    LOGIN_SUBMIT  = "#kc-login"

    def login(self, email: str, password: str):
        """Remplit et soumet le formulaire de login KC."""
        self.fill(self.USERNAME, email)
        self.fill(self.PASSWORD, password)
        self.click(self.SUBMIT_BTN)

    def register(self, first_name: str, last_name: str, email: str, password: str):
        """Remplit et soumet le formulaire d'inscription KC (Registration form).

        Le champ #username est optionnel : certains realms utilisent l'email
        comme username sans afficher de champ séparé.
        """
        self.fill(self.FIRST_NAME, first_name)
        self.fill(self.LAST_NAME, last_name)
        self.fill(self.EMAIL, email)
        # username optionnel (KC email-as-username peut l'omettre)
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.common.by import By
        try:
            WebDriverWait(self.driver, 3).until(
                EC.visibility_of_element_located((By.CSS_SELECTOR, self.USERNAME))
            )
            self.fill(self.USERNAME, email)
        except Exception:
            pass
        self.fill(self.PASSWORD, password)
        self.fill(self.PWD_CONFIRM, password)
        self.click(self.SUBMIT_BTN)

    def is_on_keycloak(self) -> bool:
        return "realms" in self.driver.current_url or "auth" in self.driver.current_url
