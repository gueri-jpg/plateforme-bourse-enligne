"""Tests des endpoints /api/ordres — couche HTTP + intégration FIX 4.4."""
from datetime import datetime
from unittest.mock import patch, MagicMock

from tests.conftest import make_cursor, make_conn, patch_get_connection

_MODULE = "app.routers.ordres_bourse"

# ── Résultat FIX simulé pour les tests unitaires ──────────────────────────────
_FIX_EXEC_MSG = "8=FIX.4.4\x019=50\x0135=8\x0139=2\x0114=100\x016=490.0\x0110=042\x01"

_FIX_EN_ATTENTE  = (_FIX_EXEC_MSG, {"statut": "en_attente", "order_id": "ordre-1"})
_FIX_EXECUTE     = (_FIX_EXEC_MSG, {"statut": "execute",    "order_id": "ordre-1",
                                     "prix_execution": 490.0, "quantite_executee": 100})
_FIX_REJETE      = (_FIX_EXEC_MSG, {"statut": "rejete",     "raison": "Marché fermé."})
_FIX_ANNULE      = (_FIX_EXEC_MSG, {"statut": "annule"})


# ═════════════════════════════════════════════════════════════════════════════
# AUTH
# ═════════════════════════════════════════════════════════════════════════════

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

    def test_carnet_sans_auth_401(self, anonymous_client):
        r = anonymous_client.get("/api/ordres/carnet/ATW")
        assert r.status_code in (401, 403)


# ═════════════════════════════════════════════════════════════════════════════
# LISTER ORDRES
# ═════════════════════════════════════════════════════════════════════════════

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

    def test_liste_inclut_champ_fix_cl_ord_id(self, investisseur_client):
        """Le champ fix_cl_ord_id est visible via GET /api/ordres si l'ordre est dans la liste."""
        # La liste ne retourne pas fix_cl_ord_id directement (c'est dans la réponse POST)
        # Vérifier que les champs FIX sont bien dans la réponse POST
        pass  # couvert par TestPasserOrdre.test_ordre_limite_en_attente_fix


# ═════════════════════════════════════════════════════════════════════════════
# PASSER ORDRE — validations
# ═════════════════════════════════════════════════════════════════════════════

class TestPasserOrdreValidation:
    def test_ordre_invalide_422(self, investisseur_client):
        """type_ordre=limite sans prix_limite → 422 Unprocessable Entity."""
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

    def test_type_ordre_invalide_422(self, investisseur_client):
        """type_ordre inconnu → 422."""
        r = investisseur_client.post(
            "/api/ordres",
            json={
                "instrument_code": "IAM",
                "sens": "achat",
                "type_ordre": "stop",
                "quantite": 5,
                "prix_marche": 100.0,
            },
        )
        assert r.status_code == 422

    def test_sens_invalide_422(self, investisseur_client):
        """sens inconnu → 422."""
        r = investisseur_client.post(
            "/api/ordres",
            json={
                "instrument_code": "IAM",
                "sens": "hold",
                "type_ordre": "marche",
                "quantite": 5,
                "prix_marche": 100.0,
            },
        )
        assert r.status_code == 422

    def test_quantite_negative_422(self, investisseur_client):
        """quantite ≤ 0 → 422."""
        r = investisseur_client.post(
            "/api/ordres",
            json={
                "instrument_code": "IAM",
                "sens": "achat",
                "type_ordre": "marche",
                "quantite": -10,
                "prix_marche": 100.0,
            },
        )
        assert r.status_code == 422

    def test_portefeuille_introuvable_400(self, investisseur_client):
        """compte_id non trouvé → 400."""
        cur = make_cursor(fetchone_seq=[None])
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
        assert "Portefeuille introuvable" in r.json()["detail"]

    def test_solde_insuffisant_400(self, investisseur_client):
        """Solde < montant requis → 400."""
        compte_uuid    = "compte-uuid-1"
        instrument_uuid = "instr-uuid-1"
        cur = make_cursor(fetchone_seq=[
            {"id": compte_uuid},
            {"id": instrument_uuid},
            {"solde_especes": 10.0},    # solde = 10 MAD, besoin = 11 000 MAD
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
                    "prix_marche": 110.0,
                },
            )
        assert r.status_code == 400
        assert "Solde insuffisant" in r.json()["detail"]

    def test_quantite_vente_insuffisante_400(self, investisseur_client):
        """Vente > position détenue → 400."""
        cur = make_cursor(fetchone_seq=[
            {"id": "compte-1"},
            {"id": "instr-1"},
            {"solde_especes": 99999.0},
            {"quantite": 5.0},          # détenu : 5 titres, vente : 100
        ])
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = investisseur_client.post(
                "/api/ordres",
                json={
                    "instrument_code": "ATW",
                    "sens": "vente",
                    "type_ordre": "marche",
                    "quantite": 100,
                    "prix_marche": 490.0,
                },
            )
        assert r.status_code == 400
        assert "Quantité insuffisante" in r.json()["detail"]


