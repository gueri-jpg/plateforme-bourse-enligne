"""Tests SSO inter-service et SCA — app.routers.inter_service.

Endpoints couverts :
  GET  /api/sso/existe
  GET  /api/sso/est-lie
  GET  /api/sso/status-banque
  POST /api/sso/logout-banque
  GET  /api/sso/heartbeat
  GET  /api/sso/generate-handoff
  GET  /api/sso/exchange-handoff
  GET  /api/sso/web-exchange
  GET  /api/sso/generate-tokens-for-user
  POST /api/sca/envoyer-otp
  POST /api/sca/verifier
"""
import hashlib
import time
import unittest.mock as _mock
from datetime import datetime, timedelta

import pytest
import requests as _req_lib

_MODULE = "app.routers.inter_service"
_TOKEN = "test-inter-service-token"
_BEARER = {"Authorization": "Bearer faketoken"}
_INTER = {"X-Inter-Service-Token": _TOKEN}
_CLAIMS = {"email": "user@test.ma", "given_name": "Test", "name": "Test User", "sub": "kc-id"}


@pytest.fixture(autouse=True)
def patch_settings(monkeypatch):
    """Fixe le token inter-service et les URLs pour tous les tests de ce module."""
    import app.routers.inter_service as mod
    monkeypatch.setattr(mod.settings, "INTER_SERVICE_TOKEN", _TOKEN)
    monkeypatch.setattr(mod.settings, "BANQUE_API_URL", "http://banque-test")
    monkeypatch.setattr(mod.settings, "RESEND_API_KEY", "re_dev_placeholder")


# ── /api/sso/existe ───────────────────────────────────────────────────────────

class TestExiste:
    URL = "/api/sso/existe"

    def test_mauvais_token_403(self, anonymous_client):
        r = anonymous_client.get(self.URL, params={"email": "x@t.ma"},
                                 headers={"X-Inter-Service-Token": "bad"})
        assert r.status_code == 403

    def test_user_existe(self, anonymous_client):
        mock_r = _mock.MagicMock(ok=True)
        mock_r.json.return_value = [{"id": "kc-123", "enabled": True}]
        with _mock.patch(f"{_MODULE}._kc_admin_token", return_value="tok"), \
             _mock.patch(f"{_MODULE}._requests.get", return_value=mock_r):
            r = anonymous_client.get(self.URL, params={"email": "user@test.ma"}, headers=_INTER)
        assert r.status_code == 200
        assert r.json() == {"existe": True, "keycloak_id": "kc-123", "enabled": True}

    def test_user_absent(self, anonymous_client):
        mock_r = _mock.MagicMock(ok=True)
        mock_r.json.return_value = []
        with _mock.patch(f"{_MODULE}._kc_admin_token", return_value="tok"), \
             _mock.patch(f"{_MODULE}._requests.get", return_value=mock_r):
            r = anonymous_client.get(self.URL, params={"email": "absent@test.ma"}, headers=_INTER)
        assert r.status_code == 200
        assert r.json()["existe"] is False

    def test_kc_erreur_502(self, anonymous_client):
        mock_r = _mock.MagicMock(ok=False, status_code=503)
        with _mock.patch(f"{_MODULE}._kc_admin_token", return_value="tok"), \
             _mock.patch(f"{_MODULE}._requests.get", return_value=mock_r):
            r = anonymous_client.get(self.URL, params={"email": "x@t.ma"}, headers=_INTER)
        assert r.status_code == 502


# ── /api/sso/est-lie ──────────────────────────────────────────────────────────

