"""Fixtures pour les tests fonctionnels E2E bourse (Selenium).

Les tests tournent contre l'URL de production déployée (BOURSE_BASE_URL).
Aucun import de code applicatif — tout passe par le navigateur (Selenium).
"""
import os
import time

import pytest
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager


# ── URL de production ─────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def base_url() -> str:
    return os.environ.get("BOURSE_BASE_URL", "https://bourse.cfconsultancy.org").rstrip("/")


# ── Utilisateur dynamique ─────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def new_user() -> dict:
    """Credentials uniques générés à chaque run — jamais hardcodés."""
    ts = int(time.time())
    return {
        "first_name": "TestBourse",
        "last_name": "AUTO",
        "email": f"test.bourse.{ts}@cfconsultancy.ma",
        "password": f"TestBourse#{ts}!",
    }


# ── Navigateur ────────────────────────────────────────────────────────────────

def _make_driver():
    options = Options()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1920,1080")
    service = Service(ChromeDriverManager().install())
    drv = webdriver.Chrome(service=service, options=options)
    drv.implicitly_wait(10)
    return drv


@pytest.fixture(scope="session")
def session_driver():
    """Browser persistant pour le flux complet — maintient les cookies de session."""
    drv = _make_driver()
    yield drv
    drv.quit()
