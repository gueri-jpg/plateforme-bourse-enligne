"""Tests des endpoints /api/ordres."""
from datetime import datetime
from unittest.mock import patch

from tests.conftest import make_cursor, make_conn, patch_get_connection

_MODULE = "app.routers.ordres_bourse"


class TestOrdresAuthRequis:
    def test_lister_sans_auth_401(self, anonymous_client):
        r = anonymous_client.get("/api/ordres")
        assert r.status_code in (401, 403)

    def test_passer_sans_auth_401(self, anonymous_client):
        r = anonymous_client.post(
            "/api/ordres",
            json={
                "instrument_code": "IAM",
                "sens": "achat",
                "type_ordre": "marche",
                "quantite": 1,
                "prix_marche": 50.0,
            },
        )
        assert r.status_code in (401, 403)

    def test_annuler_sans_auth_401(self, anonymous_client):
        r = anonymous_client.put("/api/ordres/ordre-uuid-1/annuler")
        assert r.status_code in (401, 403)


class TestListerOrdres:
    def test_liste_vide(self, investisseur_client):
        cur = make_cursor(fetchall_result=[])
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = investisseur_client.get("/api/ordres")

        assert r.status_code == 200
        assert r.json() == []

    def test_liste_avec_ordres(self, investisseur_client):
        ordres = [
            {
                "id": "ordre-1",
                "sens": "achat",
                "type_ordre": "marche",
                "quantite": 10,
                "prix_limite": None,
                "statut": "execute",
                "date_creation": datetime(2025, 6, 1),
                "instrument_code": "IAM",
                "instrument_nom": "Maroc Telecom",
                "prix_execution": 110.5,
                "quantite_executee": 10,
                "montant_total": 1105.0,
            }
        ]
        cur = make_cursor(fetchall_result=ordres)
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = investisseur_client.get("/api/ordres")

        assert r.status_code == 200
        data = r.json()
        assert len(data) == 1
        assert data[0]["instrument"] == "IAM"
        assert data[0]["statut"] == "execute"


class TestPasserOrdre:
    def test_ordre_invalide_422(self, investisseur_client):
        # type_ordre=limite sans prix_limite → 422
        r = investisseur_client.post(
            "/api/ordres",
            json={
                "instrument_code": "IAM",
                "sens": "achat",
                "type_ordre": "limite",
                "quantite": 5,
                "prix_limite": None,
            },
        )
        assert r.status_code == 422

    def test_portefeuille_introuvable_400(self, investisseur_client):
        # compte_id non trouvé → HTTPException 400
        cur = make_cursor(fetchone_seq=[None])  # _get_compte_id → None
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = investisseur_client.post(
                "/api/ordres",
                json={
                    "instrument_code": "IAM",
                    "sens": "achat",
                    "type_ordre": "marche",
                    "quantite": 1,
                    "prix_marche": 110.0,
                },
            )
        assert r.status_code == 400

    def test_solde_insuffisant_400(self, investisseur_client):
        compte_uuid = "compte-uuid-1"
        instrument_uuid = "instr-uuid-1"
        # Séquence DB : compte_id, instrument_id, solde (< montant requis)
        cur = make_cursor(fetchone_seq=[
            {"id": compte_uuid},          # _get_compte_id
            {"id": instrument_uuid},       # _get_or_create_instrument
            {"solde_especes": 10.0},       # SELECT solde FOR UPDATE
        ])
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = investisseur_client.post(
                "/api/ordres",
                json={
                    "instrument_code": "IAM",
                    "sens": "achat",
                    "type_ordre": "marche",
                    "quantite": 100,
                    "prix_marche": 110.0,  # montant = 11000 MAD, solde = 10 MAD
                },
            )
        assert r.status_code == 400
        assert "Solde insuffisant" in r.json()["detail"]


class TestAnnulerOrdre:
    def test_ordre_introuvable_404(self, investisseur_client):
        cur = make_cursor(fetchone_seq=[None])
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = investisseur_client.put("/api/ordres/uuid-inexistant/annuler")

        assert r.status_code == 404

    def test_ordre_deja_execute_400(self, investisseur_client):
        # fetchone → ordre avec statut "execute"
        cur = make_cursor(fetchone_seq=[{"id": "ordre-1", "statut": "execute"}])
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = investisseur_client.put("/api/ordres/ordre-1/annuler")

        assert r.status_code == 400

    def test_annulation_en_attente_succes(self, investisseur_client):
        cur = make_cursor(fetchone_seq=[{"id": "ordre-1", "statut": "en_attente"}])
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = investisseur_client.put("/api/ordres/ordre-1/annuler")

        assert r.status_code == 200
        assert r.json()["succes"] is True
        conn.commit.assert_called_once()