class TestEstLie:
    URL = "/api/sso/est-lie"

    def test_mauvais_token_403(self, anonymous_client):
        r = anonymous_client.get(self.URL, params={"email": "x@t.ma"},
                                 headers={"X-Inter-Service-Token": "bad"})
        assert r.status_code == 403

    def test_user_inexistant(self, anonymous_client):
        mock_r = _mock.MagicMock(ok=True)
        mock_r.json.return_value = []
        with _mock.patch(f"{_MODULE}._kc_admin_token", return_value="tok"), \
             _mock.patch(f"{_MODULE}._requests.get", return_value=mock_r):
            r = anonymous_client.get(self.URL, params={"email": "absent@t.ma"}, headers=_INTER)
        assert r.status_code == 200
        assert r.json() == {"existe": False, "lie": False}

    def test_user_existe_non_lie(self, anonymous_client):
        mock_users = _mock.MagicMock(ok=True)
        mock_users.json.return_value = [{"id": "kc-123"}]
        mock_fed = _mock.MagicMock(ok=True)
        mock_fed.json.return_value = []
        with _mock.patch(f"{_MODULE}._kc_admin_token", return_value="tok"), \
             _mock.patch(f"{_MODULE}._requests.get", side_effect=[mock_users, mock_fed]):
            r = anonymous_client.get(self.URL, params={"email": "user@t.ma"}, headers=_INTER)
        assert r.status_code == 200
        data = r.json()
        assert data["existe"] is True
        assert data["lie"] is False

    def test_user_lie(self, anonymous_client):
        mock_users = _mock.MagicMock(ok=True)
        mock_users.json.return_value = [{"id": "kc-123"}]
        mock_fed = _mock.MagicMock(ok=True)
        mock_fed.json.return_value = [{"identityProvider": "cfc-banque"}]
        with _mock.patch(f"{_MODULE}._kc_admin_token", return_value="tok"), \
             _mock.patch(f"{_MODULE}._requests.get", side_effect=[mock_users, mock_fed]):
            r = anonymous_client.get(self.URL, params={"email": "user@t.ma"}, headers=_INTER)
        assert r.status_code == 200
        assert r.json()["lie"] is True


# ── /api/sso/status-banque ────────────────────────────────────────────────────

class TestStatusBanque:
    URL = "/api/sso/status-banque"

    def test_sans_auth_401(self, anonymous_client):
        r = anonymous_client.get(self.URL)
        assert r.status_code == 401

    def test_compte_actif(self, anonymous_client):
        mock_r = _mock.MagicMock(status_code=200, ok=True)
        mock_r.json.return_value = {"actif": True}
        mock_r.raise_for_status = _mock.MagicMock()
        with _mock.patch(f"{_MODULE}._decoder_token", return_value=_CLAIMS), \
             _mock.patch(f"{_MODULE}._requests.get", return_value=mock_r):
            r = anonymous_client.get(self.URL, headers=_BEARER)
        assert r.status_code == 200
        assert r.json()["actif"] is True

    def test_compte_suspendu(self, anonymous_client):
        mock_r = _mock.MagicMock(status_code=403)
        mock_r.json.return_value = {"detail": "Compte suspendu"}
        with _mock.patch(f"{_MODULE}._decoder_token", return_value=_CLAIMS), \
             _mock.patch(f"{_MODULE}._requests.get", return_value=mock_r):
            r = anonymous_client.get(self.URL, headers=_BEARER)
        assert r.status_code == 200
        data = r.json()
        assert data["actif"] is False
        assert "suspendu" in data["raison"].lower()

    def test_banque_inaccessible_fail_open(self, anonymous_client):
        with _mock.patch(f"{_MODULE}._decoder_token", return_value=_CLAIMS), \
             _mock.patch(f"{_MODULE}._requests.get",
                         side_effect=_req_lib.exceptions.ConnectionError):
            r = anonymous_client.get(self.URL, headers=_BEARER)
        assert r.status_code == 200
        assert r.json()["actif"] is True  # fail-open


# ── /api/sso/logout-banque ────────────────────────────────────────────────────

class TestLogoutBanque:
    URL = "/api/sso/logout-banque"

    def test_mauvais_token_403(self, anonymous_client):
        r = anonymous_client.post(self.URL, json={"email": "x@t.ma"},
                                  headers={"X-Inter-Service-Token": "bad"})
        assert r.status_code == 403

    def test_logout_enregistre(self, anonymous_client):
        r = anonymous_client.post(self.URL, json={"email": "user@test.ma"}, headers=_INTER)
        assert r.status_code == 200
        assert r.json()["ok"] is True


# ── /api/sso/heartbeat ────────────────────────────────────────────────────────

class TestHeartbeat:
    URL = "/api/sso/heartbeat"

    def test_sans_auth_401(self, anonymous_client):
        r = anonymous_client.get(self.URL)
        assert r.status_code == 401

    def test_session_valide(self, anonymous_client):
        import app.routers.inter_service as mod
        mod._logout_blacklist.pop("user@test.ma", None)
        with _mock.patch(f"{_MODULE}._decoder_token", return_value=_CLAIMS):
            r = anonymous_client.get(self.URL, headers=_BEARER)
        assert r.status_code == 200
        assert r.json()["valide"] is True

    def test_session_revoquee_recemment_401(self, anonymous_client):
        import app.routers.inter_service as mod
        mod._logout_blacklist["user@test.ma"] = time.time()  # logout < 90s
        try:
            with _mock.patch(f"{_MODULE}._decoder_token", return_value=_CLAIMS):
                r = anonymous_client.get(self.URL, headers=_BEARER)
            assert r.status_code == 401
        finally:
            mod._logout_blacklist.pop("user@test.ma", None)

    def test_blacklist_expiree_valide(self, anonymous_client):
        import app.routers.inter_service as mod
        mod._logout_blacklist["user@test.ma"] = time.time() - 200  # logout > 90s → expiré
        with _mock.patch(f"{_MODULE}._decoder_token", return_value=_CLAIMS):
            r = anonymous_client.get(self.URL, headers=_BEARER)
        assert r.status_code == 200
        assert "user@test.ma" not in mod._logout_blacklist  # nettoyé automatiquement