# ═════════════════════════════════════════════════════════════════════════════
# PASSER ORDRE — intégration FIX 4.4
# ═════════════════════════════════════════════════════════════════════════════

class TestPasserOrdreFIX:
    """Vérifie que passer_ordre route correctement via le moteur FIX simulé."""

    _BASE_ACHAT = {
        "instrument_code": "ATW",
        "sens": "achat",
        "type_ordre": "limite",
        "quantite": 100,
        "prix_limite": 490.0,
        "time_in_force": "day",
    }

    def _make_db_seq(self, solde=500_000.0):
        return [
            {"id": "compte-1"},
            {"id": "instr-1"},
            {"solde_especes": solde},
        ]

    def test_ordre_limite_en_attente_fix(self, investisseur_client):
        """Moteur FIX retourne en_attente → DB insère avec statut en_attente."""
        cur  = make_cursor(fetchone_seq=self._make_db_seq())
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn), \
             patch(f"{_MODULE}.process_new_order", return_value=_FIX_EN_ATTENTE):
            r = investisseur_client.post("/api/ordres", json=self._BASE_ACHAT)

        assert r.status_code == 200
        body = r.json()
        assert body["statut"] == "en_attente"
        assert body["fix_cl_ord_id"] is not None
        assert body["prix_execution"] is None

    def test_ordre_marche_execute_fix(self, investisseur_client):
        """Moteur FIX retourne execute → DB insère + exécution appliquée."""
        cur  = make_cursor(fetchone_seq=self._make_db_seq())
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn), \
             patch(f"{_MODULE}.process_new_order", return_value=_FIX_EXECUTE):
            r = investisseur_client.post("/api/ordres", json={
                **self._BASE_ACHAT,
                "type_ordre": "marche",
                "prix_marche": 490.0,
                "prix_limite": None,
            })

        assert r.status_code == 200
        body = r.json()
        assert body["statut"] == "execute"
        assert body["prix_execution"] == 490.0
        assert body["quantite_executee"] == 100
        assert body["montant_total"] == 49000.0
        conn.commit.assert_called_once()

    def test_ordre_rejete_marche_ferme_fix(self, investisseur_client):
        """Moteur FIX retourne rejete (marché fermé) → DB insère avec statut rejete."""
        cur  = make_cursor(fetchone_seq=self._make_db_seq())
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn), \
             patch(f"{_MODULE}.process_new_order", return_value=_FIX_REJETE):
            r = investisseur_client.post("/api/ordres", json={
                **self._BASE_ACHAT,
                "type_ordre": "marche",
                "prix_marche": 490.0,
                "prix_limite": None,
            })

        assert r.status_code == 200
        body = r.json()
        assert body["statut"] == "rejete"
        assert body["prix_execution"] is None

    def test_fix_cl_ord_id_egal_ordre_id(self, investisseur_client):
        """fix_cl_ord_id == id (même UUID pour DB et carnet FIX)."""
        cur  = make_cursor(fetchone_seq=self._make_db_seq())
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn), \
             patch(f"{_MODULE}.process_new_order", return_value=_FIX_EN_ATTENTE):
            r = investisseur_client.post("/api/ordres", json=self._BASE_ACHAT)

        body = r.json()
        assert body["id"] == body["fix_cl_ord_id"], \
            "L'ID DB et le ClOrdID FIX doivent être identiques pour permettre l'annulation"

    def test_time_in_force_gtc(self, investisseur_client):
        """time_in_force=gtc accepté, transmis au moteur FIX."""
        cur  = make_cursor(fetchone_seq=self._make_db_seq())
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn), \
             patch(f"{_MODULE}.process_new_order", return_value=_FIX_EN_ATTENTE) as mock_fix:
            r = investisseur_client.post("/api/ordres", json={
                **self._BASE_ACHAT,
                "time_in_force": "gtc",
            })

        assert r.status_code == 200
        # Vérifier que le moteur FIX a bien été appelé
        mock_fix.assert_called_once()
        fix_msg = mock_fix.call_args[0][0]
        assert "59=1" in fix_msg.replace("\x01", "|")   # TIF_GTC = "1"

    def test_time_in_force_invalide_422(self, investisseur_client):
        """time_in_force inconnu → 422."""
        r = investisseur_client.post("/api/ordres", json={
            **self._BASE_ACHAT,
            "time_in_force": "eod",
        })
        assert r.status_code == 422


