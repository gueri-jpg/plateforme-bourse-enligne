"""Tests portefeuille — logique métier (creer, lire, ouvrir, depot).

Complète test_portefeuille.py qui couvre les 401 et l'inter-service.
Ce fichier couvre les flux authentifiés et le dépôt depuis banque.
"""
import unittest.mock as _mock
from datetime import date

import pytest
import requests as _req_lib

from tests.conftest import make_conn, make_cursor, patch_get_connection

_MODULE_PORT = "app.routers.portefeuille"

# ── Données de test ───────────────────────────────────────────────────────────

_IBAN_28 = "MA" + "12" + "0" * 24  # 28 chars, satisfait la condition len==28

_USER_ROW = {"id": "uid-abc123"}

_COMPTE_ROW = {
    "id": "cpt-xyz789",
    "solde_especes": 500,
    "devise": "MAD",
    "iban": _IBAN_28,
    "numero": "CT-CPT12345",
    "type": "mixte",
    "statut": "actif",
    "date_ouverture": date(2024, 6, 1),
}


def _make_conn_portefeuille(fetchone_seq, fetchall_seq=None):
    """Construit conn/cursor mocks pour les endpoints portefeuille."""
    cur = make_cursor(fetchone_seq=fetchone_seq)
    if fetchall_seq:
        cur.fetchall.side_effect = fetchall_seq
    else:
        cur.fetchall.return_value = []
    return make_conn(cur)


# ── POST /api/portefeuille/creer ──────────────────────────────────────────────

class TestCreerPortefeuille:

    def test_user_et_compte_existants_201(self, investisseur_client):
        conn = _make_conn_portefeuille(
            fetchone_seq=[_USER_ROW, _COMPTE_ROW]
        )
        with patch_get_connection(_MODULE_PORT + ".get_connection", conn):
            r = investisseur_client.post("/api/portefeuille/creer")
        assert r.status_code == 201
        data = r.json()
        assert data["message"] == "Portefeuille prêt."
        assert "compte_id" in data

    def test_nouveau_user_et_compte_201(self, investisseur_client):
        """user introuvable → INSERT user → INSERT compte → retourne 201."""
        conn = _make_conn_portefeuille(
            fetchone_seq=[
                None,           # utilisateur introuvable → INSERT
                _COMPTE_ROW,    # compte retourné après INSERT (SELECT final)
            ]
        )
        with patch_get_connection(_MODULE_PORT + ".get_connection", conn):
            r = investisseur_client.post("/api/portefeuille/creer")
        assert r.status_code == 201
        assert conn.commit.called

    def test_sans_auth_401(self, anonymous_client):
        r = anonymous_client.post("/api/portefeuille/creer")
        assert r.status_code == 401


# ── GET /api/portefeuille ─────────────────────────────────────────────────────

class TestLirePortefeuille:

    def test_retourne_compte_formate(self, investisseur_client):
        pos = [
            {
                "quantite": 10,
                "prix_revient_moyen": 100,
                "instrument_code": "IAM",
                "instrument_nom": "Maroc Telecom",
                "cours_actuel": 120,
            }
        ]
        mouv = [
            {
                "type_mouvement": "achat",
                "montant": 1000,
                "horodatage": None,
                "instrument_code": "IAM",
            }
        ]
        conn = _make_conn_portefeuille(
            fetchone_seq=[_USER_ROW, _COMPTE_ROW],
            fetchall_seq=[pos, mouv],
        )
        with patch_get_connection(_MODULE_PORT + ".get_connection", conn):
            r = investisseur_client.get("/api/portefeuille")
        assert r.status_code == 200
        d = r.json()
        assert d["solde_especes"] == 500.0
        assert d["devise"] == "MAD"
        assert len(d["positions"]) == 1
        assert d["positions"][0]["instrument_code"] == "IAM"
        assert d["valeur_marche"] == 1200.0  # 10 * 120
        assert d["valorisation_totale"] == 1700.0  # 500 + 1200

    def test_compte_vide_retourne_zeros(self, investisseur_client):
        conn = _make_conn_portefeuille(
            fetchone_seq=[_USER_ROW, _COMPTE_ROW],
            fetchall_seq=[[], []],
        )
        with patch_get_connection(_MODULE_PORT + ".get_connection", conn):
            r = investisseur_client.get("/api/portefeuille")
        assert r.status_code == 200
        d = r.json()
        assert d["positions"] == []
        assert d["valeur_marche"] == 0.0

    def test_sans_auth_401(self, anonymous_client):
        r = anonymous_client.get("/api/portefeuille")
        assert r.status_code == 401