# ── /api/sso/generate-handoff ─────────────────────────────────────────────────

class TestGenerateHandoff:
    URL = "/api/sso/generate-handoff"

    def test_sans_auth_401(self, anonymous_client):
        r = anonymous_client.get(self.URL)
        assert r.status_code == 401

    def test_retourne_token(self, anonymous_client):
        with _mock.patch(f"{_MODULE}._decoder_token", return_value=_CLAIMS):
            r = anonymous_client.get(self.URL, headers=_BEARER)
        assert r.status_code == 200
        token = r.json().get("handoff_token", "")
        assert len(token) > 10

    def test_token_one_time(self, anonymous_client):
        """Deux appels génèrent deux tokens différents."""
        with _mock.patch(f"{_MODULE}._decoder_token", return_value=_CLAIMS):
            t1 = anonymous_client.get(self.URL, headers=_BEARER).json()["handoff_token"]
            t2 = anonymous_client.get(self.URL, headers=_BEARER).json()["handoff_token"]
        assert t1 != t2


# ── /api/sso/exchange-handoff ─────────────────────────────────────────────────

class TestExchangeHandoff:
    URL = "/api/sso/exchange-handoff"

    def test_mauvais_token_403(self, anonymous_client):
        r = anonymous_client.get(self.URL, params={"token": "abc"},
                                 headers={"X-Inter-Service-Token": "bad"})
        assert r.status_code == 403

    def test_token_invalide_401(self, anonymous_client):
        r = anonymous_client.get(self.URL, params={"token": "inexistant"}, headers=_INTER)
        assert r.status_code == 401

    def test_token_expire_401(self, anonymous_client):
        import app.routers.inter_service as mod
        mod._bourse_handoff_tokens["expired"] = {
            "email": "user@test.ma",
            "expires_at": time.time() - 10,
        }
        r = anonymous_client.get(self.URL, params={"token": "expired"}, headers=_INTER)
        assert r.status_code == 401

    def test_echange_valide_et_consomme(self, anonymous_client):
        import app.routers.inter_service as mod
        mod._bourse_handoff_tokens["mytoken"] = {
            "email": "user@test.ma",
            "expires_at": time.time() + 120,
        }
        r = anonymous_client.get(self.URL, params={"token": "mytoken"}, headers=_INTER)
        assert r.status_code == 200
        assert r.json()["email"] == "user@test.ma"
        assert "mytoken" not in mod._bourse_handoff_tokens  # one-time


# ── /api/sso/web-exchange ─────────────────────────────────────────────────────

class TestWebExchange:
    URL = "/api/sso/web-exchange"

    def test_token_invalide_401(self, anonymous_client):
        mock_r = _mock.MagicMock(status_code=401, ok=False)
        with _mock.patch(f"{_MODULE}._requests.get", return_value=mock_r):
            r = anonymous_client.get(self.URL, params={"token": "bad"})
        assert r.status_code == 401

    def test_banque_indisponible_503(self, anonymous_client):
        mock_r = _mock.MagicMock(ok=False, status_code=500)
        with _mock.patch(f"{_MODULE}._requests.get", return_value=mock_r):
            r = anonymous_client.get(self.URL, params={"token": "abc"})
        assert r.status_code == 503

    def test_succes_proxy(self, anonymous_client):
        mock_r = _mock.MagicMock(ok=True, status_code=200)
        mock_r.json.return_value = {"access_token": "tok", "email": "user@test.ma"}
        with _mock.patch(f"{_MODULE}._requests.get", return_value=mock_r):
            r = anonymous_client.get(self.URL, params={"token": "valid"})
        assert r.status_code == 200
        assert "access_token" in r.json()


# ── /api/sso/generate-tokens-for-user ────────────────────────────────────────

