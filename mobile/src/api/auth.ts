// ============================================================================
// api/auth.ts — Authentification Keycloak PKCE pour BourseOnline
//
// Flow OAuth2 PKCE :
//  1. Générer code_verifier (aléatoire) + code_challenge (SHA256 pur JS)
//  2. Construire l'URL d'autorisation Keycloak avec PKCE params
//  3. Intercepter le redirect vers http://localhost/mobile-callback dans WebView
//  4. Échanger le code contre des tokens via POST au token endpoint
//  5. Stocker les tokens dans SecureStore (avec chunking)
//
// IMPORTANT : on utilise http://localhost/mobile-callback comme redirect URI
// (pas un custom scheme) car iOS intercepte les custom schemes au niveau OS
// AVANT que onShouldStartLoadWithRequest soit appelé → "Can't open URL".
// Avec http://localhost/mobile-callback, WKWebView appelle notre handler en premier.
// ============================================================================

import { CONFIG } from '../../constants/config';

// ── SHA256 pur JS ─────────────────────────────────────────────────────────────
// On n'utilise PAS expo-crypto car digestStringAsync produit un hash incorrect
// sur certains appareils sous Expo Go. SHA256 pur JS garantit la correction.

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256Bytes(bytes: Uint8Array): Uint8Array {
  const msgLen  = bytes.length;
  const bitLen  = msgLen * 8;
  let totalLen  = msgLen + 1 + 8;
  totalLen      = Math.ceil(totalLen / 64) * 64;

  const padded = new Uint8Array(totalLen);
  padded.set(bytes);
  padded[msgLen] = 0x80;

  const view    = new DataView(padded.buffer);
  const lenHigh = Math.floor(bitLen / 0x100000000);
  const lenLow  = bitLen >>> 0;
  view.setUint32(totalLen - 8, lenHigh, false);
  view.setUint32(totalLen - 4, lenLow,  false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19)  ^ (w[i - 2]  >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1   = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch   = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0   = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj  = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const out     = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, i) => outView.setUint32(i * 4, v, false));
  return out;
}

// Convertit une string ASCII en Uint8Array (les verifiers PKCE sont ASCII-safe)
function asciiToBytes(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
  return bytes;
}

// Encode des bytes en base64url (sans padding)
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── PKCE helpers ──────────────────────────────────────────────────────────────

// Remplit un Uint8Array avec des bytes aléatoires.
// Utilise globalThis.crypto (disponible sur Hermes/RN 0.73+, browsers, Node).
// Fallback Math.random si l'API n'est pas disponible (Expo Go ancienne version).
function fillRandom(bytes: Uint8Array): void {
  try {
    const c = (globalThis as any).crypto;
    if (c && typeof c.getRandomValues === 'function') {
      c.getRandomValues(bytes);
      return;
    }
  } catch {}
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = (Math.random() * 256) | 0;
  }
}

// Génère un verifier aléatoire de 96 bytes encodé en base64url (128 chars)
function generateVerifier(): string {
  const bytes = new Uint8Array(96);
  fillRandom(bytes);
  return bytesToBase64Url(bytes);
}

// Dérive le code_challenge S256 depuis le verifier
function deriveChallenge(verifier: string): string {
  return bytesToBase64Url(sha256Bytes(asciiToBytes(verifier)));
}

// Génère un state aléatoire anti-CSRF
function generateState(): string {
  const bytes = new Uint8Array(16);
  fillRandom(bytes);
  return bytesToBase64Url(bytes);
}

// ── URI de redirection ────────────────────────────────────────────────────────
// CRUCIAL : HTTP (pas custom scheme) → intercepté par WebView AVANT la requête réseau
export const REDIRECT_URI = 'http://localhost/mobile-callback';

// ── Constantes Keycloak ───────────────────────────────────────────────────────
const KC_BASE   = CONFIG.KEYCLOAK_BASE_URL.replace(/\/$/, '');
const REALM     = CONFIG.KEYCLOAK_REALM;
const CLIENT_ID = CONFIG.KEYCLOAK_CLIENT_ID;

const TOKEN_ENDPOINT    = `${KC_BASE}/realms/${REALM}/protocol/openid-connect/token`;
const AUTH_ENDPOINT     = `${KC_BASE}/realms/${REALM}/protocol/openid-connect/auth`;
const REGISTER_ENDPOINT = `${KC_BASE}/realms/${REALM}/protocol/openid-connect/registrations`;
const LOGOUT_ENDPOINT   = `${KC_BASE}/realms/${REALM}/protocol/openid-connect/logout`;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KeycloakTokens {
  access_token:  string;
  id_token?:     string;
  refresh_token?: string;
  expires_in:    number;
  token_type:    string;
}

// ── Construction des URLs PKCE ───────────────────────────────────────────────

function buildPkceParams(): { params: URLSearchParams; codeVerifier: string; state: string } {
  const codeVerifier  = generateVerifier();
  const codeChallenge = deriveChallenge(codeVerifier);
  const state         = generateState();
  const params = new URLSearchParams({
    client_id:             CLIENT_ID,
    redirect_uri:          REDIRECT_URI,
    response_type:         'code',
    scope:                 'openid profile email',
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
    state,
  });
  return { params, codeVerifier, state };
}

