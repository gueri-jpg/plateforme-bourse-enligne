"""Tests endpoints sans auth : /api/health et /api/config."""


def test_healthcheck_retourne_ok(anonymous_client):
    r = anonymous_client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"statut": "ok"}


def test_config_publique_contient_banque_url(anonymous_client):
    r = anonymous_client.get("/api/config")
    assert r.status_code == 200
    data = r.json()
    assert "banque_frontend_url" in data
    assert isinstance(data["banque_frontend_url"], str)
