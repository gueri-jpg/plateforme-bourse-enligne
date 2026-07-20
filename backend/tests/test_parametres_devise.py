"""Tests des endpoints /api/admin/parametres/devise."""
from datetime import datetime
from unittest.mock import patch

from tests.conftest import make_cursor, make_conn, patch_get_connection

_MODULE = "app.routers.parametres_devise"


class TestGetParametresDevise:
    def test_admin_lit_devise(self, admin_client):
        ligne = {
            "devise_par_defaut": "MAD",
            "date_maj": datetime(2025, 4, 1),
            "modifie_par": None,
        }
        cur = make_cursor(fetchone_seq=[ligne])
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = admin_client.get("/api/admin/parametres/devise")

        assert r.status_code == 200
        assert r.json()["devise_par_defaut"] == "MAD"

    def test_aucune_config_404(self, admin_client):
        cur = make_cursor(fetchone_seq=[None])
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = admin_client.get("/api/admin/parametres/devise")

        assert r.status_code == 404

    def test_non_admin_403(self, anonymous_client):
        r = anonymous_client.get("/api/admin/parametres/devise")
        assert r.status_code in (401, 403)


class TestPutParametresDevise:
    def _make_conn(self, devise="EUR"):
        date_maj = datetime(2025, 6, 1)
        cur = make_cursor(fetchone_seq=[
            None,                  # SELECT id utilisateur
            (devise, date_maj, None),  # UPDATE RETURNING
        ])
        return make_conn(cur)

    def test_devise_valide_mad(self, admin_client):
        conn = self._make_conn("MAD")
        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = admin_client.put(
                "/api/admin/parametres/devise",
                json={"devise_par_defaut": "MAD"},
            )
        assert r.status_code == 200
        assert r.json()["devise_par_defaut"] == "MAD"

    def test_devise_minuscule_normalisee(self, admin_client):
        conn = self._make_conn("USD")
        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = admin_client.put(
                "/api/admin/parametres/devise",
                json={"devise_par_defaut": "usd"},
            )
        assert r.status_code == 200

    def test_devise_invalide_422(self, admin_client):
        r = admin_client.put(
            "/api/admin/parametres/devise",
            json={"devise_par_defaut": "EU"},
        )
        assert r.status_code == 422

    def test_devise_avec_chiffre_422(self, admin_client):
        r = admin_client.put(
            "/api/admin/parametres/devise",
            json={"devise_par_defaut": "1AD"},
        )
        assert r.status_code == 422

    def test_non_admin_403(self, anonymous_client):
        r = anonymous_client.put(
            "/api/admin/parametres/devise",
            json={"devise_par_defaut": "EUR"},
        )
        assert r.status_code in (401, 403)
