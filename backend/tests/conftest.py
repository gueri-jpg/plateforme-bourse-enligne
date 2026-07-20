"""Fixtures communes pour les tests unitaires du backend bourse.

Stratégie :
  - Les dépendances FastAPI d'auth sont surchargées via app.dependency_overrides
    → aucun token JWT réel ni Keycloak nécessaire.
  - Les appels psycopg2 (get_connection) sont patchés par test via
    unittest.mock.patch sur l'import local du module router concerné.
  - Les threads Kafka et market-data sont patchés AVANT l'import de l'app
    pour éviter des connexions réseau lors du lifespan FastAPI.
"""
import unittest.mock as _mock

# Importer les modules avant de les patcher (patch.object évite les problèmes
# de résolution de chemin lorsque le module n'est pas encore dans sys.modules)
import app.ws_market as _ws_market_module          # noqa: E402
import app.routers.market_data as _market_data_module  # noqa: E402

_kafka_patch = _mock.patch.object(_ws_market_module, "start_kafka_thread")
_market_patch = _mock.patch.object(_market_data_module, "start_polling")
_kafka_patch.start()
_market_patch.start()

import pytest                          # noqa: E402
from contextlib import contextmanager  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.auth import (    # noqa: E402
    UtilisateurAuthentifie,
    administrateur_requis,
    investisseur_requis,
    utilisateur_courant,
)


# ── Utilisateurs fictifs ──────────────────────────────────────────────────────

def _make_user(roles, email="test@bourse.ma", sub="kc-test-uuid"):
    return UtilisateurAuthentifie({
        "sub": sub,
        "preferred_username": email.split("@")[0],
        "email": email,
        "realm_access": {"roles": roles},
        "given_name": "Test",
        "family_name": "User",
    })


@pytest.fixture
def admin_user():
    return _make_user(["administrateur"], email="admin@bourse.ma", sub="kc-admin-1")


@pytest.fixture
def investisseur_user():
    return _make_user(["investisseur"], email="invest@bourse.ma", sub="kc-invest-1")


# ── Clients HTTP TestClient avec auth surchargée ──────────────────────────────

@pytest.fixture
def admin_client(admin_user):
    app.dependency_overrides[utilisateur_courant] = lambda: admin_user
    app.dependency_overrides[administrateur_requis] = lambda: admin_user
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def investisseur_client(investisseur_user):
    app.dependency_overrides[utilisateur_courant] = lambda: investisseur_user
    app.dependency_overrides[investisseur_requis] = lambda: investisseur_user
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def anonymous_client():
    with TestClient(app) as c:
        yield c


# ── Helpers mock psycopg2 ─────────────────────────────────────────────────────

def make_cursor(fetchone_seq=None, fetchall_result=None):
    """Cursor mock supportant __enter__/__exit__ (context manager psycopg2)."""
    cur = _mock.MagicMock()
    cur.__enter__ = lambda s: s
    cur.__exit__ = _mock.MagicMock(return_value=False)
    if fetchone_seq is not None:
        cur.fetchone.side_effect = list(fetchone_seq)
    if fetchall_result is not None:
        cur.fetchall.return_value = list(fetchall_result)
    return cur


def make_conn(cursor=None):
    """Connection mock avec curseur configurable."""
    if cursor is None:
        cursor = make_cursor()
    conn = _mock.MagicMock()
    conn.cursor.return_value = cursor
    conn.commit = _mock.MagicMock()
    conn.rollback = _mock.MagicMock()
    return conn


def patch_get_connection(module_path, conn):
    """Retourne un patch contextlib pour get_connection sur le module cible."""
    mock_conn = conn

    @contextmanager
    def _fake_get_connection():
        yield mock_conn

    return _mock.patch(module_path, _fake_get_connection)
