 // ============================================================================
// Configuration globale du frontend
//
// Centralise les constantes utilisees par les differentes pages
// (login, callback, dashboard) : URLs Keycloak, identifiant du client
// public "frontend-spa", URL du backend Module Admin.
//
// Conforme a docs/architecture.md section 2.1/2.2 (realm "bourse-en-ligne",
// client "frontend-spa", flow Authorization Code + PKCE).
// ============================================================================

// Détection automatique local vs production K8s/Azure
const _isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);

// En production : bourse.cfconsultancy.org → baseDomain = cfconsultancy.org
// Les services sont sur des sous-domaines de 1er niveau : auth.cfconsultancy.org, api.cfconsultancy.org
const _parts = window.location.hostname.split('.');
const _baseDomain = _parts.length > 2 ? _parts.slice(1).join('.') : window.location.hostname;
const _proto = window.location.protocol;

export const KEYCLOAK_BASE_URL = _isLocal
  ? "http://localhost:9090"
  : `${_proto}//auth.${_baseDomain}`;

export const KEYCLOAK_REALM = "bourse-en-ligne";
export const KEYCLOAK_CLIENT_ID = "frontend-spa";

export const KEYCLOAK_REALM_URL = `${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}`;

export const KEYCLOAK_AUTH_ENDPOINT = `${KEYCLOAK_REALM_URL}/protocol/openid-connect/auth`;
export const KEYCLOAK_TOKEN_ENDPOINT = `${KEYCLOAK_REALM_URL}/protocol/openid-connect/token`;
export const KEYCLOAK_USERINFO_ENDPOINT = `${KEYCLOAK_REALM_URL}/protocol/openid-connect/userinfo`;
export const KEYCLOAK_LOGOUT_ENDPOINT = `${KEYCLOAK_REALM_URL}/protocol/openid-connect/logout`;

export const FRONTEND_BASE_URL = window.location.origin;

export const REDIRECT_URI = `${FRONTEND_BASE_URL}/callback.html`;

export const POST_LOGOUT_REDIRECT_URI = `${FRONTEND_BASE_URL}/index.html`;

// Local → localhost:8000 | K8s → api.cfconsultancy.org
export const BACKEND_API_BASE_URL = _isLocal
  ? "http://localhost:8000"
  : `${_proto}//api.${_baseDomain}`;

// Local → banquedigitale.127.0.0.1.nip.io | K8s → banquedigitale.cfconsultancy.org
export const BANQUE_FRONTEND_URL = _isLocal
  ? "http://banquedigitale.127.0.0.1.nip.io"
  : `${_proto}//banquedigitale.${_baseDomain}`;

// Cles utilisees pour stocker les donnees dans sessionStorage
export const STORAGE_KEYS = {
  ACCESS_TOKEN: "bourse_access_token",
  REFRESH_TOKEN: "bourse_refresh_token",
  ID_TOKEN: "bourse_id_token",
  EXPIRES_AT: "bourse_expires_at", // timestamp (ms) d'expiration de l'access_token
  CODE_VERIFIER: "bourse_pkce_code_verifier", // utilise uniquement entre login et callback
};
