"""
Client pour l'Admin REST API de Keycloak, utilise par le "Module Admin"
pour synchroniser certains parametres PostgreSQL (schema "administration")
vers la configuration du realm "bourse-en-ligne" (cf. docs/architecture.md
section 2.4 et 5.6).

Authentification : ce client utilise le grant OAuth2 "client_credentials"
avec le client confidentiel "admin-tools" (service account), qui doit
disposer des roles realm-management suivants sur le realm "bourse-en-ligne" :
  - manage-users   : modification des utilisateurs (Required Actions OTP)
  - view-users     : lecture des utilisateurs
  - query-users    : recherche d'utilisateurs
  - manage-realm   : modification des parametres du realm (bruteForceProtected,
                      failureFactor, ssoSessionIdleTimeout) - US-30, US-31

NB : le role "manage-realm" n'est pas mentionne explicitement dans le
contexte fourni pour le client "admin-tools" ; il est NECESSAIRE pour les
appels `PUT /admin/realms/{realm}` realises ci-dessous (US-30/US-31). Voir
le README.md (section "Etapes manuelles") pour l'ajout de ce role via la
console d'administration Keycloak si l'appel echoue avec 403.
"""

import requests
from fastapi import HTTPException, status

from app.config import settings


class KeycloakAdminClient:
    """
    Encapsule les appels a l'Admin REST API de Keycloak necessaires au
    Module Admin : obtention d'un token via client_credentials, mise a jour
    des parametres du realm, et gestion des Required Actions par utilisateur.
    """

    def __init__(self):
        self._access_token: str | None = None

    # ------------------------------------------------------------------
    # Authentification du service account "admin-tools"
    # ------------------------------------------------------------------
    def _obtenir_token_service_account(self) -> str:
        """
        Recupere un access_token pour le service account "admin-tools" via
        le grant "client_credentials" (cf. docs/architecture.md section 2.3).

        Un nouveau token est demande a chaque appel : pour un module admin
        a faible frequence d'utilisation, cela evite la complexite de gerer
        l'expiration d'un token mis en cache (access_token Keycloak valide
        par defaut 300s, cf. realm-export.json "accessTokenLifespan").
        """
        reponse = requests.post(
            settings.keycloak_token_url,
            data={
                "grant_type": "client_credentials",
                "client_id": settings.KEYCLOAK_ADMIN_CLIENT_ID,
                "client_secret": settings.KEYCLOAK_ADMIN_CLIENT_SECRET,
            },
            timeout=10,
        )
        if reponse.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "Impossible d'obtenir un token de service account Keycloak "
                    f"(client '{settings.KEYCLOAK_ADMIN_CLIENT_ID}') : "
                    f"{reponse.status_code} {reponse.text}"
                ),
            )
        return reponse.json()["access_token"]

    def _en_tetes_autorises(self) -> dict:
        """Construit les en-tetes HTTP avec le token du service account."""
        token = self._obtenir_token_service_account()
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    # ------------------------------------------------------------------
    # US-30 / US-31 : synchronisation des seuils de securite du realm
    # ------------------------------------------------------------------
    def synchroniser_parametres_securite(
        self,
        max_tentatives_echouees: int,
        duree_expiration_session_minutes: int,
    ) -> None:
        """
        Met a jour la politique "Brute Force Detection" et la duree
        d'expiration de session par inactivite ("SSO Session Idle") du
        realm "bourse-en-ligne", via PUT /admin/realms/{realm}.

        Correspondance (cf. docs/architecture.md section 2.4) :
          - max_tentatives_echouees       -> bruteForceProtected=true, failureFactor
          - duree_expiration_session_minutes -> ssoSessionIdleTimeout (en secondes)
        """
        payload = {
            "bruteForceProtected": True,
            "failureFactor": max_tentatives_echouees,
            "ssoSessionIdleTimeout": duree_expiration_session_minutes * 60,
        }

        reponse = requests.put(
            settings.keycloak_admin_realm_url,
            json=payload,
            headers=self._en_tetes_autorises(),
            timeout=10,
        )

        if reponse.status_code not in (200, 204):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "Echec de la synchronisation des parametres de securite vers Keycloak "
                    f"(PUT {settings.keycloak_admin_realm_url}) : "
                    f"{reponse.status_code} {reponse.text}"
                ),
            )

    # ------------------------------------------------------------------
    # US-24 / US-32 / US-33 : gestion de la Required Action CONFIGURE_TOTP
    # ------------------------------------------------------------------
    def _recuperer_utilisateur(self, keycloak_user_id: str) -> dict:
        """
        Recupere la representation JSON d'un utilisateur Keycloak via
        GET /admin/realms/{realm}/users/{id}.
        """
        url = f"{settings.keycloak_admin_realm_url}/users/{keycloak_user_id}"
        reponse = requests.get(url, headers=self._en_tetes_autorises(), timeout=10)

        if reponse.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    f"Impossible de recuperer l'utilisateur Keycloak '{keycloak_user_id}' : "
                    f"{reponse.status_code} {reponse.text}"
                ),
            )
        return reponse.json()

    def definir_otp_utilisateur(self, keycloak_user_id: str, otp_active: bool) -> None:
        """
        Active ou desactive l'authentification OTP (TOTP) pour un
        utilisateur Keycloak donne, en ajoutant/retirant la Required Action
        "CONFIGURE_TOTP" sur son compte (cf. docs/architecture.md sections
        2.7.1 et 5.6).

        - otp_active = True  : ajoute "CONFIGURE_TOTP" aux requiredActions
          (l'utilisateur devra configurer/saisir l'OTP a sa prochaine connexion).
        - otp_active = False : retire "CONFIGURE_TOTP" des requiredActions.

        NB : ceci pilote la *demande* de configuration OTP. La suppression
        definitive d'une credential OTP deja configuree releve de
        DELETE /admin/realms/{realm}/users/{id}/credentials/{credentialId},
        hors perimetre minimal de cette implementation (l'utilisateur peut
        retirer sa credential via la console "Account Management" Keycloak).
        """
        utilisateur = self._recuperer_utilisateur(keycloak_user_id)
        required_actions: list[str] = list(utilisateur.get("requiredActions", []))

        if otp_active:
            if "CONFIGURE_TOTP" not in required_actions:
                required_actions.append("CONFIGURE_TOTP")
        else:
            required_actions = [a for a in required_actions if a != "CONFIGURE_TOTP"]

        url = f"{settings.keycloak_admin_realm_url}/users/{keycloak_user_id}"
        reponse = requests.put(
            url,
            json={"requiredActions": required_actions},
            headers=self._en_tetes_autorises(),
            timeout=10,
        )

        if reponse.status_code not in (200, 204):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    f"Echec de la mise a jour des Required Actions OTP pour l'utilisateur "
                    f"'{keycloak_user_id}' : {reponse.status_code} {reponse.text}"
                ),
            )


# Instance unique reutilisee par les routers
keycloak_admin_client = KeycloakAdminClient()