# ── GET /api/portefeuille/comptes-titres ──────────────────────────────────────

class TestLireCompteTitres:

    def test_alias_portefeuille(self, investisseur_client):
        conn = _make_conn_portefeuille(
            fetchone_seq=[_USER_ROW, _COMPTE_ROW],
            fetchall_seq=[[], []],
        )
        with patch_get_connection(_MODULE_PORT + ".get_connection", conn):
            r = investisseur_client.get("/api/portefeuille/comptes-titres")
        assert r.status_code == 200
        d = r.json()
        assert d["numero"] == _COMPTE_ROW["numero"]
        assert d["type"] == "mixte"
        assert d["statut"] == "actif"
        assert d["iban"] == _IBAN_28

    def test_sans_auth_401(self, anonymous_client):
        r = anonymous_client.get("/api/portefeuille/comptes-titres")
        assert r.status_code == 401


# ── POST /api/portefeuille/comptes-titres/ouvrir ──────────────────────────────

class TestOuvrirCompteTitres:

    def test_type_invalide_422(self, investisseur_client):
        r = investisseur_client.post(
            "/api/portefeuille/comptes-titres/ouvrir",
            json={"type": "crypto"},
        )
        assert r.status_code == 422

    def test_ouvrir_mixte_201(self, investisseur_client):
        conn = _make_conn_portefeuille(
            fetchone_seq=[_USER_ROW]
        )
        with patch_get_connection(_MODULE_PORT + ".get_connection", conn):
            r = investisseur_client.post(
                "/api/portefeuille/comptes-titres/ouvrir",
                json={"type": "mixte"},
            )
        assert r.status_code == 201
        d = r.json()
        assert "numero" in d
        assert d["type"] == "mixte"
        assert d["statut"] == "actif"
        assert len(d["iban"]) == 28

    def test_ouvrir_actions_201(self, investisseur_client):
        conn = _make_conn_portefeuille(
            fetchone_seq=[_USER_ROW]
        )
        with patch_get_connection(_MODULE_PORT + ".get_connection", conn):
            r = investisseur_client.post(
                "/api/portefeuille/comptes-titres/ouvrir",
                json={"type": "actions"},
            )
        assert r.status_code == 201
        assert r.json()["type"] == "actions"
        assert conn.commit.called

    def test_sans_auth_401(self, anonymous_client):
        r = anonymous_client.post(
            "/api/portefeuille/comptes-titres/ouvrir",
            json={"type": "mixte"},
        )
        assert r.status_code == 401


# ── POST /api/portefeuille/depot ──────────────────────────────────────────────

