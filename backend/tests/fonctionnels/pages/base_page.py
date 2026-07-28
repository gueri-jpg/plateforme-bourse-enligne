import json

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


class BasePage:
    TIMEOUT = 60

    def __init__(self, driver, base_url: str):
        self.driver = driver
        self.base_url = base_url

    def go(self, path: str = ""):
        self.driver.get(f"{self.base_url}{path}")

    def wait_for(self, css_selector: str):
        return WebDriverWait(self.driver, self.TIMEOUT).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, css_selector))
        )

    def wait_visible(self, css_selector: str):
        return WebDriverWait(self.driver, self.TIMEOUT).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, css_selector))
        )

    def click(self, css_selector: str):
        el = WebDriverWait(self.driver, self.TIMEOUT).until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, css_selector))
        )
        el.click()

    def fill(self, css_selector: str, text: str):
        el = self.wait_visible(css_selector)
        el.clear()
        el.send_keys(text)

    def get_text(self, css_selector: str) -> str:
        return self.wait_for(css_selector).text

    def is_element_visible(self, css_selector: str) -> bool:
        try:
            self.wait_visible(css_selector)
            return True
        except Exception:
            return False

    def wait_url_contains(self, fragment: str):
        WebDriverWait(self.driver, self.TIMEOUT).until(
            EC.url_contains(fragment)
        )

    def wait_url_not_contains(self, fragment: str):
        WebDriverWait(self.driver, self.TIMEOUT).until(
            lambda d: fragment not in d.current_url
        )

    def wait_url_host(self, base_url: str):
        from urllib.parse import urlparse
        expected = urlparse(base_url).netloc if "://" in base_url else base_url
        WebDriverWait(self.driver, self.TIMEOUT).until(
            lambda d: urlparse(d.current_url).netloc == expected
        )

    def select_option(self, css_selector: str, value: str):
        from selenium.webdriver.support.ui import Select
        el = self.wait_visible(css_selector)
        sel = Select(el)
        try:
            sel.select_by_value(value)
        except Exception:
            sel.select_by_visible_text(value)

    def js(self, script: str, *args):
        return self.driver.execute_script(script, *args)

    # Doit rester sur une page ou window._apiCall(...) est defini
    # (dashboard.html) : c'est le meme point d'entree HTTP que l'UI
    # (Authorization: Bearer, retry sur 401/403), reutilise ici pour
    # exercer des champs FIX (Stop/Iceberg/Pegged/GroupID/...) que le
    # formulaire ne propose pas.
    _API_CALL_SCRIPT = """
        var path = arguments[0];
        var options = arguments[1];
        var callback = arguments[arguments.length - 1];
        window._apiCall(path, options).then(function(result) {
            callback({ok: true, body: result});
        }).catch(function(err) {
            callback({ok: false, error: (err && err.message) ? err.message : String(err)});
        });
    """

    def api_call(self, path: str, method: str = "GET", body: dict | None = None) -> dict:
        """
        Appelle l'API backend via le _apiCall(path, options) global de
        dashboard.html, en passant par execute_async_script (execute_script
        n'attend pas les Promises JS, contrairement a execute_async_script).

        Retourne {"ok": True, "body": ...} si la requete HTTP a reussi
        (2xx) - y compris un rejet "metier" comme {"statut": "rejete", ...}
        qui reste une reponse HTTP 200 cote ordres_bourse.py - ou
        {"ok": False, "error": "..."} si _apiCall a leve une exception JS
        (HTTPException backend, ex: 400/404).
        """
        options: dict = {"method": method}
        if body is not None:
            options["body"] = json.dumps(body)
        return self.driver.execute_async_script(self._API_CALL_SCRIPT, path, options)
