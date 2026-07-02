// ============================================================================
// api/client.ts — Client Axios avec injection Bearer auto + intercepteur 401
//
// Fonctionnement :
//  - Chaque requête injecte automatiquement le Bearer token depuis SecureStore
//  - Si le backend retourne 401 (token expiré) :
//    1. On tente de rafraîchir via le refresh_token Keycloak
//    2. Si succès → on relance la requête originale avec le nouveau token
//    3. Si échec → déconnexion locale propre
//  - Verrou isRefreshing + file failedQueue pour éviter les refreshes parallèles
// ============================================================================

import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { storage, KEYS } from '../utils/storage';
import { CONFIG } from '../../constants/config';

// URL de base du backend FastAPI bourse
const BASE_URL = CONFIG.API_BASE_URL;

// ── Instance Axios ────────────────────────────────────────────────────────────
export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Intercepteur de requête : injection du Bearer token ───────────────────────
apiClient.interceptors.request.use(async (config) => {
  const token = await storage.get(KEYS.accessToken);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Gestion du refresh parallèle ─────────────────────────────────────────────
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject:  (err: unknown)  => void;
}> = [];

function flushQueue(error: unknown, token: string | null) {
  failedQueue.forEach(({ resolve, reject }) =>
    error ? reject(error) : resolve(token!)
  );
  failedQueue = [];
}

// Callback de déconnexion — enregistré par le store auth pour éviter
// l'import circulaire (auth store importe apiClient qui n'importe pas le store)
let _onLogout: (() => Promise<void>) | null = null;
export function setLogoutCallback(fn: () => Promise<void>) {
  _onLogout = fn;
}

// ── Intercepteur de réponse : refresh automatique sur 401 ────────────────────
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original: InternalAxiosRequestConfig & { _retry?: boolean } = error.config;

    // Ne retenter que les 401 non déjà retentés (évite la boucle infinie)
    if (error.response?.status !== 401 || original?._retry) {
      return Promise.reject(error);
    }

    // Si un refresh est déjà en cours : mettre la requête en file d'attente
    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      })
        .then((token) => {
          original.headers.Authorization = `Bearer ${token}`;
          return apiClient(original);
        })
        .catch((e) => Promise.reject(e));
    }

    original._retry = true;
    isRefreshing    = true;

    const storedRefresh = await storage.get(KEYS.refreshToken);
    if (!storedRefresh) {
      flushQueue(error, null);
      isRefreshing = false;
      if (_onLogout) await _onLogout();
      return Promise.reject(error);
    }

    try {
      // Import dynamique pour éviter la dépendance circulaire
      const { refreshTokens } = await import('./auth');
      const tokens = await refreshTokens(storedRefresh);

      // Mettre à jour les tokens en stockage
      await storage.set(KEYS.accessToken, tokens.access_token);
      if (tokens.id_token)      await storage.set(KEYS.idToken,      tokens.id_token);
      if (tokens.refresh_token) await storage.set(KEYS.refreshToken, tokens.refresh_token);

      // Mettre à jour l'en-tête par défaut pour les prochaines requêtes
      apiClient.defaults.headers.common.Authorization = `Bearer ${tokens.access_token}`;
      original.headers.Authorization = `Bearer ${tokens.access_token}`;

      flushQueue(null, tokens.access_token);
      return apiClient(original);
    } catch (refreshError) {
      flushQueue(refreshError, null);
      // Nettoyer les tokens invalides
      await storage.del(KEYS.accessToken);
      await storage.del(KEYS.idToken);
      await storage.del(KEYS.refreshToken);
      if (_onLogout) await _onLogout();
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

export function getApiBaseUrl(): string {
  return BASE_URL;
}
