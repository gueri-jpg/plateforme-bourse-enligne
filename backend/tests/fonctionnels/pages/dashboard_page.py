import time
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC

from .base_page import BasePage


class DashboardPage(BasePage):
    USER_DISPLAYNAME = "#user-displayname"
    LOGOUT_BTN       = "#btn-logout"
    NAV_ORDRES       = "button[data-section='ordres']"
    NAV_PORTEFEUILLE = "button[data-section='portefeuille']"
    NAV_MARCHE       = "button[data-section='marche']"
    NAV_CARNET       = "button[data-section='carnet']"
    SECTION_ORDRES   = "#section-ordres"
    SECTION_CARNET   = "#section-carnet"

    # Formulaire passage d'ordre
    ORD_INSTRUMENT  = "#ord-instrument"
    ORD_ACHAT       = "#ord-achat"
    ORD_VENTE       = "#ord-vente"
    ORD_MARCHE      = "#ord-marche"
    ORD_LIMITE      = "#ord-limite"
    ORD_QTY         = "#ord-qty"
    ORD_LIMIT_PRICE = "#ord-limit-price"
    BTN_CONFIRM_ORD = "#btn-confirm-order"
    FORM_MSG        = "#form-msg"

    # Modal de confirmation
    MODAL_CONFIRM   = "#mc-btn-confirm"

    # Carnet d'ordres
    HIST_COUNT      = "#hist-count"
    HIST_ROWS       = "#hist-rows"
    CANCEL_BTN_SEL  = "#hist-rows .btn-sell"

    # Portefeuille
    CT_SOLDE        = "#ct-solde"

    def go(self):
        super().go("/dashboard.html")

    def is_loaded(self) -> bool:
        return self.is_element_visible(self.USER_DISPLAYNAME)

    def get_user_name(self) -> str:
        return self.get_text(self.USER_DISPLAYNAME)

    def click_logout(self):
        # seDeconnecter() est attaché via addEventListener — cliquer le bouton directement
        self.click(self.LOGOUT_BTN)

    def nav_ordres(self):
        self.click(self.NAV_ORDRES)
        self.wait_visible(self.SECTION_ORDRES)

    def nav_portefeuille(self):
        self.click(self.NAV_PORTEFEUILLE)

    def wait_market_data(self, timeout: int = 60) -> bool:
        """Attend que mkt.rows contienne au moins un instrument (WebSocket).
        Retourne True si des données arrivent, False sinon (marché fermé/API down)."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            count = self.js("return (window.mkt && window.mkt.rows) ? window.mkt.rows.length : 0;")
            if count and int(count) > 0:
                return True
            time.sleep(2)
        return False

    def wait_instrument_options(self, timeout: int = 60):
        """Attend que le select #ord-instrument soit peuplé (chargement asynchrone).
        Si toujours vide après timeout, re-appelle renderOrdreForm() via JS puis réessaie."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            sel = self.driver.find_element(By.CSS_SELECTOR, self.ORD_INSTRUMENT)
            opts = sel.find_elements(By.TAG_NAME, "option")
            if len(opts) > 1:  # au moins une option réelle en plus du placeholder
                return
            # Force re-populate au cas où renderOrdreForm a été appelé avant les données WS
            self.js("if (typeof renderOrdreForm === 'function') renderOrdreForm();")
            time.sleep(2)
        raise TimeoutError("Aucun instrument disponible dans le select #ord-instrument")

    def get_first_instrument(self) -> str:
        """Retourne la valeur du premier instrument disponible dans le select."""
        sel = Select(self.driver.find_element(By.CSS_SELECTOR, self.ORD_INSTRUMENT))
        for opt in sel.options:
            if opt.get_attribute("value"):
                return opt.get_attribute("value")
        raise ValueError("Aucun instrument disponible")

    def passer_ordre_achat(self, quantite: int = 1):
        """Place un ordre d'achat au marché pour le premier instrument disponible."""
        self.nav_ordres()
        self.wait_instrument_options()

        instrument = self.get_first_instrument()
        Select(self.driver.find_element(By.CSS_SELECTOR, self.ORD_INSTRUMENT)).select_by_value(instrument)

        # Radios sont display:none — cliquer les labels associés
        # achat + marche sont déjà cochés par défaut, mais on force via JS pour robustesse
        self.js("document.getElementById('ord-achat').checked = true;")
        self.js("document.getElementById('ord-marche').checked = true;")
        # Quantité
        qty_el = self.driver.find_element(By.CSS_SELECTOR, self.ORD_QTY)
        qty_el.clear()
        qty_el.send_keys(str(quantite))

        # Clic sur Confirmer → ouvre la modal de confirmation
        self.click(self.BTN_CONFIRM_ORD)

    def confirmer_ordre_modal(self):
        """Confirme l'ordre dans la modal (#mc-btn-confirm)."""
        self.wait_visible(self.MODAL_CONFIRM)
        self.click(self.MODAL_CONFIRM)

    def clear_form_msg(self):
        """Vide #form-msg avant de passer un nouvel ordre pour permettre wait_form_result."""
        self.js("document.getElementById('form-msg').textContent = '';")

    def wait_form_result(self, timeout: int = 15) -> str:
        """Attend que #form-msg soit non vide après passage d'ordre, retourne le texte."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            txt = self.js("return document.getElementById('form-msg').textContent || '';")
            if txt and txt.strip():
                return txt.strip()
            time.sleep(0.5)
        return ""

    def get_form_message(self) -> str:
        return self.js("return document.getElementById('form-msg').textContent || '';") or ""

    def nav_carnet(self):
        """Navigue vers la section carnet d'ordres (#section-carnet)."""
        self.click(self.NAV_CARNET)
        self.wait_visible(self.SECTION_CARNET)

    def get_ordre_count(self) -> int:
        """Retourne le nombre total d'ordres affiché dans #hist-count."""
        try:
            return int(self.get_text(self.HIST_COUNT))
        except (ValueError, Exception):
            return 0

    def get_solde_display(self) -> str:
        """Retourne le texte affiché dans #ct-solde (solde disponible)."""
        return self.js(
            "var el = document.getElementById('ct-solde');"
            "return el ? el.textContent : '';"
        ) or ""

    def passer_ordre_limite(
        self,
        instrument: str,
        quantite: int,
        prix_limite: float,
        sens: str = "achat",
    ):
        """Place un ordre limité pour l'instrument donné."""
        self.nav_ordres()
        self.wait_instrument_options()
        Select(self.driver.find_element(By.CSS_SELECTOR, self.ORD_INSTRUMENT)).select_by_value(instrument)
        side_id = "ord-achat" if sens == "achat" else "ord-vente"
        self.js(f"document.getElementById('{side_id}').checked = true;")
        # Activer le radio "limite" et afficher le champ prix
        self.js(
            "var r = document.getElementById('ord-limite');"
            "r.checked = true;"
            "r.dispatchEvent(new Event('change'));"
            "document.getElementById('limit-price-row').style.display = '';"
        )
        price_el = WebDriverWait(self.driver, 10).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, self.ORD_LIMIT_PRICE))
        )
        price_el.clear()
        price_el.send_keys(str(prix_limite))
        qty_el = self.driver.find_element(By.CSS_SELECTOR, self.ORD_QTY)
        qty_el.clear()
        qty_el.send_keys(str(quantite))
        self.click(self.BTN_CONFIRM_ORD)

    def wait_carnet_orders(self, timeout: int = 10) -> bool:
        """Attend que #hist-rows contienne au moins un ordre réel (pas 'Aucun')."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            txt = self.js("return document.getElementById('hist-rows').textContent || '';")
            if txt and "Aucun" not in txt:
                return True
            time.sleep(1)
        return False

    def click_annuler_first(self):
        """Clique sur le premier bouton Annuler visible dans le carnet."""
        el = WebDriverWait(self.driver, self.TIMEOUT).until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, self.CANCEL_BTN_SEL))
        )
        el.click()
