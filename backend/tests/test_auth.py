"""Tests unitaires du module app.auth (RBAC, UtilisateurAuthentifie)."""
import pytest
from fastapi import HTTPException

from app.auth import UtilisateurAuthentifie, administrateur_requis, investisseur_requis


def _user(roles, email="u@bourse.ma", sub="kc-sub-1"):
    return UtilisateurAuthentifie({
        "sub": sub,
        "email": email,
        "preferred_username": "u",
        "realm_access": {"roles": roles},
    })


class TestUtilisateurAuthentifie:
    def test_a_le_role_true(self):
        u = _user(["investisseur"])
        assert u.a_le_role("investisseur") is True

    def test_a_le_role_false(self):
        u = _user(["investisseur"])
        assert u.a_le_role("administrateur") is False

    def test_roles_multiples(self):
        u = _user(["investisseur", "support"])
        assert u.a_le_role("support") is True

    def test_attributs_extraits(self):
        u = _user(["investisseur"], email="alice@bourse.ma", sub="sub-alice")
        assert u.email == "alice@bourse.ma"
        assert u.keycloak_user_id == "sub-alice"

    def test_roles_vides(self):
        u = _user([])
        assert u.a_le_role("investisseur") is False


class TestAdministrateurRequis:
    def test_admin_accepte(self):
        u = _user(["administrateur"])
        result = administrateur_requis(u)
        assert result is u

    def test_non_admin_leve_403(self):
        u = _user(["investisseur"])
        with pytest.raises(HTTPException) as exc_info:
            administrateur_requis(u)
        assert exc_info.value.status_code == 403


class TestInvestisseurRequis:
    def test_investisseur_accepte(self):
        u = _user(["investisseur"])
        result = investisseur_requis(u)
        assert result is u

    def test_admin_aussi_accepte(self):
        u = _user(["administrateur"])
        result = investisseur_requis(u)
        assert result is u

    def test_aucun_role_leve_403(self):
        u = _user([])
        with pytest.raises(HTTPException) as exc_info:
            investisseur_requis(u)
        assert exc_info.value.status_code == 403
