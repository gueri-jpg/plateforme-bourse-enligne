// ============================================================================
// Utilitaires PKCE (Proof Key for Code Exchange) - RFC 7636
//
// Le client "frontend-spa" est un client PUBLIC Keycloak avec PKCE S256
// obligatoire (cf. keycloak/realm-export.json, attribut
// "pkce.code.challenge.method": "S256"). Ces fonctions generent le
// "code_verifier" (secret local) et le "code_challenge" (derive du
// verifier via SHA-256, encode en base64url) a transmettre a Keycloak.
// ============================================================================

/**
 * Encode un ArrayBuffer/Uint8Array en base64url (RFC 4648 section 5),
 * c'est-a-dire base64 standard mais avec "+" -> "-", "/" -> "_" et
 * suppression du padding "=", comme exige par la spec PKCE.
 */
function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binaire = "";
  for (const octet of bytes) {
    binaire += String.fromCharCode(octet);
  }
  return btoa(binaire)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Genere un "code_verifier" aleatoire : chaine de 43 a 128 caracteres
 * composee de caracteres [A-Z a-z 0-9 - . _ ~], conformement a RFC 7636.
 * Ici on genere 32 octets aleatoires encodes en base64url (= 43 caracteres).
 */
export function genererCodeVerifier() {
  const tableauAleatoire = new Uint8Array(32);
  crypto.getRandomValues(tableauAleatoire);
  return base64UrlEncode(tableauAleatoire);
}

/**
 * Calcule le "code_challenge" S256 a partir du "code_verifier" :
 * code_challenge = BASE64URL(SHA256(code_verifier))
 */
export async function genererCodeChallenge(codeVerifier) {
  const encodeur = new TextEncoder();
  const donnees = encodeur.encode(codeVerifier);
  const hachage = await crypto.subtle.digest("SHA-256", donnees);
  return base64UrlEncode(hachage);
}

/**
 * Genere une valeur aleatoire utilisable comme parametre "state" OAuth2
 * (protection CSRF basique sur le retour de Keycloak).
 */
export function genererEtatAleatoire() {
  const tableauAleatoire = new Uint8Array(16);
  crypto.getRandomValues(tableauAleatoire);
  return base64UrlEncode(tableauAleatoire);
}
