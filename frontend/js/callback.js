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
  BACKEND_API_BASE_URL,
} from "./config.js";
import { enregistrerTokens, effacerTokens } from "./auth.js";

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

    const isRegistration       = sessionStorage.getItem("bourse_is_registration") === "true";
    const inscriptionComplete  = sessionStorage.getItem("bourse_inscription_complete") === "true";
    sessionStorage.removeItem("bourse_is_registration");
    sessionStorage.removeItem("bourse_inscription_complete");

    // Décoder le sub pour la clé localStorage
    let sub = "";
    try {
      sub = JSON.parse(atob(donneesToken.access_token.split(".")[1])).sub || "";
    } catch { /* token malformé - continuer */ }

    if (isRegistration) {
      // Inscription directe : effacer les tokens, l'utilisateur se reconnectera après le wizard
      effacerTokens();
      window.location.href = "inscription.html";
      return;
    }

    if (inscriptionComplete) {
      // Retour du wizard inscription (non-SSO) : marquer profil complet
      if (sub) localStorage.setItem("bourse_profil_" + sub, "1");
      // Créer le portefeuille en base
      try {
        const token = sessionStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
        if (token) {
          await fetch(`${BACKEND_API_BASE_URL}/api/portefeuille/creer`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      } catch { /* non bloquant */ }
      window.location.href = "dashboard.html";
      return;
    }

    // Login normal : vérifier si le profil bourse a déjà été complété
    if (sub && !localStorage.getItem("bourse_profil_" + sub)) {
      // Premier login (SSO ou direct) → wizard d'inscription
      window.location.href = "inscription.html";
    } else {
      window.location.href = "dashboard.html";
    }
  } catch (erreur) {
    console.error(erreur);
    redirigerVersLoginAvecErreur("Erreur lors de l'echange du code avec Keycloak. Voir la console.");
  }
}

function redirigerVersLoginAvecErreur(texteErreur) {
  document.documentElement.style.visibility = "";
  messageStatut.hidden = true;
  messageErreur.textContent = texteErreur;
  messageErreur.hidden = false;
  lienRetour.hidden = false;
}
