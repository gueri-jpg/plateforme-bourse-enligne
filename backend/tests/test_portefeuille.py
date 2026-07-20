"""Tests des endpoints /api/portefeuille.

On se concentre sur l'endpoint inter-service (sans auth utilisateur) et
sur les vérifications d'accès des autres endpoints.
"""
from contextlib import contextmanager
from datetime import date
from unittest.mock import MagicMock, patch

from tests.conftest import make_cursor, make_conn, patch_get_connection

_MODULE = "app.routers.portefeuille"


def _make_conn_inter_service(user_row=None, compte_row=None, positions=None):
    """Prépare un mock conn pour l'endpoint inter-service."""
    cur = make_cursor(fetchone_seq=[user_row, compte_row])
    # positions via fetchall (appelé dans _lire_positions_mouvements)
    cur.fetchall.side_effect = [
        positions or [],  # positions
        [],               # mouvements
    ]
    conn = make_conn(cur)
    return conn


class TestComptesTitresInterService:
    _URL = "/api/portefeuille/comptes-titres/inter-service"
    _TOKEN = "bourse-banque-inter-service-token-poc"  # valeur par défaut settings

    def test_token_manquant_401(self, anonymous_client):
        r = anonymous_client.get(self._URL, params={"email": "test@bourse.ma"})
        assert r.status_code == 401

    def test_token_invalide_401(self, anonymous_client):
        r = anonymous_client.get(
            self._URL,
            params={"email": "test@bourse.ma"},
            headers={"x-inter-service-token": "mauvais-token"},
        )
        assert r.status_code == 401

    def test_utilisateur_introuvable_404(self, anonymous_client):
        conn = _make_conn_inter_service(user_row=None)
        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = anonymous_client.get(
                self._URL,
                params={"email": "inconnu@bourse.ma"},
                headers={"x-inter-service-token": self._TOKEN},
            )
        assert r.status_code == 404

    def test_aucun_compte_actif_404(self, anonymous_client):
        user_row = {"id": "user-uuid-1"}
        conn = _make_conn_inter_service(user_row=user_row, compte_row=None)
        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = anonymous_client.get(
                self._URL,
                params={"email": "invest@bourse.ma"},
                headers={"x-inter-service-token": self._TOKEN},
            )
        assert r.status_code == 404

    def test_compte_actif_retourne_200(self, anonymous_client):
        user_row = {"id": "user-uuid-1"}
        compte_row = {
            "id": "compte-uuid-1",
            "solde_especes": 5000.0,
            "devise": "MAD",
            "iban": "MA" + "0" * 26,
            "numero": "CT-ABCD1234",
            "type": "mixte",
            "statut": "actif",
            "date_ouverture": date(2025, 1, 1),
        }
        conn = _make_conn_inter_service(user_row=user_row, compte_row=compte_row)
        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = anonymous_client.get(
                self._URL,
                params={"email": "invest@bourse.ma"},
                headers={"x-inter-service-token": self._TOKEN},
            )
        assert r.status_code == 200
        data = r.json()
        assert data["solde_especes"] == 5000.0
        assert data["statut"] == "actif"
        assert "valorisation_totale" in data


class TestPortefeuilleAuthRequis:
    def test_get_portefeuille_sans_auth_401(self, anonymous_client):
        r = anonymous_client.get("/api/portefeuille")
        assert r.status_code in (401, 403)

    def test_creer_portefeuille_sans_auth_401(self, anonymous_client):
        r = anonymous_client.post("/api/portefeuille/creer")
        assert r.status_code in (401, 403)

    def test_lire_compte_titres_sans_auth_401(self, anonymous_client):
        r = anonymous_client.get("/api/portefeuille/comptes-titres")
        assert r.status_code in (401, 403)
