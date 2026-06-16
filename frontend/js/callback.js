// ============================================================================
// Page de callback : recupere le "code" d'autorisation renvoye par Keycloak
// dans l'URL, l'echange contre les tokens (access/refresh/id) via
// POST /protocol/openid-connect/token (avec code_verifier PKCE), stocke
// les tokens en sessionStorage, puis redirige vers le tableau de bord.
// ============================================================================

import {
  KEYCLOAK_TOKEN_ENDPOINT,
  KEYCLOAK_CLIENT_ID,
  REDIRECT_URI,
  STORAGE_KEYS,
} from "./config.js";
import { enregistrerTokens } from "./auth.js";

const messageStatut = document.getElementById("message-statut");
const messageErreur = document.getElementById("message-erreur");
const lienRetour = document.getElementById("lien-retour");

traiterRetourKeycloak();

async function traiterRetourKeycloak() {
  const parametresUrl = new URLSearchParams(window.location.search);

  // Cas 1 : Keycloak renvoie une erreur (ex: utilisateur a refuse,
  // identifiants invalides apres plusieurs tentatives, etc.)
  if (parametresUrl.has("error")) {
    const description = parametresUrl.get("error_description") || parametresUrl.get("error");
    redirigerVersLoginAvecErreur(description);
    return;
  }

  const code = parametresUrl.get("code");
  const etatRecu = parametresUrl.get("state");

  if (!code) {
    redirigerVersLoginAvecErreur("Code d'autorisation manquant dans la reponse de Keycloak.");
    return;
  }

  // Verification basique du parametre "state" (protection anti-CSRF)
  const etatAttendu = sessionStorage.getItem("bourse_oauth_state");
  if (etatAttendu && etatRecu !== etatAttendu) {
    redirigerVersLoginAvecErreur("Parametre 'state' invalide (protection CSRF).");
    return;
  }

  // Recuperation du code_verifier PKCE genere lors du login (js/login.js)
  const codeVerifier = sessionStorage.getItem(STORAGE_KEYS.CODE_VERIFIER);
  if (!codeVerifier) {
    redirigerVersLoginAvecErreur("code_verifier PKCE introuvable (session expiree ?). Recommencez la connexion.");
    return;
  }

  try {
    messageStatut.textContent = "Echange du code contre les tokens (POST /token)...";

    // Echange du code contre les tokens : grant_type=authorization_code
    // (cf. docs/architecture.md section 2.1/2.2). Client public -> pas de
    // "client_secret", uniquement le code_verifier PKCE.
    const corps = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: KEYCLOAK_CLIENT_ID,
      code: code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    });

    const reponse = await fetch(KEYCLOAK_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: corps,
    });

    if (!reponse.ok) {
      const texteErreur = await reponse.text();
      throw new Error(`Echec de l'echange du token (${reponse.status}) : ${texteErreur}`);
    }

    const donneesToken = await reponse.json();
    enregistrerTokens(donneesToken);

    // Nettoyage des valeurs PKCE temporaires, plus necessaires
    sessionStorage.removeItem(STORAGE_KEYS.CODE_VERIFIER);
    sessionStorage.removeItem("bourse_oauth_state");

    messageStatut.textContent = "Connexion reussie, redirection vers le tableau de bord...";
    window.location.href = "dashboard.html";
  } catch (erreur) {
    console.error(erreur);
    redirigerVersLoginAvecErreur("Erreur lors de l'echange du code avec Keycloak. Voir la console.");
  }
}

function redirigerVersLoginAvecErreur(texteErreur) {
  messageStatut.hidden = true;
  messageErreur.textContent = texteErreur;
  messageErreur.hidden = false;
  lienRetour.hidden = false;
}
