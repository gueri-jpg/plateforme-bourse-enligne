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

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ------------------------------------------------------------------
    # PostgreSQL - base "bourse_db" (cf. docker-compose.yml / db/init.sql)
    # ------------------------------------------------------------------
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "bourse_db"
    POSTGRES_USER: str = "bourse_admin"
    POSTGRES_PASSWORD: str = "bourse_admin_password"

    # ------------------------------------------------------------------
    # Keycloak - realm "bourse-en-ligne" (investisseurs + support)
    # ------------------------------------------------------------------
    KEYCLOAK_BASE_URL: str = "http://localhost:9090"
    KEYCLOAK_REALM: str = "bourse-en-ligne"

    # URL externe Keycloak telle qu'elle apparaît dans le claim "iss" des JWT.
    # En Docker, KEYCLOAK_BASE_URL est l'URL interne (keycloak:8080) pour le JWKS,
    # mais les tokens sont émis avec l'URL publique (KC_HOSTNAME = localhost:9090).
    # Laisser vide pour utiliser KEYCLOAK_BASE_URL (environnements sans Docker).
    KEYCLOAK_ISSUER_BASE_URL: str = ""

    # ------------------------------------------------------------------
    # Keycloak - realm "bourse-admin" (administrateurs uniquement)
    # Realm separe pour isoler les comptes admin des comptes investisseurs.
    # ------------------------------------------------------------------
    KEYCLOAK_ADMIN_REALM: str = "bourse-admin"

    # URL de base de l'API banque CFC (appels server-to-server depuis le backend bourse)
    BANQUE_API_URL: str = "http://localhost:8000"
    # URL du frontend banque accessible depuis le navigateur de l'investisseur
    BANQUE_FRONTEND_URL: str = "http://cfc.127.0.0.1.nip.io"

    # Token partagé pour les appels inter-service banque ↔ bourse (sans auth utilisateur)
    INTER_SERVICE_TOKEN: str = "bourse-banque-inter-service-token-poc"

    # Resend — envoi d'emails transactionnels (OTP SCA, notifications)
    RESEND_API_KEY: str = ""
    EMAIL_FROM: str = "noreply@cfassistance.org"
    # Plan gratuit Resend : forcer la destination vers l'email vérifié (laisser vide en prod)
    RESEND_OVERRIDE_TO: str = ""

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

    # Twelve Data — cotations marchés mondiaux (indices, forex, crypto, matières premières)
    TWELVE_DATA_API_KEY: str = ""
    TWELVE_DATA_REFRESH_SEC: int = 60

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
    def _issuer_base(self) -> str:
        """URL de base pour la validation de l'issuer (peut différer de KEYCLOAK_BASE_URL en Docker)."""
        return self.KEYCLOAK_ISSUER_BASE_URL or self.KEYCLOAK_BASE_URL

    @property
    def keycloak_issuer(self) -> str:
        """Issuer du realm investisseurs (bourse-en-ligne), tel qu'il apparaît dans le token."""
        return f"{self._issuer_base}/realms/{self.KEYCLOAK_REALM}"

    @property
    def keycloak_admin_realm_jwks_url(self) -> str:
        """URL JWKS du realm administrateurs (bourse-admin)."""
        return f"{self.KEYCLOAK_BASE_URL}/realms/{self.KEYCLOAK_ADMIN_REALM}/protocol/openid-connect/certs"

    @property
    def keycloak_admin_issuer(self) -> str:
        """Issuer du realm administrateurs (bourse-admin), tel qu'il apparaît dans le token."""
        return f"{self._issuer_base}/realms/{self.KEYCLOAK_ADMIN_REALM}"


# Instance unique de configuration, importee par les autres modules
settings = Settings()
