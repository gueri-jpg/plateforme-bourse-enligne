"""
Configuration centralisee du backend "Module Admin".

Toutes les valeurs sont definies via des variables d'environnement (avec
des valeurs par defaut adaptees au docker-compose.yml fourni a la racine
du projet), conformement aux bonnes pratiques "12-factor app".

En local (sans Docker pour le backend), ces valeurs par defaut permettent
de se connecter directement aux services exposes sur l'hote :
  - PostgreSQL  -> localhost:5432 (cf. docker-compose.yml, service "postgres")
  - Keycloak    -> http://localhost:8080 (cf. docker-compose.yml, service "keycloak")
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Parametres de configuration de l'application, charges depuis les
    variables d'environnement (ou un fichier .env place a la racine de
    backend/, voir backend/README.md).
    """

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # ------------------------------------------------------------------
    # PostgreSQL - base "bourse_db" (cf. docker-compose.yml / db/init.sql)
    # ------------------------------------------------------------------
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "bourse_db"
    POSTGRES_USER: str = "bourse_admin"
    POSTGRES_PASSWORD: str = "bourse_admin_password"

    # ------------------------------------------------------------------
    # Keycloak - realm "bourse-en-ligne" (cf. keycloak/realm-export.json)
    # ------------------------------------------------------------------
    # URL de base de Keycloak (sans chemin /realms/...)
    KEYCLOAK_BASE_URL: str = "http://localhost:8080"
    KEYCLOAK_REALM: str = "bourse-en-ligne"

    # Client utilise pour VALIDER les tokens JWT presentes par le frontend
    # (resource server / bearer-only - cf. realm-export.json "backend-api").
    # Le "audience" (claim "aud" ou "azp") attendu dans les tokens valides
    # par ce backend correspond a ce client.
    KEYCLOAK_BACKEND_CLIENT_ID: str = "backend-api"

    # Client "service account" utilise par le backend pour appeler
    # l'Admin REST API de Keycloak (cf. realm-export.json "admin-tools",
    # roles realm-management : manage-users, view-users, query-users,
    # et necessite egalement manage-realm pour PUT /admin/realms/{realm}).
    KEYCLOAK_ADMIN_CLIENT_ID: str = "admin-tools"
    KEYCLOAK_ADMIN_CLIENT_SECRET: str = "admin-tools-secret-a-changer"

    # Role realm requis pour acceder aux endpoints /api/admin/...
    ROLE_ADMINISTRATEUR: str = "administrateur"
    # Roles autorises pour les endpoints "self-service" (/api/utilisateurs/moi/...)
    ROLE_INVESTISSEUR: str = "investisseur"

    # ------------------------------------------------------------------
    # Construction des URLs derivees (OIDC discovery / JWKS / Admin API)
    # ------------------------------------------------------------------
    @property
    def keycloak_realm_url(self) -> str:
        """URL de base du realm OIDC (ex: http://localhost:8080/realms/bourse-en-ligne)."""
        return f"{self.KEYCLOAK_BASE_URL}/realms/{self.KEYCLOAK_REALM}"

    @property
    def keycloak_jwks_url(self) -> str:
        """URL du jeu de cles publiques (JWKS) utilise pour valider la signature des JWT."""
        return f"{self.keycloak_realm_url}/protocol/openid-connect/certs"

    @property
    def keycloak_token_url(self) -> str:
        """URL du endpoint token OIDC (utilise pour le client_credentials grant)."""
        return f"{self.keycloak_realm_url}/protocol/openid-connect/token"

    @property
    def keycloak_admin_realm_url(self) -> str:
        """URL de base de l'Admin REST API pour ce realm."""
        return f"{self.KEYCLOAK_BASE_URL}/admin/realms/{self.KEYCLOAK_REALM}"

    @property
    def keycloak_issuer(self) -> str:
        """
        Issuer ("iss") attendu dans les tokens JWT emis par ce realm.
        Doit correspondre exactement a la valeur KC_HOSTNAME du docker-compose.yml.
        """
        return self.keycloak_realm_url


# Instance unique de configuration, importee par les autres modules
settings = Settings()
