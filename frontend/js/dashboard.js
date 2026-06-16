// ============================================================================
// Page tableau de bord :
//   - Affiche les informations utilisateur (via /userinfo + decodage de
//     l'id_token pour recuperer realm_access.roles).
//   - Gere le bouton de deconnexion (logout Keycloak avec id_token_hint).
//   - Si le role "administrateur" est present, affiche le "Module Admin"
//     et cable les formulaires sur les endpoints du backend FastAPI
//     (port 8000) avec gestion du refresh token si l'access_token a expire.
// ============================================================================

import { BACKEND_API_BASE_URL } from "./config.js";
import {
  obtenirAccessTokenValide,
  obtenirIdToken,
  decoderJwt,
  recupererUserInfo,
  seDeconnecter,
} from "./auth.js";

const zoneProfil = document.getElementById("zone-profil");
const moduleAdmin = document.getElementById("module-admin");
const messageAdminErreur = document.getElementById("message-admin-erreur");
const boutonLogout = document.getElementById("bouton-logout");

boutonLogout.addEventListener("click", seDeconnecter);

initialiserTableauDeBord();

async function initialiserTableauDeBord() {
  // 1. Verifie/rafraichit l'access_token. Si aucune session valide,
  // on renvoie l'utilisateur vers la page de login.
  const accessToken = await obtenirAccessTokenValide();
  if (!accessToken) {
    window.location.href = "index.html?erreur=Session expiree, veuillez vous reconnecter.";
    return;
  }

  // 2. Decodage de l'id_token pour recuperer les claims (roles, nom, email)
  const idToken = obtenirIdToken();
  const claimsIdToken = idToken ? decoderJwt(idToken) : null;
  const roles = claimsIdToken?.realm_access?.roles || [];

  // 3. Appel /userinfo pour les infos de profil (source de verite Keycloak)
  let infosUtilisateur;
  try {
    infosUtilisateur = await recupererUserInfo(accessToken);
  } catch (erreur) {
    console.error(erreur);
    infosUtilisateur = claimsIdToken || {};
  }

  afficherProfil(infosUtilisateur, roles);

  // 4. Affichage conditionnel du Module Admin selon le role "administrateur"
  if (roles.includes("administrateur")) {
    moduleAdmin.hidden = false;
    await initialiserModuleAdmin();
  }
}

/** Affiche les informations de profil et la liste des roles. */
function afficherProfil(infos, roles) {
  const listeRoles = roles.length > 0 ? roles.join(", ") : "(aucun role)";

  zoneProfil.innerHTML = `
    <dl class="liste-definitions">
      <dt>Nom d'utilisateur</dt>
      <dd>${echapperHtml(infos.preferred_username || "-")}</dd>

      <dt>Nom complet</dt>
      <dd>${echapperHtml(infos.name || `${infos.given_name || ""} ${infos.family_name || ""}`.trim() || "-")}</dd>

      <dt>Email</dt>
      <dd>${echapperHtml(infos.email || "-")}</dd>

      <dt>Roles (realm_access.roles)</dt>
      <dd><code>${echapperHtml(listeRoles)}</code></dd>

      <dt>Identifiant Keycloak (sub)</dt>
      <dd><code>${echapperHtml(infos.sub || "-")}</code></dd>
    </dl>
  `;
}

/** Echappe les caracteres HTML sensibles pour eviter toute injection XSS basique. */
function echapperHtml(texte) {
  const div = document.createElement("div");
  div.textContent = texte;
  return div.innerHTML;
}

// ============================================================================
// Module Admin : appels au backend FastAPI (port 8000)
// ============================================================================

/**
 * Wrapper fetch qui ajoute automatiquement l'en-tete Authorization avec un
 * access_token valide (rafraichi si necessaire), et gere le cas d'expiration
 * pendant l'appel (retry unique apres refresh).
 */
async function appelBackend(chemin, options = {}) {
  let accessToken = await obtenirAccessTokenValide();
  if (!accessToken) {
    window.location.href = "index.html?erreur=Session expiree, veuillez vous reconnecter.";
    throw new Error("Session expiree");
  }

  const entetes = {
    ...(options.headers || {}),
    Authorization: `Bearer ${accessToken}`,
  };

  let reponse = await fetch(`${BACKEND_API_BASE_URL}${chemin}`, { ...options, headers: entetes });

  // Si le backend renvoie 401 (token expire/invalide cote serveur), on tente
  // un rafraichissement puis on rejoue la requete une seule fois.
  if (reponse.status === 401) {
    accessToken = await obtenirAccessTokenValide();
    if (!accessToken) {
      window.location.href = "index.html?erreur=Session expiree, veuillez vous reconnecter.";
      throw new Error("Session expiree");
    }
    reponse = await fetch(`${BACKEND_API_BASE_URL}${chemin}`, {
      ...options,
      headers: { ...entetes, Authorization: `Bearer ${accessToken}` },
    });
  }

  if (!reponse.ok) {
    const detail = await reponse.text();
    throw new Error(`Erreur backend (${reponse.status}) : ${detail}`);
  }

  return reponse.json();
}

