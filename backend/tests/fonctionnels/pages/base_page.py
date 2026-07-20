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
