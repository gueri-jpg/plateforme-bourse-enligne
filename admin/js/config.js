// ============================================================================
// Configuration du back-office admin
// Realm dédié : "bourse-admin" — séparé de "bourse-en-ligne"
// ============================================================================

export const KEYCLOAK_BASE_URL  = "http://localhost:9090";
export const KEYCLOAK_REALM     = "bourse-admin";
export const KEYCLOAK_CLIENT_ID = "admin-spa";

export const KEYCLOAK_REALM_URL      = `${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}`;
export const KEYCLOAK_AUTH_ENDPOINT  = `${KEYCLOAK_REALM_URL}/protocol/openid-connect/auth`;
export const KEYCLOAK_TOKEN_ENDPOINT = `${KEYCLOAK_REALM_URL}/protocol/openid-connect/token`;
export const KEYCLOAK_USERINFO_ENDPOINT = `${KEYCLOAK_REALM_URL}/protocol/openid-connect/userinfo`;
export const KEYCLOAK_LOGOUT_ENDPOINT   = `${KEYCLOAK_REALM_URL}/protocol/openid-connect/logout`;

export const FRONTEND_BASE_URL       = window.location.origin;
export const REDIRECT_URI            = `${FRONTEND_BASE_URL}/callback.html`;
export const POST_LOGOUT_REDIRECT_URI = `${FRONTEND_BASE_URL}/index.html`;

export const BACKEND_API_BASE_URL = "http://localhost:8000";

export const STORAGE_KEYS = {
  ACCESS_TOKEN:  "admin_access_token",
  REFRESH_TOKEN: "admin_refresh_token",
  ID_TOKEN:      "admin_id_token",
  EXPIRES_AT:    "admin_expires_at",
  CODE_VERIFIER: "admin_pkce_code_verifier",
};
