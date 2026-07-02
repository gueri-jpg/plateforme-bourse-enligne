// ============================================================================
// config.ts — URLs et constantes de configuration
// Les valeurs sont lues depuis .env (variables EXPO_PUBLIC_*)
// Pour changer l'IP : modifier EXPO_PUBLIC_BACKEND_IP dans mobile/.env
// ============================================================================

const BACKEND_IP   = process.env.EXPO_PUBLIC_BACKEND_IP   ?? '172.20.10.5';
const BACKEND_PORT = process.env.EXPO_PUBLIC_BACKEND_PORT  ?? '8000';
const KC_PORT      = process.env.EXPO_PUBLIC_KEYCLOAK_PORT ?? '9090';

export const CONFIG = {
  API_BASE_URL:  `http://${BACKEND_IP}:${BACKEND_PORT}`,
  WS_MARKET_URL: `ws://${BACKEND_IP}:${BACKEND_PORT}/ws/market`,

  KEYCLOAK_BASE_URL:  `http://${BACKEND_IP}:${KC_PORT}`,
  KEYCLOAK_REALM:     process.env.EXPO_PUBLIC_KEYCLOAK_REALM     ?? 'bourse-en-ligne',
  KEYCLOAK_CLIENT_ID: process.env.EXPO_PUBLIC_KEYCLOAK_CLIENT_ID ?? 'mobile-app',

  MARKET_OPEN_HOUR:  Number(process.env.EXPO_PUBLIC_MARKET_OPEN_HOUR)  || 9,
  MARKET_CLOSE_HOUR: Number(process.env.EXPO_PUBLIC_MARKET_CLOSE_HOUR) || 15,
  MARKET_CLOSE_MIN:  Number(process.env.EXPO_PUBLIC_MARKET_CLOSE_MIN)  || 30,
} as const;

export const KEYCLOAK_DISCOVERY = {
  authorizationEndpoint: `${CONFIG.KEYCLOAK_BASE_URL}/realms/${CONFIG.KEYCLOAK_REALM}/protocol/openid-connect/auth`,
  tokenEndpoint:         `${CONFIG.KEYCLOAK_BASE_URL}/realms/${CONFIG.KEYCLOAK_REALM}/protocol/openid-connect/token`,
  revocationEndpoint:    `${CONFIG.KEYCLOAK_BASE_URL}/realms/${CONFIG.KEYCLOAK_REALM}/protocol/openid-connect/logout`,
};

// Clés pour AsyncStorage (préfixées pour éviter les collisions)
export const SECURE_KEYS = {
  ACCESS_TOKEN:  'bourse_access_token',
  REFRESH_TOKEN: 'bourse_refresh_token',
  ID_TOKEN:      'bourse_id_token',
  EXPIRES_AT:    'bourse_expires_at',
  USER_SUB:      'bourse_user_sub',
} as const;
