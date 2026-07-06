"""Réinitialisation du mot de passe en 3 étapes (email OTP → token → nouveau MDP)."""
import hashlib
import secrets
from datetime import datetime, timedelta

import requests as _requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.keycloak_client import KeycloakAdminClient

router = APIRouter(prefix="/auth", tags=["Auth Reset"])

# Store en mémoire (POC)
_reset_store: dict[str, dict] = {}   # email → {otp_hash, expires_at, first_name}
_token_store: dict[str, dict] = {}   # reset_token → {email, expires_at}
_OTP_TTL   = 600   # 10 minutes
_TOKEN_TTL = 900   # 15 minutes


def _kc_admin_token() -> str:
    return KeycloakAdminClient()._obtenir_token_service_account()


def _get_kc_user(email: str) -> dict | None:
    token = _kc_admin_token()
    r = _requests.get(
        f"{settings.keycloak_admin_realm_url}/users",
        params={"email": email.lower(), "exact": "true"},
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    if not r.ok:
        return None
    users = r.json()
    return users[0] if users else None


def _send_reset_email(to: str, first_name: str, otp_code: str) -> None:
    subject = f"Code de réinitialisation — {otp_code} — Bourse en Ligne"
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px">
      <div style="background:linear-gradient(135deg,#1a2f5a,#0d1f3c);
                  padding:20px 24px;border-radius:8px 8px 0 0;text-align:center">
        <h1 style="color:#f59e0b;margin:0;font-size:22px;font-weight:900">BourseOnline</h1>
        <p style="color:rgba(245,158,11,.7);margin:4px 0 0;font-size:12px">Réinitialisation du mot de passe</p>
      </div>
      <div style="background:#0d1929;border:1px solid rgba(245,158,11,.2);
                  border-top:none;padding:32px 24px;border-radius:0 0 8px 8px">
        <p style="font-size:16px;color:#f0e8d0;margin-bottom:8px">
          Bonjour <strong style="color:#f59e0b">{first_name}</strong>,
        </p>
        <p style="color:#8a93b8;margin-bottom:24px;font-size:14px;line-height:1.6">
          Votre code pour réinitialiser votre mot de passe :
        </p>
        <div style="background:#0a111e;border:2px solid #f59e0b;border-radius:12px;
                    padding:22px 24px;text-align:center;margin:0 0 24px">
          <div style="font-size:11px;color:#4a5a70;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px">Code de réinitialisation</div>
          <div style="font-size:40px;font-weight:900;letter-spacing:10px;
                      color:#f59e0b;line-height:1;font-family:monospace">{otp_code}</div>
          <div style="font-size:12px;color:#4a5a70;margin-top:8px">
            Valable 10 minutes · Ne le partagez jamais
          </div>
        </div>
        <p style="color:#c04040;font-size:12px;text-align:center">
          Si vous n'avez pas demandé cette réinitialisation, ignorez ce message.
        </p>
      </div>
    </div>
    """
    text = (
        f"Bonjour {first_name},\n\n"
        f"Votre code de réinitialisation de mot de passe :\n\n"
        f"    {otp_code}\n\n"
        f"Valable 10 minutes. Ne le communiquez à personne.\n\n"
        f"— BourseOnline"
    )

    if not settings.RESEND_API_KEY or settings.RESEND_API_KEY == "re_dev_placeholder":
        print(f"\n[RESET EMAIL MOCK] → {to}\nCode : {otp_code}\n{'-'*40}")
        return

    recipient = settings.RESEND_OVERRIDE_TO or to

    import resend
    resend.api_key = settings.RESEND_API_KEY
    try:
        resend.Emails.send({
            "from": settings.EMAIL_FROM,
            "to": [recipient],
            "subject": subject,
            "html": html,
            "text": text,
        })
    except Exception as exc:
        print(f"[RESET EMAIL ERROR] {exc}")
        print(f"[RESET EMAIL MOCK] Code : {otp_code}")


# ── Étape 1 : demande de réinitialisation ─────────────────────────────────────

class ForgotPasswordIn(BaseModel):
    email: str


@router.post("/forgot-password")
def forgot_password(data: ForgotPasswordIn):
    email = data.email.strip().lower()

    # Vérifier que l'utilisateur existe dans Keycloak
    user = _get_kc_user(email)
    if not user:
        # Ne pas révéler si l'email existe ou non (sécurité)
        local = email.split("@")[0]
        masked = ("*" * max(len(local) - 2, 1)) + local[-2:] + "@" + email.split("@")[1]
        return {"success": True, "masked_email": masked}

    first_name = user.get("firstName") or email.split("@")[0]

    # Nettoyer les OTP expirés
    now = datetime.utcnow()
    for k in [k for k, v in _reset_store.items() if v["expires_at"] < now]:
        del _reset_store[k]

    otp_code = str(secrets.randbelow(900000) + 100000)
    otp_hash = hashlib.sha256(otp_code.encode()).hexdigest()

    _reset_store[email] = {
        "otp_hash": otp_hash,
        "expires_at": now + timedelta(seconds=_OTP_TTL),
        "first_name": first_name,
        "kc_user_id": user["id"],
    }

    _send_reset_email(to=email, first_name=first_name, otp_code=otp_code)

    local = email.split("@")[0]
    masked = ("*" * max(len(local) - 2, 1)) + local[-2:] + "@" + email.split("@")[1]
    return {"success": True, "masked_email": masked}


# ── Étape 2 : vérification du code ────────────────────────────────────────────

class VerifyCodeIn(BaseModel):
    email: str
    code: str


@router.post("/verify-reset-code")
def verify_reset_code(data: VerifyCodeIn):
    email = data.email.strip().lower()
    code = data.code.strip()

    if not code.isdigit() or len(code) != 6:
        raise HTTPException(400, "Code invalide — 6 chiffres requis.")

    entry = _reset_store.get(email)
    if not entry:
        raise HTTPException(404, "Aucun code envoyé pour cet email. Recommencez.")
    if datetime.utcnow() > entry["expires_at"]:
        del _reset_store[email]
        raise HTTPException(410, "Code expiré. Demandez un nouveau code.")

    provided_hash = hashlib.sha256(code.encode()).hexdigest()
    if provided_hash != entry["otp_hash"]:
        raise HTTPException(422, "Code incorrect.")

    # Code valide → générer un reset_token court
    reset_token = secrets.token_urlsafe(32)
    _token_store[reset_token] = {
        "email": email,
        "kc_user_id": entry["kc_user_id"],
        "expires_at": datetime.utcnow() + timedelta(seconds=_TOKEN_TTL),
    }
    del _reset_store[email]

    return {"success": True, "reset_token": reset_token}


# ── Étape 3 : nouveau mot de passe ───────────────────────────────────────────

class ResetPasswordIn(BaseModel):
    reset_token: str
    password: str
    confirm_password: str


@router.post("/reset-password")
def reset_password(data: ResetPasswordIn):
    if data.password != data.confirm_password:
        raise HTTPException(400, "Les mots de passe ne correspondent pas.")
    if len(data.password) < 8:
        raise HTTPException(400, "Le mot de passe doit contenir au moins 8 caractères.")

    entry = _token_store.get(data.reset_token)
    if not entry:
        raise HTTPException(404, "Token invalide ou expiré. Recommencez depuis le début.")
    if datetime.utcnow() > entry["expires_at"]:
        del _token_store[data.reset_token]
        raise HTTPException(410, "Token expiré. Recommencez depuis le début.")

    # Réinitialiser le mot de passe via KC Admin API
    kc_user_id = entry["kc_user_id"]
    try:
        token = _kc_admin_token()
        r = _requests.put(
            f"{settings.keycloak_admin_realm_url}/users/{kc_user_id}/reset-password",
            json={"type": "password", "value": data.password, "temporary": False},
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            timeout=10,
        )
        if r.status_code not in (200, 204):
            raise HTTPException(502, f"Erreur Keycloak : {r.status_code} {r.text}")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"Erreur lors de la réinitialisation : {exc}")

    del _token_store[data.reset_token]
    return {"success": True, "message": "Mot de passe réinitialisé avec succès."}
