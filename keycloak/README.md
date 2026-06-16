# Keycloak - Realm `bourse-en-ligne`

Ce dossier contient l'export du realm Keycloak utilise par la plateforme,
conforme a `docs/architecture.md` (section 2).

## Contenu

- `realm-export.json` : export du realm `bourse-en-ligne` contenant :
  - la configuration des sessions (expiration apres 30 minutes d'inactivite,
    `ssoSessionIdleTimeout`, US-05/US-31)
  - la configuration de detection brute-force (blocage apres 5 echecs,
    `failureFactor`, US-04/US-05/US-30)
  - l'activation du flow "mot de passe oublie" (`resetPasswordAllowed: true`, US-23)
  - la declaration de la Required Action `CONFIGURE_TOTP` (OTP/TOTP), disponible
    mais non imposee par defaut (US-24, US-32)
  - les 3 roles realm : `investisseur`, `administrateur`, `support_client`
  - les 3 clients : `frontend-spa` (public, PKCE), `backend-api` (bearer-only),
    `admin-tools` (service account pour l'Admin REST API)
  - 3 utilisateurs de demonstration (un par role), **mots de passe a usage
    de developpement local uniquement**

> **Synchronisation avec `administration.parametres_securite` (PostgreSQL)** :
> les valeurs `ssoSessionIdleTimeout` (en secondes) et `failureFactor`
> (utilise comme `maxLoginFailures`) doivent rester coherentes avec les
> colonnes `duree_expiration_session_minutes` et `max_tentatives_echouees` de
> `administration.parametres_securite` (valeurs par defaut 30 min / 5
> tentatives). Toute modification via l'endpoint backend
> `PUT /api/admin/parametres/securite` (US-30, US-31, cf.
> `docs/architecture.md` section 5.6) doit etre repercutee dans Keycloak via
> l'Admin REST API (cf. section "Endpoints Admin REST API" ci-dessous), sous
> peine de desynchronisation entre la configuration affichee a
> l'administrateur et le comportement reel de Keycloak.

## Import du realm

Avec le `docker-compose.yml` fourni, l'import est **automatique** au demarrage
du conteneur Keycloak grace a l'option `--import-realm` et au montage du
fichier dans `/opt/keycloak/data/import/realm-export.json`.

Si vous souhaitez re-importer manuellement (apres une modification du fichier
alors que le conteneur tourne deja), passez par la console d'administration :

- URL : http://localhost:8080
- Identifiants admin (definis dans `docker-compose.yml`) : `admin` / `admin_password`
- Menu "Realm settings" -> "Action" -> "Partial import" -> selectionner `realm-export.json`

## Utilisateurs de demonstration

| Username        | Mot de passe         | Role            |
|-----------------|-----------------------|-----------------|
| `investisseur1` | `Investisseur123!`    | `investisseur`  |
| `admin1`        | `Administrateur123!`  | `administrateur`|
| `support1`      | `Support123!`         | `support_client`|

> **Important** : ces identifiants sont fournis uniquement pour les tests
> en environnement local. Ils doivent etre changes/supprimes pour tout
> environnement partage ou de production.

---

## Exemples d'appels HTTP (curl)

Variables utilisees dans les exemples ci-dessous :

```bash
KEYCLOAK_URL="http://localhost:8080"
REALM="bourse-en-ligne"
CLIENT_ID="frontend-spa"
```

### 1. Decouverte de la configuration OIDC du realm

```bash
curl -s "${KEYCLOAK_URL}/realms/${REALM}/.well-known/openid-configuration" | jq
```

Cette reponse liste tous les endpoints OIDC (authorization, token, userinfo,
logout, jwks) ainsi que les algorithmes supportes.

### 2. Connexion - Authorization Code Flow + PKCE (flux SPA recommande)

Ce flux necessite un navigateur (redirection interactive). Etapes resumees :

1. Le frontend genere un `code_verifier` (chaine aleatoire) et calcule le
   `code_challenge` = `BASE64URL(SHA256(code_verifier))`.
2. Redirection du navigateur vers l'URL d'autorisation :

```
GET ${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/auth
    ?client_id=frontend-spa
    &response_type=code
    &redirect_uri=http://localhost:5173/callback
    &scope=openid
    &code_challenge=<code_challenge>
    &code_challenge_method=S256
```

3. Apres authentification reussie, Keycloak redirige vers `redirect_uri`
   avec un parametre `code` dans l'URL.
4. Le frontend echange ce `code` contre les tokens :

```bash
curl -s -X POST "${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "client_id=${CLIENT_ID}" \
  -d "code=<code_recu_dans_la_redirection>" \
  -d "redirect_uri=http://localhost:5173/callback" \
  -d "code_verifier=<code_verifier_genere_a_l_etape_1>"
```

Reponse (extrait) :

```json
{
  "access_token": "eyJhbGciOi...",
  "expires_in": 300,
  "refresh_token": "eyJhbGciOi...",
  "refresh_expires_in": 1800,
  "id_token": "eyJhbGciOi...",
  "token_type": "Bearer"
}
```

### 3. Connexion - Resource Owner Password Credentials (test local uniquement)

Pour des tests rapides en ligne de commande (Postman/curl), sans navigateur,
on peut utiliser le grant `password` (le client `frontend-spa` a
`directAccessGrantsEnabled: true` dans cet export) :

```bash
curl -s -X POST "${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=${CLIENT_ID}" \
  -d "username=investisseur1" \
  -d "password=Investisseur123!"
```

> **Attention** : ce flux ne doit pas etre utilise en production pour une SPA
> (les identifiants transitent par le frontend). Il est documente ici
> uniquement pour faciliter les tests locaux de l'API.

### 4. Rafraichissement du token (refresh token)

```bash
curl -s -X POST "${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=refresh_token" \
  -d "client_id=${CLIENT_ID}" \
  -d "refresh_token=<refresh_token_obtenu_precedemment>"
```

> Si le delai d'inactivite de session (`SSO Session Idle` = 30 minutes,
> US-05) est depasse, cette requete echoue (`invalid_grant` / session
> expiree) et l'utilisateur doit se reauthentifier.

