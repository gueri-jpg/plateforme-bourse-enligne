"""Tests des endpoints /api/admin/parametres/securite."""
from datetime import datetime
from unittest.mock import MagicMock, patch

from tests.conftest import make_cursor, make_conn, patch_get_connection

_MODULE = "app.routers.parametres_securite"


class TestGetParametresSecurite:
    def test_admin_peut_lire(self, admin_client):
        ligne = {
            "max_tentatives_echouees": 5,
            "duree_expiration_session_minutes": 30,
            "date_maj": datetime(2025, 6, 1, 12, 0),
            "modifie_par": None,
        }
        cur = make_cursor(fetchone_seq=[ligne])
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = admin_client.get("/api/admin/parametres/securite")

        assert r.status_code == 200
        data = r.json()
        assert data["max_tentatives_echouees"] == 5
        assert data["duree_expiration_session_minutes"] == 30

    def test_non_admin_rejete_403(self, anonymous_client):
        r = anonymous_client.get("/api/admin/parametres/securite")
        assert r.status_code in (401, 403)

    def test_aucune_config_retourne_404(self, admin_client):
        cur = make_cursor(fetchone_seq=[None])
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = admin_client.get("/api/admin/parametres/securite")

        assert r.status_code == 404

    def test_reponse_contient_date_maj(self, admin_client):
        ligne = {
            "max_tentatives_echouees": 3,
            "duree_expiration_session_minutes": 15,
            "date_maj": datetime(2025, 1, 15, 8, 30),
            "modifie_par": None,
        }
        cur = make_cursor(fetchone_seq=[ligne])
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = admin_client.get("/api/admin/parametres/securite")

        assert "date_maj" in r.json()


class TestPutParametresSecurite:
    def _make_conn_for_put(self, max_tent=5, duree=30):
        """Simule la séquence DB de mettre_a_jour_parametres_securite."""
        date_maj = datetime(2025, 6, 1)
        # fetchone calls: 1) SELECT id utilisateur, 2) UPDATE RETURNING
        cur = make_cursor(fetchone_seq=[
            None,                            # utilisateur non trouvé → modifie_par=None
            (max_tent, duree, date_maj, None),  # UPDATE RETURNING
        ])
        return make_conn(cur)

    def test_mise_a_jour_valide(self, admin_client):
        conn = self._make_conn_for_put(5, 30)
        with patch_get_connection(f"{_MODULE}.get_connection", conn), \
             patch(f"{_MODULE}.keycloak_admin_client") as mock_kc:
            mock_kc.synchroniser_parametres_securite.return_value = None
            r = admin_client.put(
                "/api/admin/parametres/securite",
                json={"max_tentatives_echouees": 5, "duree_expiration_session_minutes": 30},
            )

        assert r.status_code == 200
        assert r.json()["max_tentatives_echouees"] == 5

    def test_max_tentatives_hors_bornes_422(self, admin_client):
        # Pydantic doit rejeter avant d'atteindre la DB (ge=3, le=10)
        r = admin_client.put(
            "/api/admin/parametres/securite",
            json={"max_tentatives_echouees": 1, "duree_expiration_session_minutes": 30},
        )
        assert r.status_code == 422

    def test_duree_session_hors_bornes_422(self, admin_client):
        r = admin_client.put(
            "/api/admin/parametres/securite",
            json={"max_tentatives_echouees": 5, "duree_expiration_session_minutes": 200},
        )
        assert r.status_code == 422

    def test_echec_keycloak_rollback(self, admin_client):
        from fastapi import HTTPException as FastAPIHTTPException
        conn = self._make_conn_for_put()
        with patch_get_connection(f"{_MODULE}.get_connection", conn), \
             patch(f"{_MODULE}.keycloak_admin_client") as mock_kc:
            mock_kc.synchroniser_parametres_securite.side_effect = \
                FastAPIHTTPException(500, "Keycloak indisponible")
            r = admin_client.put(
                "/api/admin/parametres/securite",
                json={"max_tentatives_echouees": 5, "duree_expiration_session_minutes": 30},
            )

        assert r.status_code == 500
        conn.rollback.assert_called_once()

    def test_non_admin_rejete_403(self, anonymous_client):
        r = anonymous_client.put(
            "/api/admin/parametres/securite",
            json={"max_tentatives_echouees": 5, "duree_expiration_session_minutes": 30},
        )
        assert r.status_code in (401, 403)
