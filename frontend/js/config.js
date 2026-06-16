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

export const KEYCLOAK_BASE_URL = "http://localhost:8080";
export const KEYCLOAK_REALM = "bourse-en-ligne";
export const KEYCLOAK_CLIENT_ID = "frontend-spa";

// URL de base du realm Keycloak (prefixe commun a tous les endpoints OIDC)
export const KEYCLOAK_REALM_URL = `${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}`;

// Endpoints OIDC utilises par le frontend (cf. docs/architecture.md section 2.2)
export const KEYCLOAK_AUTH_ENDPOINT = `${KEYCLOAK_REALM_URL}/protocol/openid-connect/auth`;
export const KEYCLOAK_TOKEN_ENDPOINT = `${KEYCLOAK_REALM_URL}/protocol/openid-connect/token`;
export const KEYCLOAK_USERINFO_ENDPOINT = `${KEYCLOAK_REALM_URL}/protocol/openid-connect/userinfo`;
export const KEYCLOAK_LOGOUT_ENDPOINT = `${KEYCLOAK_REALM_URL}/protocol/openid-connect/logout`;

// URL de base du frontend lui-meme (utilisee comme redirect_uri).
// On se base sur l'origine courante pour rester valable que l'on serve
// le site sur http://localhost:3000 (Nginx) ou http://localhost:5173 (dev).
export const FRONTEND_BASE_URL = window.location.origin;

// URL de redirection apres authentification Keycloak (doit correspondre
// a une valeur autorisee dans "redirectUris" du client frontend-spa,
// cf. keycloak/realm-export.json)
export const REDIRECT_URI = `${FRONTEND_BASE_URL}/callback.html`;

// URL de redirection post-logout (doit correspondre a
// "post.logout.redirect.uris" du client frontend-spa)
export const POST_LOGOUT_REDIRECT_URI = `${FRONTEND_BASE_URL}/index.html`;

// URL de base du backend "Module Admin" (FastAPI, port 8000)
export const BACKEND_API_BASE_URL = "http://localhost:8000";

// Cles utilisees pour stocker les donnees dans sessionStorage
export const STORAGE_KEYS = {
  ACCESS_TOKEN: "bourse_access_token",
  REFRESH_TOKEN: "bourse_refresh_token",
  ID_TOKEN: "bourse_id_token",
  EXPIRES_AT: "bourse_expires_at", // timestamp (ms) d'expiration de l'access_token
  CODE_VERIFIER: "bourse_pkce_code_verifier", // utilise uniquement entre login et callback
};
