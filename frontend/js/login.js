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
  BACKEND_API_BASE_URL,
} from "./config.js";
import { genererCodeVerifier, genererCodeChallenge, genererEtatAleatoire } from "./pkce.js";
import { enregistrerTokens } from "./auth.js";

const boutonLogin = document.getElementById("bouton-login");
const messageErreur = document.getElementById("message-erreur");

const parametresUrl = new URLSearchParams(window.location.search);
if (parametresUrl.has("erreur")) {
  afficherErreur(parametresUrl.get("erreur"));
}

boutonLogin.addEventListener("click", () => demarrerLoginKeycloak());

// ── SSO web banque → bourse : handoff token → Token Exchange → sessionStorage ─
const ssoToken = parametresUrl.get("sso_token");
if (ssoToken) {
  document.body.style.visibility = "hidden";
  _echangerSsoToken(ssoToken);
}

// ── kc_idp_hint : SSO automatique depuis l'app mobile banque (fallback) ───────
const idpHint = parametresUrl.get("kc_idp_hint");
if (!ssoToken && idpHint) {
  document.body.style.visibility = "hidden";
  demarrerLoginKeycloak(idpHint);
}

async function _echangerSsoToken(token) {
  try {
    const r = await fetch(
      `${BACKEND_API_BASE_URL}/api/sso/web-exchange?token=${encodeURIComponent(token)}`
    );
    if (!r.ok) {
      document.body.style.visibility = "";
      afficherErreur("Session SSO expirée. Veuillez vous connecter manuellement.");
      return;
    }
    const data = await r.json();

    if (data.bourse_tokens?.access_token) {
      enregistrerTokens({
        access_token:  data.bourse_tokens.access_token,
        id_token:      data.bourse_tokens.id_token ?? "",
        refresh_token: data.bourse_tokens.refresh_token ?? "",
        expires_in:    data.bourse_tokens.expires_in ?? 300,
      });
      window.location.replace("/dashboard.html");
      return;
    }

    if (!data.existe) {
      document.body.style.visibility = "";
      afficherErreur(
        "Aucun compte BourseOnline associé à ce compte banque. Créez un compte pour accéder à la plateforme."
      );
      return;
    }

    // Compte existe mais Token Exchange indisponible → PKCE classique
    document.body.style.visibility = "";
    demarrerLoginKeycloak();
  } catch {
    document.body.style.visibility = "";
    afficherErreur("Erreur SSO. Veuillez vous connecter manuellement.");
  }
}

/**
 * Construit l'URL /auth avec les parametres PKCE et redirige le navigateur.
 * @param {string} [hint] - kc_idp_hint optionnel (SSO via IDP externe)
 */
async function demarrerLoginKeycloak(hint) {
  try {
    const codeVerifier = genererCodeVerifier();
    const codeChallenge = await genererCodeChallenge(codeVerifier);
    const etat = genererEtatAleatoire();

    sessionStorage.setItem(STORAGE_KEYS.CODE_VERIFIER, codeVerifier);
    sessionStorage.setItem("bourse_oauth_state", etat);

    const parametres = new URLSearchParams({
      client_id: KEYCLOAK_CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: "openid profile email",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state: etat,
    });

    if (hint) parametres.set("kc_idp_hint", hint);

    window.location.href = `${KEYCLOAK_AUTH_ENDPOINT}?${parametres.toString()}`;
  } catch (erreur) {
    document.body.style.visibility = "";
    console.error(erreur);
    afficherErreur("Impossible de demarrer la connexion (PKCE). Voir la console.");
  }
}

function afficherErreur(texte) {
  messageErreur.textContent = texte;
  messageErreur.hidden = false;
}
