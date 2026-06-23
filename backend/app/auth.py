"""
Validation des tokens JWT emis par Keycloak (realm "bourse-en-ligne") et
controle d'acces par role (RBAC), conformement a docs/architecture.md
section 2.2 et 2.3.

Principe :
  - Le frontend (SPA) obtient un access_token (JWT signe RS256) auprès de
    Keycloak via le flow Authorization Code + PKCE.
  - Ce backend ne fait JAMAIS confiance a un token sans verifier sa
    signature : la cle publique est recuperee dynamiquement depuis le
    endpoint JWKS du realm (`/protocol/openid-connect/certs`), via
    PyJWKClient qui gere le cache des cles.
  - Les roles realm (claim "realm_access.roles") sont ensuite utilises
    pour appliquer le controle d'acces (ex: route /api/admin/... reservee
    au role "administrateur").
"""

from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from app.config import settings


# ----------------------------------------------------------------------
# Schema de securite FastAPI : extrait l'en-tete "Authorization: Bearer <token>"
# ----------------------------------------------------------------------
bearer_scheme = HTTPBearer(
    scheme_name="KeycloakBearer",
    description="Token JWT (access_token) emis par Keycloak, realm 'bourse-en-ligne'",
)

# ----------------------------------------------------------------------
# Deux clients JWKS : un par realm Keycloak.
#   - _jwks_bourse  : realm "bourse-en-ligne"  (investisseurs, support)
#   - _jwks_admin   : realm "bourse-admin"     (administrateurs)
# PyJWKClient gere automatiquement le cache et la rotation des cles.
# ----------------------------------------------------------------------
_jwks_bourse = PyJWKClient(settings.keycloak_jwks_url)
_jwks_admin  = PyJWKClient(settings.keycloak_admin_realm_jwks_url)


class UtilisateurAuthentifie:
    """
    Represente l'utilisateur authentifie, tel qu'extrait des claims du JWT
    valide. Utilise comme objet retourne par les dependances FastAPI
    `utilisateur_courant` / `administrateur_requis`.
    """

    def __init__(self, claims: dict):
        self.claims = claims
        # "sub" = identifiant unique de l'utilisateur cote Keycloak (UUID)
        self.keycloak_user_id: str = claims.get("sub", "")
        self.username: str = claims.get("preferred_username", "")
        self.email: str = claims.get("email", "")
        # Roles realm assignes a l'utilisateur (ex: ["investisseur"])
        self.roles: list[str] = claims.get("realm_access", {}).get("roles", [])

    def a_le_role(self, role: str) -> bool:
        """Verifie si l'utilisateur possede le role realm donne."""
        return role in self.roles


def _decoder_token(token: str) -> dict:
    """
    Decode et valide un token JWT Keycloak.

    Strategie multi-realm :
      1. On lit l'issuer ("iss") du token sans verifier la signature pour
         determiner quel realm a emis le token.
      2. On selectionne le client JWKS correspondant (bourse-en-ligne ou
         bourse-admin) et on valide la signature + l'issuer.

    Leve HTTPException 401 si invalide/expire, 403 si l'issuer est inconnu.
    """
    try:
        # Lecture de l'issuer sans verification de signature (safe car on
        # verifie la signature immediatement apres avec le bon JWKS)
        unverified = jwt.decode(token, options={"verify_signature": False})
        issuer = unverified.get("iss", "")

        if issuer == settings.keycloak_admin_issuer:
            jwks_client = _jwks_admin
            expected_issuer = settings.keycloak_admin_issuer
        elif issuer == settings.keycloak_issuer:
            jwks_client = _jwks_bourse
            expected_issuer = settings.keycloak_issuer
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Issuer inconnu : {issuer}. Tokens acceptes : bourse-en-ligne, bourse-admin.",
            )

        signing_key = jwks_client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=expected_issuer,
            options={"verify_aud": False},
        )
        return claims

    except HTTPException:
        raise
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Le token a expire, veuillez vous reconnecter.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError as erreur:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token invalide : {erreur}",
            headers={"WWW-Authenticate": "Bearer"},
        )


def utilisateur_courant(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer_scheme)],
) -> UtilisateurAuthentifie:
    """
    Dependance FastAPI : extrait et valide le token JWT present dans
    l'en-tete "Authorization: Bearer <token>", et retourne l'utilisateur
    authentifie correspondant.

    Utilisee pour les routes necessitant simplement un utilisateur
    authentifie (quel que soit son role), ex: /api/utilisateurs/moi/otp.
    """
    claims = _decoder_token(credentials.credentials)
    return UtilisateurAuthentifie(claims)


def administrateur_requis(
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(utilisateur_courant)],
) -> UtilisateurAuthentifie:
    """
    Dependance FastAPI : verifie que l'utilisateur authentifie possede le
    role realm "administrateur" (cf. settings.ROLE_ADMINISTRATEUR).

    Utilisee pour proteger toutes les routes /api/admin/parametres/... et
    /api/admin/utilisateurs/{id}/otp, conformement a docs/architecture.md
    section 5.6.
    """
    if not utilisateur.a_le_role(settings.ROLE_ADMINISTRATEUR):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acces reserve aux administrateurs (role 'administrateur' requis).",
        )
    return utilisateur


def investisseur_requis(
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(utilisateur_courant)],
) -> UtilisateurAuthentifie:
    """
    Dependance FastAPI : verifie que l'utilisateur authentifie possede le
    role realm "investisseur" OU "administrateur" (un administrateur peut
    egalement consulter/modifier son propre parametrage OTP "self-service").

    Utilisee pour /api/utilisateurs/moi/otp.
    """
    if not (
        utilisateur.a_le_role(settings.ROLE_INVESTISSEUR)
        or utilisateur.a_le_role(settings.ROLE_ADMINISTRATEUR)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acces reserve aux utilisateurs authentifies (investisseur ou administrateur).",
        )
    return utilisateur
