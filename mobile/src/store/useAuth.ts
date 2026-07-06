// ============================================================================
// store/useAuth.ts — Store Zustand pour l'authentification
//
// États possibles :
//  - 'unknown'         : au démarrage, avant hydratation depuis SecureStore
//  - 'unauthenticated' : pas de token valide (ou logout)
//  - 'authenticated'   : tokens valides, user chargé
//
// L'hydration au démarrage tente un refresh si le token est expiré.
// ============================================================================

import { create } from 'zustand';
import { storage, KEYS } from '../utils/storage';
import {
  refreshTokens,
  revokeSession,
  extractUserFromToken,
  isTokenExpired,
  KeycloakTokens,
} from '../api/auth';
import { setLogoutCallback } from '../api/client';
import { setUserId } from '../../services/trading';
import { ensureCompte } from '../api/portfolio';

// ── Type utilisateur extrait du token JWT ─────────────────────────────────────
export interface AuthUser {
  sub:               string;
  name:              string;
  email:             string;
  roles:             string[];
  preferredUsername: string;
  rawClaims:         Record<string, unknown>;
}

export type AuthStatus = 'unknown' | 'unauthenticated' | 'authenticated';

// ── Interface du store ────────────────────────────────────────────────────────
interface AuthState {
  status:       AuthStatus;
  accessToken:  string | null;
  refreshToken: string | null;
  idToken:      string | null;
  user:         AuthUser | null;
  isNewUser:    boolean;   // true après inscription → affiche l'onboarding

  // Hydrate l'état depuis SecureStore au démarrage de l'app
  hydrate:            () => Promise<void>;
  // Persiste les tokens reçus après échange PKCE
  setTokens:          (tokens: KeycloakTokens, isNew?: boolean) => Promise<void>;
  // Tente un refresh manuel (utilisé par l'intercepteur 401)
  tryRefresh:         () => Promise<boolean>;
  // Déconnexion : vide les tokens du store et de SecureStore
  logout:             () => Promise<void>;
  // Marque l'onboarding comme terminé → RootNavigator bascule vers MainTabs
  completeOnboarding: () => void;
}

// ── Création du store ─────────────────────────────────────────────────────────
export const useAuth = create<AuthState>((set, get) => ({
  status:       'unknown',
  accessToken:  null,
  refreshToken: null,
  idToken:      null,
  user:         null,
  isNewUser:    false,

  // ── Hydratation au démarrage ─────────────────────────────────────────────
  hydrate: async () => {
    try {
      const [access, id, refresh] = await Promise.all([
        storage.get(KEYS.accessToken),
        storage.get(KEYS.idToken),
        storage.get(KEYS.refreshToken),
      ]);

      // Aucun token : non authentifié
      if (!access) {
        set({ status: 'unauthenticated', accessToken: null, idToken: null, refreshToken: null });
        return;
      }

      // Token présent mais expiré : tenter le refresh
      if (isTokenExpired(access)) {
        if (!refresh) {
          set({ status: 'unauthenticated', accessToken: null, idToken: null, refreshToken: null });
          return;
        }
        set({ accessToken: access, idToken: id, refreshToken: refresh });
        const ok = await get().tryRefresh();
        if (!ok) {
          await get().logout();
        }
        return;
      }

      // Token valide : extraire le profil utilisateur
      const user = extractUserFromToken(access);
      if (user?.sub) setUserId(user.sub);

      set({
        status:       'authenticated',
        accessToken:  access,
        idToken:      id,
        refreshToken: refresh,
        user,
      });
    } catch (e) {
      console.warn('[auth] hydrate échoué :', e);
      set({ status: 'unauthenticated' });
    }
  },

  // ── Persistance des tokens après login / inscription ────────────────────
  setTokens: async (tokens, isNew = false) => {
    await storage.set(KEYS.accessToken, tokens.access_token);
    if (tokens.id_token)      await storage.set(KEYS.idToken,      tokens.id_token);
    if (tokens.refresh_token) await storage.set(KEYS.refreshToken, tokens.refresh_token);

    const user = extractUserFromToken(tokens.access_token);
    if (user?.sub) setUserId(user.sub);

    // Provision du compte titres (idempotent, silencieux si déjà existant)
    void ensureCompte().catch(() => {});

    set({
      status:       'authenticated',
      isNewUser:    isNew,
      accessToken:  tokens.access_token,
      idToken:      tokens.id_token      ?? null,
      refreshToken: tokens.refresh_token ?? null,
      user,
    });
  },

  // ── Refresh token manuel ─────────────────────────────────────────────────
  tryRefresh: async () => {
    const rt = get().refreshToken;
    if (!rt) return false;
    try {
      const tokens = await refreshTokens(rt);
      await get().setTokens(tokens);
      return true;
    } catch {
      return false;
    }
  },

  // ── Déconnexion ───────────────────────────────────────────────────────────
  logout: async () => {
    // Invalider la session côté serveur pour forcer la re-saisie des identifiants
    const rt = get().refreshToken;
    if (rt) await revokeSession(rt);

    await Promise.all([
      storage.del(KEYS.accessToken),
      storage.del(KEYS.idToken),
      storage.del(KEYS.refreshToken),
    ]);
    set({
      status:       'unauthenticated',
      accessToken:  null,
      idToken:      null,
      refreshToken: null,
      user:         null,
      isNewUser:    false,
    });
  },

  // ── Fin de l'onboarding → bascule vers MainTabs ───────────────────────────
  completeOnboarding: () => set({ isNewUser: false }),
}));

// Enregistre le callback de logout pour l'intercepteur 401 d'Axios
// (évite l'import circulaire : client.ts → auth.ts → client.ts)
setLogoutCallback(() => useAuth.getState().logout());
