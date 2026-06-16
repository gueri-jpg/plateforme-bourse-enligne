// ============================================================================
// Page de login : initie le flow OAuth2/OIDC Authorization Code + PKCE.
//
// Etapes :
//  1. Generer un "code_verifier" (secret local) et son "code_challenge"
//     derive (SHA-256, encode base64url) - cf. js/pkce.js.
//  2. Stocker le "code_verifier" en sessionStorage (sera relu par
//     callback.html lors de l'echange du code contre les tokens).
//  3. Rediriger le navigateur vers l'endpoint /auth de Keycloak avec
//     les parametres requis (client_id, response_type=code,
//     redirect_uri, code_challenge, code_challenge_method=S256, state).
// ============================================================================

import {
  KEYCLOAK_AUTH_ENDPOINT,
  KEYCLOAK_CLIENT_ID,
  REDIRECT_URI,
  STORAGE_KEYS,
} from "./config.js";
import { genererCodeVerifier, genererCodeChallenge, genererEtatAleatoire } from "./pkce.js";

const boutonLogin = document.getElementById("bouton-login");
const messageErreur = document.getElementById("message-erreur");

// Si Keycloak nous renvoie une erreur sur la page d'accueil (ex: l'utilisateur
// a annule le login depuis la page de callback), on l'affiche.
const parametresUrl = new URLSearchParams(window.location.search);
if (parametresUrl.has("erreur")) {
  afficherErreur(parametresUrl.get("erreur"));
}

boutonLogin.addEventListener("click", demarrerLoginKeycloak);

/**
 * Construit l'URL /auth avec les parametres PKCE et redirige le navigateur.
 */
async function demarrerLoginKeycloak() {
  try {
    // 1. Generation PKCE
    const codeVerifier = genererCodeVerifier();
    const codeChallenge = await genererCodeChallenge(codeVerifier);
    const etat = genererEtatAleatoire();

    // 2. Stockage temporaire du code_verifier et du state (PKCE + anti-CSRF),
    // releves par callback.js apres redirection de Keycloak.
    sessionStorage.setItem(STORAGE_KEYS.CODE_VERIFIER, codeVerifier);
    sessionStorage.setItem("bourse_oauth_state", etat);

    // 3. Construction de l'URL d'autorisation Keycloak
    const parametres = new URLSearchParams({
      client_id: KEYCLOAK_CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: "openid profile email",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state: etat,
    });

    window.location.href = `${KEYCLOAK_AUTH_ENDPOINT}?${parametres.toString()}`;
  } catch (erreur) {
    console.error(erreur);
    afficherErreur("Impossible de demarrer la connexion (PKCE). Voir la console.");
  }
}

function afficherErreur(texte) {
  messageErreur.textContent = texte;
  messageErreur.hidden = false;
}
