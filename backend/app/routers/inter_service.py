"""Endpoints SSO inter-service banque ↔ bourse et SCA (Scénarios 1-5)."""
import time

import requests as _requests
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from app.auth import _decoder_token
from app.config import settings
from app.keycloak_client import KeycloakAdminClient

router = APIRouter(tags=["SSO Inter-Service"])

# ── Stores en mémoire (POC) ───────────────────────────────────────────────────
_logout_blacklist: dict[str, float] = {}  # email → timestamp déconnexion banque
_sca_sessions: dict[str, float] = {}     # email → timestamp dernière SCA validée
_SCA_TTL = 900  # 15 minutes


def _check_inter_service(token: str | None):
    if token != settings.INTER_SERVICE_TOKEN:
        raise HTTPException(403, "Token inter-service invalide.")


def _kc_admin_token() -> str:
    return KeycloakAdminClient()._obtenir_token_service_account()


def _get_email_from_bearer(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Token manquant.")
    try:
        claims = _decoder_token(auth[7:])
    except HTTPException:
        raise
    email = claims.get("email", "").lower()
    if not email:
        raise HTTPException(401, "Claim email manquant dans le token.")
    return email


# ── Vérification existence et liaison (Scénarios 1 & 2) ──────────────────────

@router.get("/api/sso/existe")
def check_user_existe(
    email: str,
    x_inter_service_token: str = Header(None),
):
    """(Inter-service) Vérifie si l'utilisateur existe dans KC Bourse."""
    _check_inter_service(x_inter_service_token)
    token = _kc_admin_token()
    r = _requests.get(
        f"{settings.keycloak_admin_realm_url}/users",
        params={"email": email, "exact": "true"},
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    if not r.ok:
        raise HTTPException(502, f"KC Admin API error: {r.status_code}")
    users = r.json()
    if not users:
        return {"existe": False}
    u = users[0]
    return {"existe": True, "keycloak_id": u["id"], "enabled": u.get("enabled", True)}


@router.get("/api/sso/est-lie")
def check_user_lie(
    email: str,
    x_inter_service_token: str = Header(None),
):
    """(Inter-service) Vérifie si le compte bourse est lié à l'IDP cfc-banque (Scénario 1)."""
    _check_inter_service(x_inter_service_token)
    token = _kc_admin_token()

    r = _requests.get(
        f"{settings.keycloak_admin_realm_url}/users",
        params={"email": email, "exact": "true"},
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    if not r.ok or not r.json():
        return {"existe": False, "lie": False}

    user_id = r.json()[0]["id"]
    r2 = _requests.get(
        f"{settings.keycloak_admin_realm_url}/users/{user_id}/federated-identity",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    if not r2.ok:
        return {"existe": True, "lie": False}

    lie = any(fi.get("identityProvider") == "cfc-banque" for fi in r2.json())
    return {"existe": True, "lie": lie}


# ── Vérification statut banque (Scénario 5) ───────────────────────────────────

@router.get("/api/sso/status-banque")
def check_statut_banque(request: Request):
    """Vérifie si le compte banque de l'utilisateur est actif avant navigation (Scénario 5)."""
    email = _get_email_from_bearer(request)
    try:
        r = _requests.get(
            f"{settings.BANQUE_API_URL}/bourse/check-suspension",
            params={"email": email},
            headers={"X-Inter-Service-Token": settings.INTER_SERVICE_TOKEN},
            timeout=5,
        )
        if r.status_code == 403:
            detail = r.json().get("detail", "Compte suspendu")
            return {"actif": False, "raison": detail}
        if r.status_code == 404:
            return {"actif": True}
        r.raise_for_status()
        return r.json()
    except (_requests.exceptions.ConnectionError, _requests.exceptions.Timeout):
        return {"actif": True}  # fail-open si banque indisponible


# ── Logout propagation (Scénario 4) ───────────────────────────────────────────

class LogoutBanquePayload(BaseModel):
    email: str


@router.post("/api/sso/logout-banque")
def logout_banque(
    payload: LogoutBanquePayload,
    x_inter_service_token: str = Header(None),
):
    """(Inter-service) Reçoit la notification de logout banque et révoque la session bourse."""
    _check_inter_service(x_inter_service_token)
    _logout_blacklist[payload.email.lower()] = time.time()
    return {"ok": True}


@router.get("/api/sso/heartbeat")
def session_heartbeat(request: Request):
    """
    Vérifie si la session bourse est toujours valide (Scénario 4).
    Retourne 401 si le compte banque a été déconnecté dans les 90 dernières secondes.
    """
    email = _get_email_from_bearer(request)

    logout_ts = _logout_blacklist.get(email)
    if logout_ts:
        if time.time() - logout_ts < 90:
            raise HTTPException(401, "Session révoquée suite à déconnexion banque.")
        del _logout_blacklist[email]

    return {"valide": True, "email": email}


# ── SCA — Authentification forte pour ordres (Scénario 3) ─────────────────────

def sca_valide_pour(email: str) -> bool:
    """Indique si l'email a une SCA valide (< 15 min)."""
    ts = _sca_sessions.get(email.lower())
    return ts is not None and time.time() - ts < _SCA_TTL


class ScaVerifyPayload(BaseModel):
    code: str


@router.post("/api/sca/verifier")
def verifier_sca(payload: ScaVerifyPayload, request: Request):
    """
    Valide la SCA et enregistre la session SCA (Scénario 3).
    POC : accepte tout code à 6 chiffres numériques.
    Production : vérifier le TOTP via KC ou un service dédié.
    """
    email = _get_email_from_bearer(request)
    code = payload.code.strip()
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(400, "Code invalide — entrez 6 chiffres.")
    _sca_sessions[email] = time.time()
    return {"ok": True, "message": "Authentification forte validée."}
