// ============================================================================
// config.ts — URLs et constantes de configuration
//
// Deux modes :
//  - Dev local  : EXPO_PUBLIC_BACKEND_IP + ports (via mobile/.env)
//  - Production : EXPO_PUBLIC_API_URL + EXPO_PUBLIC_KEYCLOAK_URL (via eas.json)
// ============================================================================

// Production (eas.json preview/production) → URL complètes https://
// Dev local (.env) → IP + ports
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL
  ?? `http://${process.env.EXPO_PUBLIC_BACKEND_IP ?? '172.20.10.5'}:${process.env.EXPO_PUBLIC_BACKEND_PORT ?? '8000'}`;

const KC_BASE_URL = process.env.EXPO_PUBLIC_KEYCLOAK_URL
  ?? `http://${process.env.EXPO_PUBLIC_BACKEND_IP ?? '172.20.10.5'}:${process.env.EXPO_PUBLIC_KEYCLOAK_PORT ?? '9090'}`;

// WebSocket : wss:// en production, ws:// en dev
const WS_BASE_URL = API_BASE_URL.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');

export const CONFIG = {
  API_BASE_URL,
  WS_MARKET_URL: `${WS_BASE_URL}/ws/market`,

  KEYCLOAK_BASE_URL:  KC_BASE_URL,
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