export function buildPkceAuthUrl(opts?: { loginHint?: string; idpHint?: string }): { url: string; codeVerifier: string; state: string } {
  const { params, codeVerifier, state } = buildPkceParams();
  // offline_access → refresh token longue durée (30 j Keycloak) pour les flux SSO
  // inter-app : après la première liaison, hydrate() renouvelle silencieusement
  // sans jamais redemander d'authentification.
  if (opts?.idpHint) params.set('scope', 'openid profile email offline_access');
  if (opts?.loginHint) params.append('login_hint', opts.loginHint);
  if (opts?.idpHint)   params.append('kc_idp_hint', opts.idpHint);
  return { url: `${AUTH_ENDPOINT}?${params}`, codeVerifier, state };
}

// Keycloak expose un endpoint /registrations identique à /auth mais qui affiche
// directement le formulaire d'inscription (sans passer par la page de login).
export function buildPkceRegisterUrl(): { url: string; codeVerifier: string; state: string } {
  const { params, codeVerifier, state } = buildPkceParams();
  return { url: `${REGISTER_ENDPOINT}?${params}`, codeVerifier, state };
}

// ── Échange code → tokens ─────────────────────────────────────────────────────

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<KeycloakTokens> {
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    client_id:     CLIENT_ID,
    code,
    redirect_uri:  REDIRECT_URI,
    code_verifier: codeVerifier,
  }).toString();

  const r = await fetch(TOKEN_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Échange code→token : HTTP ${r.status} — ${text}`);
  }
  return r.json();
}

// ── Rafraîchissement du token ─────────────────────────────────────────────────

export async function refreshTokens(refreshToken: string): Promise<KeycloakTokens> {
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     CLIENT_ID,
    refresh_token: refreshToken,
  }).toString();

  const r = await fetch(TOKEN_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!r.ok) throw new Error('Refresh token invalide ou expiré');
  return r.json();
}

// ── Décodage JWT (sans vérification de signature — affichage UI uniquement) ──

export function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    const base64  = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

// ── Déconnexion back-channel ─────────────────────────────────────────────────
// POST au token endpoint pour invalider la session côté serveur.
// Sans ça, le WebView garde le cookie de session actif et l'utilisateur
// est reconnecté automatiquement sans saisir ses identifiants.

export async function revokeSession(refreshToken: string): Promise<void> {
  const body = new URLSearchParams({
    client_id:     CLIENT_ID,
    refresh_token: refreshToken,
  }).toString();

  try {
    await fetch(LOGOUT_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    // Best-effort : on continue le logout local même si le serveur est injoignable
  }
}

// ── URL de déconnexion front-channel (non utilisée actuellement) ─────────────

export function buildLogoutUrl(idTokenHint?: string): string {
  const params = new URLSearchParams({
    client_id:                CLIENT_ID,
    post_logout_redirect_uri: REDIRECT_URI,
  });
  if (idTokenHint) params.set('id_token_hint', idTokenHint);
  return `${LOGOUT_ENDPOINT}?${params.toString()}`;
}

// ── Userinfo depuis le token ──────────────────────────────────────────────────

export function extractUserFromToken(accessToken: string) {
  const claims = decodeJwt(accessToken);
  if (!claims) return null;
  return {
    sub:   String(claims.sub   ?? ''),
    name:  String(claims.name  ?? claims.preferred_username ?? ''),
    email: String(claims.email ?? ''),
    roles: ((claims.realm_access as any)?.roles ?? []) as string[],
    preferredUsername: String(claims.preferred_username ?? ''),
    rawClaims: claims,
  };
}

// ── Vérification d'expiration ─────────────────────────────────────────────────

export function isTokenExpired(accessToken: string): boolean {
  const claims = decodeJwt(accessToken);
  if (!claims?.exp) return true;
  // Marge de 30 secondes pour éviter les race conditions
  return Date.now() / 1000 > (claims.exp as number) - 30;
}

// ── Réinitialisation du mot de passe ─────────────────────────────────────────
// Ces appels sont non authentifiés (pas de Bearer token) → on utilise fetch direct.

const API_BASE = CONFIG.API_BASE_URL.replace(/\/$/, '');

export async function forgotPassword(email: string): Promise<{ masked_email: string }> {
  const r = await fetch(`${API_BASE}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.detail ?? 'Erreur lors de la demande de réinitialisation.');
  }
  return r.json();
}

export async function verifyResetCode(email: string, code: string): Promise<{ reset_token: string }> {
  const r = await fetch(`${API_BASE}/auth/verify-reset-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.detail ?? 'Code incorrect ou expiré.');
  }
  return r.json();
}

export async function resetPassword(
  resetToken: string,
  password: string,
  confirmPassword: string,
): Promise<void> {
  const r = await fetch(`${API_BASE}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reset_token: resetToken, password, confirm_password: confirmPassword }),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.detail ?? 'Erreur lors de la réinitialisation du mot de passe.');
  }
}