### 5. Recuperation des informations utilisateur (`/userinfo`)

```bash
curl -s "${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/userinfo" \
  -H "Authorization: Bearer <access_token>"
```

Reponse (extrait) :

```json
{
  "sub": "f0a1b2c3-...",
  "email_verified": true,
  "preferred_username": "investisseur1",
  "given_name": "Alice",
  "family_name": "Martin",
  "email": "investisseur1@bourse-en-ligne.local"
}
```

> Le claim `realm_access.roles` (contenant `investisseur`, `administrateur`
> ou `support_client`) est present dans l'**access_token** (JWT decode),
> et non dans la reponse `/userinfo` par defaut.

### 6. Deconnexion (logout)

```bash
curl -s -X POST "${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/logout" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=${CLIENT_ID}" \
  -d "refresh_token=<refresh_token>"
```

### 7. Recuperation des cles publiques (JWKS) pour validation des JWT cote backend

```bash
curl -s "${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/certs" | jq
```

Le `backend-api` (bearer-only) utilise ces cles pour verifier la signature
des access tokens emis par `frontend-spa`, sans appeler Keycloak a chaque requete.

### 8. Exemple Admin REST API - obtenir un token pour `admin-tools`

Le service `admin-tools` (service account) est utilise par le backend pour
appeler l'Admin REST API (deblocage de compte US-06, liste des comptes
bloques US-07).

```bash
curl -s -X POST "${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=admin-tools" \
  -d "client_secret=admin-tools-secret-a-changer"
```

Exemple d'appel a l'Admin REST API avec ce token (recherche d'un utilisateur) :

```bash
curl -s "${KEYCLOAK_URL}/admin/realms/${REALM}/users?username=investisseur1" \
  -H "Authorization: Bearer <admin_tools_access_token>"
```

### 9. Synchronisation des parametres de securite (US-30, US-31)

Quand un administrateur modifie `administration.parametres_securite` via
`PUT /api/admin/parametres/securite` (cf. `docs/architecture.md` section 5.6),
le backend (avec le token `admin-tools` obtenu a l'etape 8) doit repercuter
immediatement les nouvelles valeurs dans la configuration du realm Keycloak,
sans redeploiement :

- `max_tentatives_echouees` (PostgreSQL) -> `bruteForceProtected: true` et
  `failureFactor` (Keycloak, utilise comme `maxLoginFailures`)
- `duree_expiration_session_minutes` (PostgreSQL, en minutes) ->
  `ssoSessionIdleTimeout` (Keycloak, en **secondes** : multiplier par 60)

```bash
# Exemple : seuil de tentatives = 7, expiration de session = 45 minutes (2700 s)
curl -s -X PUT "${KEYCLOAK_URL}/admin/realms/${REALM}" \
  -H "Authorization: Bearer <admin_tools_access_token>" \
  -H "Content-Type: application/json" \
  -d '{
        "bruteForceProtected": true,
        "failureFactor": 7,
        "ssoSessionIdleTimeout": 2700
      }'
```

> Cet appel met a jour la representation complete du realm : en pratique, le
> backend doit d'abord recuperer la configuration courante
> (`GET /admin/realms/${REALM}`), modifier uniquement les champs concernes,
> puis renvoyer l'objet complet via `PUT` (l'API Admin Keycloak ne fait pas de
> "merge" partiel sur cet endpoint).

### 10. Synchronisation de l'OTP par utilisateur (US-24, US-32)

Pour imposer (ou retirer) la verification OTP a un utilisateur donne, le
backend assigne ou retire la Required Action `CONFIGURE_TOTP` sur cet
utilisateur via l'Admin REST API :

```bash
# Recuperer l'utilisateur cible (pour obtenir son id Keycloak)
curl -s "${KEYCLOAK_URL}/admin/realms/${REALM}/users?username=investisseur1" \
  -H "Authorization: Bearer <admin_tools_access_token>"

# Imposer l'OTP a la prochaine connexion (ajout de la Required Action)
curl -s -X PUT "${KEYCLOAK_URL}/admin/realms/${REALM}/users/<user_id>" \
  -H "Authorization: Bearer <admin_tools_access_token>" \
  -H "Content-Type: application/json" \
  -d '{ "requiredActions": ["CONFIGURE_TOTP"] }'

# Retirer l'obligation d'OTP (liste vide ou sans CONFIGURE_TOTP)
curl -s -X PUT "${KEYCLOAK_URL}/admin/realms/${REALM}/users/<user_id>" \
  -H "Authorization: Bearer <admin_tools_access_token>" \
  -H "Content-Type: application/json" \
  -d '{ "requiredActions": [] }'
```

> Ces appels reflètent les decisions prises cote backend a partir de
> `administration.parametres_otp` (activation globale, US-32) et
> `administration.otp_utilisateur` (override individuel, US-24), conformement
> a `docs/architecture.md` section 2.7.2.