class TestDepotDepuisBanque:
    _IBAN_REQ = {"iban_bourse": _IBAN_28}

    def test_banque_inaccessible_502(self, investisseur_client):
        with _mock.patch(
            _MODULE_PORT + "._requests.get",
            side_effect=_req_lib.exceptions.ConnectionError("timeout"),
        ):
            r = investisseur_client.post("/api/portefeuille/depot", json=self._IBAN_REQ)
        assert r.status_code == 502
        assert "Banque CFC inaccessible" in r.json()["detail"]

    def test_paiement_invalide_400(self, investisseur_client):
        mock_r = _mock.MagicMock(ok=True)
        mock_r.raise_for_status = _mock.MagicMock()
        mock_r.json.return_value = {"valide": False, "raison": "Paiement introuvable"}
        with _mock.patch(_MODULE_PORT + "._requests.get", return_value=mock_r):
            r = investisseur_client.post("/api/portefeuille/depot", json=self._IBAN_REQ)
        assert r.status_code == 400
        assert "Paiement introuvable" in r.json()["detail"]

    def test_doublon_409(self, investisseur_client):
        mock_r = _mock.MagicMock(ok=True)
        mock_r.raise_for_status = _mock.MagicMock()
        mock_r.json.return_value = {
            "valide": True, "montant": 500, "payment_id": "pid-001",
        }
        conn = _make_conn_portefeuille(
            fetchone_seq=[
                _USER_ROW,
                _COMPTE_ROW,
                {"placeholder": 1},  # doublon trouvé → 409
            ]
        )
        with _mock.patch(_MODULE_PORT + "._requests.get", return_value=mock_r), \
             patch_get_connection(_MODULE_PORT + ".get_connection", conn):
            r = investisseur_client.post("/api/portefeuille/depot", json=self._IBAN_REQ)
        assert r.status_code == 409
        assert "déjà" in r.json()["detail"]

    def test_depot_success_200(self, investisseur_client):
        mock_r = _mock.MagicMock(ok=True)
        mock_r.raise_for_status = _mock.MagicMock()
        mock_r.json.return_value = {
            "valide": True, "montant": 1500, "devise": "MAD", "payment_id": "pid-002",
        }
        conn = _make_conn_portefeuille(
            fetchone_seq=[
                _USER_ROW,
                _COMPTE_ROW,
                None,                        # pas de doublon
                {"solde_especes": 2000},     # RETURNING après UPDATE
            ]
        )
        with _mock.patch(_MODULE_PORT + "._requests.get", return_value=mock_r), \
             patch_get_connection(_MODULE_PORT + ".get_connection", conn):
            r = investisseur_client.post("/api/portefeuille/depot", json=self._IBAN_REQ)
        assert r.status_code == 200
        d = r.json()
        assert d["succes"] is True
        assert d["montant_credite"] == 1500.0
        assert d["nouveau_solde"] == 2000.0
        assert conn.commit.called

    def test_sans_auth_401(self, anonymous_client):
        r = anonymous_client.post("/api/portefeuille/depot", json=self._IBAN_REQ)
        assert r.status_code == 401


# ── GET /api/portefeuille/comptes-titres/inter-service ────────────────────────

class TestCompteTitresInterService:
    """Complète les tests inter-service existants avec les cas IBAN auto-fix."""

    _INTER_TOKEN = "bourse-banque-inter-service-token-poc"

    def test_iban_manquant_autofix(self, anonymous_client):
        """Compte avec IBAN NULL → auto-généré et mis à jour en DB."""
        compte_sans_iban = dict(_COMPTE_ROW)
        # Doit être un UUID valide car _generate_iban() l'interprète en base 16
        compte_sans_iban["id"] = "12345678-abcd-ef01-2345-6789abcdef01"
        compte_sans_iban["iban"] = None  # déclenche l'auto-fix

        cur = make_cursor(fetchone_seq=[_USER_ROW, compte_sans_iban])
        cur.fetchall.side_effect = [[], []]
        conn = make_conn(cur)

        with patch_get_connection(_MODULE_PORT + ".get_connection", conn):
            r = anonymous_client.get(
                "/api/portefeuille/comptes-titres/inter-service",
                params={"email": "user@test.ma"},
                headers={"X-Inter-Service-Token": self._INTER_TOKEN},
            )
        assert r.status_code == 200
        assert len(r.json()["iban"]) == 28  # IBAN généré et retourné

    def test_positions_valorisees(self, anonymous_client):
        """Positions non vides → valeur_marche calculée."""
        cur = make_cursor(fetchone_seq=[_USER_ROW, _COMPTE_ROW])
        cur.fetchall.side_effect = [
            [{"quantite": 5, "prix_revient_moyen": 200, "instrument_code": "ATW",
              "instrument_nom": "Attijariwafa", "cours_actuel": 250}],
            [],  # mouvements non utilisés par inter-service
        ]
        conn = make_conn(cur)

        with patch_get_connection(_MODULE_PORT + ".get_connection", conn):
            r = anonymous_client.get(
                "/api/portefeuille/comptes-titres/inter-service",
                params={"email": "user@test.ma"},
                headers={"X-Inter-Service-Token": self._INTER_TOKEN},
            )
        assert r.status_code == 200
        d = r.json()
        assert d["valeur_marche"] == 1250.0  # 5 * 250
        assert d["nb_lignes"] == 1