async function initialiserModuleAdmin() {
  await Promise.all([
    chargerParametresSecurite(),
    chargerParametresOtp(),
    chargerParametresDevise(),
  ]).catch((erreur) => afficherErreurAdmin(erreur));

  document.getElementById("formulaire-securite").addEventListener("submit", soumettreParametresSecurite);
  document.getElementById("formulaire-otp").addEventListener("submit", soumettreParametresOtp);
  document.getElementById("formulaire-devise").addEventListener("submit", soumettreParametresDevise);
}

function afficherErreurAdmin(erreur) {
  console.error(erreur);
  messageAdminErreur.textContent = `Erreur Module Admin : ${erreur.message}`;
  messageAdminErreur.hidden = false;
}

// ---------------------------------------------------------------------
// GET/PUT /api/admin/parametres/securite (US-30, US-31)
// ---------------------------------------------------------------------
async function chargerParametresSecurite() {
  const donnees = await appelBackend("/api/admin/parametres/securite");
  document.getElementById("champ-max-tentatives").value = donnees.max_tentatives_echouees;
  document.getElementById("champ-duree-session").value = donnees.duree_expiration_session_minutes;
}

async function soumettreParametresSecurite(evenement) {
  evenement.preventDefault();
  const statut = document.getElementById("securite-statut");
  statut.textContent = "Enregistrement...";

  const corps = {
    max_tentatives_echouees: Number(document.getElementById("champ-max-tentatives").value),
    duree_expiration_session_minutes: Number(document.getElementById("champ-duree-session").value),
  };

  try {
    await appelBackend("/api/admin/parametres/securite", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corps),
    });
    statut.textContent = "Parametres de securite enregistres avec succes.";
  } catch (erreur) {
    statut.textContent = `Erreur : ${erreur.message}`;
  }
}

// ---------------------------------------------------------------------
// GET/PUT /api/admin/parametres/otp (US-32, US-33)
// ---------------------------------------------------------------------
async function chargerParametresOtp() {
  const donnees = await appelBackend("/api/admin/parametres/otp");
  document.getElementById("champ-otp-actif-global").checked = donnees.otp_actif_global;
  document.getElementById("champ-otp-frequence-type").value = donnees.otp_frequence_type;
  document.getElementById("champ-otp-frequence-valeur").value = donnees.otp_frequence_valeur ?? "";
}

async function soumettreParametresOtp(evenement) {
  evenement.preventDefault();
  const statut = document.getElementById("otp-statut");
  statut.textContent = "Enregistrement...";

  const typeFrequence = document.getElementById("champ-otp-frequence-type").value;
  const valeurBrute = document.getElementById("champ-otp-frequence-valeur").value;

  const corps = {
    otp_actif_global: document.getElementById("champ-otp-actif-global").checked,
    otp_frequence_type: typeFrequence,
    // otp_frequence_valeur doit etre null si "chaque_connexion", sinon un entier > 0
    otp_frequence_valeur: typeFrequence === "chaque_connexion" ? null : Number(valeurBrute),
  };

  try {
    await appelBackend("/api/admin/parametres/otp", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corps),
    });
    statut.textContent = "Parametres OTP enregistres avec succes.";
  } catch (erreur) {
    statut.textContent = `Erreur : ${erreur.message}`;
  }
}

// ---------------------------------------------------------------------
// GET/PUT /api/admin/parametres/devise (US-34)
// ---------------------------------------------------------------------
async function chargerParametresDevise() {
  const donnees = await appelBackend("/api/admin/parametres/devise");
  document.getElementById("champ-devise").value = donnees.devise_par_defaut;
}

async function soumettreParametresDevise(evenement) {
  evenement.preventDefault();
  const statut = document.getElementById("devise-statut");
  statut.textContent = "Enregistrement...";

  const corps = {
    devise_par_defaut: document.getElementById("champ-devise").value.toUpperCase(),
  };

  try {
    await appelBackend("/api/admin/parametres/devise", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corps),
    });
    statut.textContent = "Devise par defaut enregistree avec succes.";
  } catch (erreur) {
    statut.textContent = `Erreur : ${erreur.message}`;
  }
}
