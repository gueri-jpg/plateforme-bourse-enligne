from .base_page import BasePage


class HomePage(BasePage):
    LOGIN_BTN     = "#btnHeroLogin"
    REGISTER_BTN  = "#btnHeroRegister"
    DASHBOARD_BTN = "#btnDashboard"
    MODAL_OVERLAY = "#modal-overlay"
    MODAL_LOGIN   = "#bouton-login"

    def go(self):
        super().go("/")

    def click_login(self):
        # Le bouton ouvre d'abord une modal, puis #bouton-login lance le PKCE
        self.click(self.LOGIN_BTN)
        self.wait_visible(self.MODAL_OVERLAY)
        self.click(self.MODAL_LOGIN)

    def click_register(self):
        self.click(self.REGISTER_BTN)

    def is_login_btn_visible(self) -> bool:
        return self.is_element_visible(self.LOGIN_BTN)

    def is_register_btn_visible(self) -> bool:
        return self.is_element_visible(self.REGISTER_BTN)

    def is_dashboard_btn_visible(self) -> bool:
        return self.is_element_visible(self.DASHBOARD_BTN)