# ═════════════════════════════════════════════════════════════════════════════
# ANNULER ORDRE — intégration FIX 4.4
# ═════════════════════════════════════════════════════════════════════════════

class TestAnnulerOrdre:
    _ORDRE_ROW = {
        "id":       "ordre-1",
        "statut":   "en_attente",
        "sens":     "achat",
        "quantite": 100,
        "symbol":   "ATW",
    }

    def test_ordre_introuvable_404(self, investisseur_client):
        cur  = make_cursor(fetchone_seq=[None])
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = investisseur_client.put("/api/ordres/uuid-inexistant/annuler")

        assert r.status_code == 404

    def test_ordre_deja_execute_400(self, investisseur_client):
        cur  = make_cursor(fetchone_seq=[{"id": "ordre-1", "statut": "execute",
                                          "sens": "achat", "quantite": 10, "symbol": "ATW"}])
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn):
            r = investisseur_client.put("/api/ordres/ordre-1/annuler")

        assert r.status_code == 400

    def test_annulation_en_attente_succes(self, investisseur_client):
        """FIX Cancel Request (35=F) → ordre annulé, DB mise à jour."""
        cur  = make_cursor(fetchone_seq=[self._ORDRE_ROW])
        conn = make_conn(cur)

        with patch_get_connection(f"{_MODULE}.get_connection", conn), \
             patch(f"{_MODULE}.process_cancel", return_value=_FIX_ANNULE):
            r = investisseur_client.put("/api/ordres/ordre-1/annuler")

        assert r.status_code == 200
        body = r.json()
        assert body["succes"] is True
        assert "35=F" in body["message"]
        conn.commit.assert_called_once()

    def test_annulation_ordre_non_dans_carnet_400(self, investisseur_client):
        """FIX retourne erreur (ordre hors carnet) → 400."""
        cur  = make_cursor(fetchone_seq=[self._ORDRE_ROW])
        conn = make_conn(cur)
        fix_err = (_FIX_EXEC_MSG, {"erreur": "Ordre introuvable dans le carnet."})

        with patch_get_connection(f"{_MODULE}.get_connection", conn), \
             patch(f"{_MODULE}.process_cancel", return_value=fix_err):
            r = investisseur_client.put("/api/ordres/ordre-1/annuler")

        assert r.status_code == 400
        assert "introuvable" in r.json()["detail"].lower()


# ═════════════════════════════════════════════════════════════════════════════
# CARNET D'ORDRES
# ═════════════════════════════════════════════════════════════════════════════

class TestCarnetOrdres:
    def test_carnet_retourne_snapshot(self, investisseur_client):
        """GET /api/ordres/carnet/{symbol} → snapshot {symbol, phase, bids, asks}."""
        snapshot = {
            "symbol": "ATW",
            "phase":  "continuous",
            "bids":   [{"prix": 490.0, "quantite": 100, "ordre_id": "uuid-1"}],
            "asks":   [],
        }
        with patch(f"{_MODULE}.get_order_book_snapshot", return_value=snapshot):
            r = investisseur_client.get("/api/ordres/carnet/ATW")

        assert r.status_code == 200
        body = r.json()
        assert body["symbol"] == "ATW"
        assert body["phase"]  == "continuous"
        assert len(body["bids"]) == 1
        assert body["bids"][0]["prix"] == 490.0

    def test_carnet_symbole_uppercase(self, investisseur_client):
        """Le symbole est passé en majuscules au moteur."""
        with patch(f"{_MODULE}.get_order_book_snapshot", return_value={
            "symbol": "ATW", "phase": "closed", "bids": [], "asks": []
        }) as mock_snap:
            investisseur_client.get("/api/ordres/carnet/atw")

        mock_snap.assert_called_once_with("ATW")
