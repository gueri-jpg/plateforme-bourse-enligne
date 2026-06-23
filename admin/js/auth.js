// ============================================================================
// Module d'authentification : gestion des tokens (stockage, decodage,
// rafraichissement) et appel a /userinfo et /logout.
//
// Les tokens sont stockes dans sessionStorage (effaces a la fermeture de
// l'onglet/navigateur), conformement a une bonne pratique de securite pour
// les SPA (limite la persistance des secrets sensibles).
// ============================================================================

import {
  KEYCLOAK_TOKEN_ENDPOINT,
  KEYCLOAK_USERINFO_ENDPOINT,
  KEYCLOAK_LOGOUT_ENDPOINT,
  KEYCLOAK_CLIENT_ID,
  POST_LOGOUT_REDIRECT_URI,
  STORAGE_KEYS,
} from "./config.js";

/**
 * Enregistre le resultat d'une reponse /token (access_token, refresh_token,
 * id_token, expires_in) dans sessionStorage.
 */
export function enregistrerTokens(reponseToken) {
  const maintenant = Date.now();
  sessionStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, reponseToken.access_token);
  sessionStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, reponseToken.refresh_token);
  sessionStorage.setItem(STORAGE_KEYS.ID_TOKEN, reponseToken.id_token);
  // expires_in est en secondes -> on calcule un timestamp absolu (ms)
  // avec une marge de securite de 10 secondes pour anticiper le refresh.
  const expirationMs = maintenant + (reponseToken.expires_in - 10) * 1000;
  sessionStorage.setItem(STORAGE_KEYS.EXPIRES_AT, String(expirationMs));
}

/** Supprime tous les tokens stockes (deconnexion locale). */
export function effacerTokens() {
  Object.values(STORAGE_KEYS).forEach((cle) => sessionStorage.removeItem(cle));
}

/** Retourne l'access_token courant (ou null si absent). */
export function obtenirAccessToken() {
  return sessionStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
}

/** Retourne l'id_token courant (utilise pour le logout). */
export function obtenirIdToken() {
  return sessionStorage.getItem(STORAGE_KEYS.ID_TOKEN);
}

/** Indique si l'access_token est present mais expire (selon expires_at stocke). */
function accessTokenExpire() {
  const expirationMs = Number(sessionStorage.getItem(STORAGE_KEYS.EXPIRES_AT) || 0);
  return Date.now() >= expirationMs;
}

/**
 * Decode la partie "payload" d'un JWT (sans verification de signature -
 * la signature est verifiee cote backend ; ici on lit seulement les
 * claims pour affichage UI : roles, nom, email, etc.)
 */
export function decoderJwt(jwt) {
  try {
    const partiePayload = jwt.split(".")[1];
    // Le payload JWT est encode en base64url -> on reconvertit en base64
    // standard avant d'utiliser atob().
    const base64 = partiePayload.replace(/-/g, "+").replace(/_/g, "/");
    const jsonDecode = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(jsonDecode);
  } catch (erreur) {
    console.error("Impossible de decoder le JWT :", erreur);
    return null;
  }
}

/**
 * Echange le refresh_token courant contre un nouveau jeu de tokens via
 * POST /protocol/openid-connect/token (grant_type=refresh_token).
 * Retourne true si le rafraichissement a reussi, false sinon (session a
 * recreer via un nouveau login).
 */
export async function rafraichirToken() {
  const refreshToken = sessionStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
  if (!refreshToken) {
    return false;
  }

  const corps = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: KEYCLOAK_CLIENT_ID,
    refresh_token: refreshToken,
  });

  try {
    const reponse = await fetch(KEYCLOAK_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: corps,
    });

    if (!reponse.ok) {
      // Refresh token invalide/expire (ex: SSO Session Idle depasse,
      // cf. docs/architecture.md section 2.1) -> nouvelle authentification requise
      return false;
    }

    const donnees = await reponse.json();
    enregistrerTokens(donnees);
    return true;
  } catch (erreur) {
    console.error("Erreur lors du rafraichissement du token :", erreur);
    return false;
  }
}

/**
 * Garantit qu'un access_token valide est disponible : si l'access_token
 * stocke est expire, tente un rafraichissement via le refresh_token.
 * Retourne l'access_token valide, ou null si aucune session valide
 * n'est disponible (l'appelant doit alors rediriger vers la page de login).
 */
export async function obtenirAccessTokenValide() {
  if (!obtenirAccessToken()) {
    return null;
  }

  if (accessTokenExpire()) {
    const succes = await rafraichirToken();
    if (!succes) {
      effacerTokens();
      return null;
    }
  }

  return obtenirAccessToken();
}

/**
 * Recupere les informations utilisateur via l'endpoint /userinfo de
 * Keycloak (cf. docs/architecture.md section 2.2).
 */
export async function recupererUserInfo(accessToken) {
  const reponse = await fetch(KEYCLOAK_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!reponse.ok) {
    throw new Error(`Echec de l'appel /userinfo : ${reponse.status}`);
  }
  return reponse.json();
}

/**
 * Deconnecte l'utilisateur : efface les tokens locaux puis redirige vers
 * l'endpoint /logout de Keycloak avec id_token_hint (logout SSO complet),
 * cf. docs/architecture.md section 2.1/2.2.
 */
export function seDeconnecter() {
  const idToken = obtenirIdToken();
  effacerTokens();

  const parametres = new URLSearchParams({
    client_id: KEYCLOAK_CLIENT_ID,
    post_logout_redirect_uri: POST_LOGOUT_REDIRECT_URI,
  });
  if (idToken) {
    parametres.set("id_token_hint", idToken);
  }

  window.location.href = `${KEYCLOAK_LOGOUT_ENDPOINT}?${parametres.toString()}`;
}