class TestGenerateTokensForUser:
    URL = "/api/sso/generate-tokens-for-user"

    def test_mauvais_token_403(self, anonymous_client):
        r = anonymous_client.get(self.URL, params={"email": "x@t.ma"},
                                 headers={"X-Inter-Service-Token": "bad"})
        assert r.status_code == 403

    def test_user_inexistant_404(self, anonymous_client):
        mock_r = _mock.MagicMock(ok=True)
        mock_r.json.return_value = []
        with _mock.patch(f"{_MODULE}._kc_admin_token", return_value="tok"), \
             _mock.patch(f"{_MODULE}._requests.get", return_value=mock_r):
            r = anonymous_client.get(self.URL, params={"email": "absent@t.ma"}, headers=_INTER)
        assert r.status_code == 404

    def test_token_exchange_echoue_503(self, anonymous_client):
        mock_r = _mock.MagicMock(ok=True)
        mock_r.json.return_value = [{"id": "kc-123"}]
        with _mock.patch(f"{_MODULE}._kc_admin_token", return_value="tok"), \
             _mock.patch(f"{_MODULE}._requests.get", return_value=mock_r), \
             _mock.patch(f"{_MODULE}._generate_tokens_for_user", return_value=None):
            r = anonymous_client.get(self.URL, params={"email": "u@t.ma"}, headers=_INTER)
        assert r.status_code == 503


# ── /api/sca/envoyer-otp ─────────────────────────────────────────────────────

class TestEnvoyerOTP:
    URL = "/api/sca/envoyer-otp"

    def test_sans_auth_401(self, anonymous_client):
        r = anonymous_client.post(self.URL)
        assert r.status_code == 401

    def test_otp_genere_et_masque(self, anonymous_client):
        with _mock.patch(f"{_MODULE}._decoder_token", return_value=_CLAIMS):
            r = anonymous_client.post(self.URL, headers=_BEARER)
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is True
        assert "@" in data["masked_email"]
        assert data["expires_in"] == 600

    def test_otp_stocke_dans_store(self, anonymous_client):
        import app.routers.inter_service as mod
        mod._otp_store.pop("user@test.ma", None)
        with _mock.patch(f"{_MODULE}._decoder_token", return_value=_CLAIMS):
            anonymous_client.post(self.URL, headers=_BEARER)
        assert "user@test.ma" in mod._otp_store
        assert "otp_hash" in mod._otp_store["user@test.ma"]


# ── /api/sca/verifier ─────────────────────────────────────────────────────────

class TestVerifierSCA:
    URL = "/api/sca/verifier"

    def _seed_otp(self, code: str, expired: bool = False):
        import app.routers.inter_service as mod
        delta = -1 if expired else 600
        mod._otp_store["user@test.ma"] = {
            "otp_hash": hashlib.sha256(code.encode()).hexdigest(),
            "expires_at": datetime.utcnow() + timedelta(seconds=delta),
            "first_name": "Test",
        }

    def test_sans_auth_401(self, anonymous_client):
        r = anonymous_client.post(self.URL, json={"code": "123456"})
        assert r.status_code == 401

    def test_code_non_numerique_400(self, anonymous_client):
        with _mock.patch(f"{_MODULE}._decoder_token", return_value=_CLAIMS):
            r = anonymous_client.post(self.URL, json={"code": "ABCDEF"}, headers=_BEARER)
        assert r.status_code == 400

    def test_aucun_otp_404(self, anonymous_client):
        import app.routers.inter_service as mod
        mod._otp_store.pop("user@test.ma", None)
        with _mock.patch(f"{_MODULE}._decoder_token", return_value=_CLAIMS):
            r = anonymous_client.post(self.URL, json={"code": "123456"}, headers=_BEARER)
        assert r.status_code == 404

    def test_otp_expire_410(self, anonymous_client):
        self._seed_otp("999999", expired=True)
        with _mock.patch(f"{_MODULE}._decoder_token", return_value=_CLAIMS):
            r = anonymous_client.post(self.URL, json={"code": "999999"}, headers=_BEARER)
        assert r.status_code == 410

    def test_code_incorrect_422(self, anonymous_client):
        self._seed_otp("654321")
        with _mock.patch(f"{_MODULE}._decoder_token", return_value=_CLAIMS):
            r = anonymous_client.post(self.URL, json={"code": "000000"}, headers=_BEARER)
        assert r.status_code == 422

    def test_code_correct_200_et_session_sca(self, anonymous_client):
        import app.routers.inter_service as mod
        self._seed_otp("123456")
        with _mock.patch(f"{_MODULE}._decoder_token", return_value=_CLAIMS):
            r = anonymous_client.post(self.URL, json={"code": "123456"}, headers=_BEARER)
        assert r.status_code == 200
        assert r.json()["ok"] is True
        # OTP consommé
        assert "user@test.ma" not in mod._otp_store
        # Session SCA enregistrée
        assert mod.sca_valide_pour("user@test.ma") is True
