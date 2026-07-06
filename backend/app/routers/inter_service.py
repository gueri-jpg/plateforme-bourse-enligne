"""Endpoints SSO inter-service banque ↔ bourse et SCA (Scénarios 1-5)."""
import hashlib
import secrets
import time
from datetime import datetime, timedelta

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
_otp_store: dict[str, dict] = {}         # email → {otp_hash, expires_at, first_name}
_SCA_TTL = 900  # 15 minutes
_OTP_TTL = 600  # 10 minutes


def _send_otp_email(to: str, first_name: str, otp_code: str) -> None:
    """Envoie le code OTP par email via l'API HTTP Resend."""
    subject = f"Code de confirmation ordre — {otp_code} — Bourse en Ligne"
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px">
      <div style="background:linear-gradient(135deg,#1a2f5a,#0d1f3c);
                  padding:20px 24px;border-radius:8px 8px 0 0;text-align:center">
        <h1 style="color:#e8c460;margin:0;font-size:22px;font-weight:900;letter-spacing:-0.5px">Bourse</h1>
        <p style="color:rgba(232,196,96,.7);margin:4px 0 0;font-size:12px;font-weight:600">Plateforme en Ligne</p>
      </div>
      <div style="background:#0d1929;border:1px solid rgba(232,196,96,.2);
                  border-top:none;padding:32px 24px;border-radius:0 0 8px 8px">
        <p style="font-size:16px;color:#f0e8d0;margin-bottom:8px">
          Bonjour <strong style="color:#e8c460">{first_name}</strong>,
        </p>
        <p style="color:#8a9ab5;margin-bottom:24px;font-size:14px;line-height:1.6">
          Votre code de confirmation pour valider votre ordre de bourse :
        </p>
        <div style="background:#0a111e;border:2px solid #e8c460;border-radius:12px;
                    padding:22px 24px;text-align:center;margin:0 0 24px">
          <div style="font-size:11px;color:#4a5a70;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px">Code OTP</div>
          <div style="font-size:40px;font-weight:900;letter-spacing:10px;
                      color:#e8c460;line-height:1;font-family:monospace">{otp_code}</div>
          <div style="font-size:12px;color:#4a5a70;margin-top:8px">
            Valable 10 minutes · Ne le partagez jamais
          </div>
        </div>
        <p style="color:#c04040;font-size:12px;text-align:center">
          Si vous n'êtes pas à l'origine de cet ordre, ignorez ce message.
        </p>
        <hr style="border:none;border-top:1px solid rgba(232,196,96,.1);margin:24px 0">
        <p style="color:#4a5a70;font-size:11px;margin:0">Bourse en Ligne · Plateforme sécurisée</p>
      </div>
    </div>
    """
    text = (
        f"Bonjour {first_name},\n\n"
        f"Votre code OTP pour confirmer votre ordre de bourse :\n\n"
        f"    {otp_code}\n\n"
        f"Valable 10 minutes. Ne le communiquez à personne.\n\n"
        f"— Bourse en Ligne"
    )

    if not settings.RESEND_API_KEY or settings.RESEND_API_KEY == "re_dev_placeholder":
        print(f"\n[OTP EMAIL MOCK] → {to}\nCode : {otp_code}\n{'-'*40}")
        return

    import resend
    resend.api_key = settings.RESEND_API_KEY
    try:
        resend.Emails.send({
            "from": settings.EMAIL_FROM,
            "to": [to],
            "subject": subject,
            "html": html,
            "text": text,
        })
    except Exception as exc:
        print(f"[OTP EMAIL ERROR] {exc}")
        print(f"[OTP EMAIL MOCK] Code : {otp_code}")


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


@router.post("/api/sca/envoyer-otp")
def envoyer_otp_sca(request: Request):
    """
    Génère un OTP à 6 chiffres, stocke son hash et l'envoie par email via Resend.
    Appelé par le frontend dès l'ouverture du modal SCA.
    """
    email = _get_email_from_bearer(request)

    # Nettoyer les OTP expirés
    now = datetime.utcnow()
    expired = [k for k, v in _otp_store.items() if v["expires_at"] < now]
    for k in expired:
        del _otp_store[k]

    # Récupérer le prénom depuis le token Keycloak
    auth = request.headers.get("Authorization", "")
    claims = _decoder_token(auth[7:])
    first_name = claims.get("given_name") or claims.get("name") or email.split("@")[0]

    otp_code = str(secrets.randbelow(900000) + 100000)
    otp_hash = hashlib.sha256(otp_code.encode()).hexdigest()

    _otp_store[email.lower()] = {
        "otp_hash": otp_hash,
        "expires_at": datetime.utcnow() + timedelta(seconds=_OTP_TTL),
        "first_name": first_name,
    }

    _send_otp_email(to=email, first_name=first_name, otp_code=otp_code)

    local = email.split("@")[0]
    masked = ("*" * max(len(local) - 2, 1)) + local[-2:] + "@" + email.split("@")[1]
    return {"ok": True, "masked_email": masked, "expires_in": _OTP_TTL}


@router.post("/api/sca/verifier")
def verifier_sca(payload: ScaVerifyPayload, request: Request):
    """Vérifie l'OTP reçu par email et valide la session SCA (Scénario 3)."""
    email = _get_email_from_bearer(request)
    code = payload.code.strip()

    if not code.isdigit() or len(code) != 6:
        raise HTTPException(400, "Code invalide — entrez 6 chiffres.")

    entry = _otp_store.get(email.lower())
    if not entry:
        raise HTTPException(404, "Aucun OTP envoyé. Cliquez sur 'Renvoyer le code'.")
    if datetime.utcnow() > entry["expires_at"]:
        del _otp_store[email.lower()]
        raise HTTPException(410, "Code OTP expiré. Cliquez sur 'Renvoyer le code'.")

    provided_hash = hashlib.sha256(code.encode()).hexdigest()
    if provided_hash != entry["otp_hash"]:
        raise HTTPException(422, "Code OTP incorrect.")

    del _otp_store[email.lower()]
    _sca_sessions[email.lower()] = time.time()
    return {"ok": True, "message": "Authentification forte validée."}
