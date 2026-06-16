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
# Client JWKS : recupere et met en cache les cles publiques du realm
# Keycloak (endpoint /protocol/openid-connect/certs). PyJWKClient gere
# automatiquement le rafraichissement du cache si une cle inconnue (kid)
# est rencontree (ex: rotation de cles cote Keycloak).
# ----------------------------------------------------------------------
_jwks_client = PyJWKClient(settings.keycloak_jwks_url)


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
    Decode et valide un token JWT Keycloak :
      - verifie la signature RS256 a l'aide de la cle publique JWKS
        correspondant au "kid" present dans l'en-tete du token,
      - verifie l'issuer ("iss") : doit correspondre au realm configure,
      - verifie l'expiration ("exp").

    Leve une HTTPException 401 si le token est invalide, expire, ou si
    la signature ne peut etre verifiee.
    """
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=settings.keycloak_issuer,
            # Le claim "aud" n'est pas toujours peuple par defaut par Keycloak
            # pour les access tokens (depend des "client scopes" du realm) ;
            # on desactive donc sa verification stricte ici et on se repose
            # sur la verification de l'issuer + des roles realm pour
            # l'autorisation. Si un "audience mapper" est configure sur le
            # client "backend-api", la verification peut etre durcie en
            # passant audience=settings.KEYCLOAK_BACKEND_CLIENT_ID.
            options={"verify_aud": False},
        )
        return claims
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Le token a expire, veuillez vous reconnecter ou rafraichir votre session.",
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
