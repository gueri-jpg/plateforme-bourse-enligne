"""Tests des endpoints /api/admin/parametres/otp."""
from datetime import datetime
from unittest.mock import patch

from tests.conftest import make_cursor, make_conn, patch_get_connection

_MODULE = "app.routers.parametres_otp"


class TestGetParametresOtp:
    def test_admin_lit_config(self, admin_client):
        ligne = {
            "otp_actif_global": True,
            "otp_frequence_type": "chaque_connexion",
            "otp_frequence_valeur": None,
            "date_maj": datetime(2025, 5, 1),
            "modifie_par": None,
        }
        cur = make_cursor(fetchone_seq=[ligne])
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = admin_client.get("/api/admin/parametres/otp")

        assert r.status_code == 200
        assert r.json()["otp_actif_global"] is True
        assert r.json()["otp_frequence_type"] == "chaque_connexion"

    def test_aucune_config_404(self, admin_client):
        cur = make_cursor(fetchone_seq=[None])
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = admin_client.get("/api/admin/parametres/otp")

        assert r.status_code == 404

    def test_non_admin_403(self, anonymous_client):
        r = anonymous_client.get("/api/admin/parametres/otp")
        assert r.status_code in (401, 403)


class TestPutParametresOtp:
    def _make_conn(self, actif=True, freq_type="chaque_connexion", freq_val=None):
        date_maj = datetime(2025, 6, 1)
        cur = make_cursor(fetchone_seq=[
            None,   # SELECT id utilisateur → non trouvé
            (actif, freq_type, freq_val, date_maj, None),  # UPDATE RETURNING
        ])
        cur.fetchall.return_value = []  # liste investisseurs vide
        return make_conn(cur)

    def test_chaque_connexion_valide(self, admin_client):
        conn = self._make_conn(actif=True, freq_type="chaque_connexion", freq_val=None)
        with patch_get_connection(f"{_MODULE}.get_connection", conn), \
             patch(f"{_MODULE}.keycloak_admin_client"):
            r = admin_client.put(
                "/api/admin/parametres/otp",
                json={
                    "otp_actif_global": True,
                    "otp_frequence_type": "chaque_connexion",
                    "otp_frequence_valeur": None,
                },
            )
        assert r.status_code == 200

    def test_apres_n_jours_sans_valeur_422(self, admin_client):
        r = admin_client.put(
            "/api/admin/parametres/otp",
            json={
                "otp_actif_global": True,
                "otp_frequence_type": "apres_n_jours",
                "otp_frequence_valeur": None,
            },
        )
        assert r.status_code == 422

    def test_frequence_type_invalide_422(self, admin_client):
        r = admin_client.put(
            "/api/admin/parametres/otp",
            json={
                "otp_actif_global": True,
                "otp_frequence_type": "jamais",
                "otp_frequence_valeur": None,
            },
        )
        assert r.status_code == 422

    def test_apres_n_connexions_valide(self, admin_client):
        conn = self._make_conn(actif=False, freq_type="apres_n_connexions", freq_val=3)
        with patch_get_connection(f"{_MODULE}.get_connection", conn), \
             patch(f"{_MODULE}.keycloak_admin_client"):
            r = admin_client.put(
                "/api/admin/parametres/otp",
                json={
                    "otp_actif_global": False,
                    "otp_frequence_type": "apres_n_connexions",
                    "otp_frequence_valeur": 3,
                },
            )
        assert r.status_code == 200
        assert r.json()["otp_frequence_valeur"] == 3
