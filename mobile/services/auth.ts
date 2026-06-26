// ============================================================================
// auth.ts — Authentification Keycloak via OAuth2 PKCE
// Tokens stockés dans expo-secure-store (chiffré, jamais en clair)
// ============================================================================

import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CONFIG, KEYCLOAK_DISCOVERY, SECURE_KEYS } from '../constants/config';

// ── Stockage (AsyncStorage pour Expo Go — SecureStore en production build) ───
// NOTE : AsyncStorage n'est pas chiffré. À remplacer par expo-secure-store
// dans un development build ou une version production.

export async function saveTokens(tokens: {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_in: number;
}) {
  const expiresAt = Date.now() + (tokens.expires_in - 10) * 1000;
  await Promise.all([
    AsyncStorage.setItem(SECURE_KEYS.ACCESS_TOKEN,  tokens.access_token),
    AsyncStorage.setItem(SECURE_KEYS.REFRESH_TOKEN, tokens.refresh_token),
    AsyncStorage.setItem(SECURE_KEYS.ID_TOKEN,      tokens.id_token),
    AsyncStorage.setItem(SECURE_KEYS.EXPIRES_AT,    String(expiresAt)),
  ]);
}

export async function clearTokens() {
  await AsyncStorage.multiRemove(Object.values(SECURE_KEYS));
}

export async function getAccessToken(): Promise<string | null> {
  return AsyncStorage.getItem(SECURE_KEYS.ACCESS_TOKEN);
}

export async function getRefreshToken(): Promise<string | null> {
  return AsyncStorage.getItem(SECURE_KEYS.REFRESH_TOKEN);
}

// ── Décodage JWT (sans vérification de signature — affichage UI seulement) ──

export function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

// ── Refresh token ─────────────────────────────────────────────────────────────

export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;

  try {
    const resp = await fetch(KEYCLOAK_DISCOVERY.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     CONFIG.KEYCLOAK_CLIENT_ID,
        refresh_token: refreshToken,
      }).toString(),
    });
    if (!resp.ok) { await clearTokens(); return null; }
    const data = await resp.json();
    await saveTokens(data);
    return data.access_token;
  } catch {
    return null;
  }
}

// ── Token valide (auto-refresh si expiré) ────────────────────────────────────

export async function getValidAccessToken(): Promise<string | null> {
  const token     = await getAccessToken();
  if (!token) return null;

  const expiresAt = Number(await AsyncStorage.getItem(SECURE_KEYS.EXPIRES_AT) ?? 0);
  if (Date.now() >= expiresAt) return refreshAccessToken();

  return token;
}

// ── Logout ───────────────────────────────────────────────────────────────────

export async function logout() {
  const idToken = await AsyncStorage.getItem(SECURE_KEYS.ID_TOKEN);
  await clearTokens();
  if (idToken) {
    const logoutUrl =
      `${KEYCLOAK_DISCOVERY.revocationEndpoint}?` +
      `client_id=${CONFIG.KEYCLOAK_CLIENT_ID}` +
      `&id_token_hint=${idToken}`;
    await WebBrowser.openBrowserAsync(logoutUrl);
  }
}