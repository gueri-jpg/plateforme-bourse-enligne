// ============================================================================
// config.ts — URLs et constantes de configuration
// Remplacer l'IP par celle de ta machine (obtenue via ipconfig / Wi-Fi)
// ============================================================================

// IP locale de la machine qui fait tourner Docker
// À changer si ton IP change (redémarrage box internet, changement réseau)
const BACKEND_IP = '10.100.11.90';

export const CONFIG = {
  // Backend FastAPI (même que le web)
  API_BASE_URL:  `http://${BACKEND_IP}:8000`,
  WS_MARKET_URL: `ws://${BACKEND_IP}:8000/ws/market`,

  // Keycloak — realm investisseurs
  KEYCLOAK_BASE_URL:  `http://${BACKEND_IP}:9090`,
  KEYCLOAK_REALM:     'bourse-en-ligne',
  KEYCLOAK_CLIENT_ID: 'mobile-app',

  // Marché BVC : lundi–vendredi 09:00–15:30 heure Casablanca (UTC+1)
  MARKET_OPEN_HOUR:   9,
  MARKET_CLOSE_HOUR:  15,
  MARKET_CLOSE_MIN:   30,
} as const;

export const KEYCLOAK_DISCOVERY = {
  authorizationEndpoint: `${CONFIG.KEYCLOAK_BASE_URL}/realms/${CONFIG.KEYCLOAK_REALM}/protocol/openid-connect/auth`,
  tokenEndpoint:         `${CONFIG.KEYCLOAK_BASE_URL}/realms/${CONFIG.KEYCLOAK_REALM}/protocol/openid-connect/token`,
  revocationEndpoint:    `${CONFIG.KEYCLOAK_BASE_URL}/realms/${CONFIG.KEYCLOAK_REALM}/protocol/openid-connect/logout`,
};

// Clés pour expo-secure-store (chiffré sur le device)
export const SECURE_KEYS = {
  ACCESS_TOKEN:  'bourse_access_token',
  REFRESH_TOKEN: 'bourse_refresh_token',
  ID_TOKEN:      'bourse_id_token',
  EXPIRES_AT:    'bourse_expires_at',
  USER_SUB:      'bourse_user_sub',
} as const;