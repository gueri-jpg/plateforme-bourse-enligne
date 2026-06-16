# Backend - Module Admin (Plateforme de Bourse en Ligne)

Implementation des endpoints d'administration decrits dans `docs/architecture.md`
section 5.6 (US-30 a US-34) :

- `GET/PUT /api/admin/parametres/securite` - seuils de securite (US-30, US-31)
- `GET/PUT /api/admin/parametres/otp` - parametres OTP globaux (US-32, US-33)
- `GET/PUT /api/utilisateurs/moi/otp` - OTP self-service (US-24)
- `GET/PUT /api/admin/utilisateurs/{id}/otp` - OTP par utilisateur (admin, US-32)
- `GET/PUT /api/admin/parametres/devise` - devise par defaut de la plateforme (US-34)

## Stack technique

- **Python 3.11+** / **FastAPI** (framework web)
- **psycopg2** (acces direct a PostgreSQL, sans ORM - perimetre volontairement reduit)
- **PyJWT** (validation des tokens JWT Keycloak via JWKS)
- **requests** (appels a l'Admin REST API de Keycloak via le service account `admin-tools`)

## Arborescence

```
backend/
├── requirements.txt
├── README.md
└── app/
    ├── main.py                      # Point d'entree FastAPI, enregistrement des routers
    ├── config.py                    # Configuration (variables d'environnement)
    ├── db.py                        # Connexion PostgreSQL (psycopg2)
    ├── auth.py                      # Validation JWT Keycloak + dependances RBAC
    ├── keycloak_client.py           # Client Admin REST API Keycloak (service account)
    └── routers/
        ├── parametres_securite.py   # US-30, US-31
        ├── parametres_otp.py        # US-32, US-33 (configuration globale)
        ├── otp_utilisateur.py       # US-24, US-32 (par utilisateur + self-service)
        └── parametres_devise.py     # US-34
```

## Prerequis

1. La stack de base doit etre demarree (depuis la racine du projet) :

   ```bash
   docker compose up -d
   ```

   Cela demarre PostgreSQL (port 5432, base `bourse_db`, schema `administration`
   initialise via `db/init.sql`) et Keycloak (port 8080, realm `bourse-en-ligne`
   importe automatiquement depuis `keycloak/realm-export.json`).

2. **Important - role `manage-realm` pour le client `admin-tools`** :

   Le realm-export.json fourni accorde au service account `admin-tools` les
   roles `realm-management` suivants : `manage-users`, `view-users`, `query-users`.
   Pour synchroniser les seuils de securite (US-30/31), ce backend appelle
   `PUT /admin/realms/bourse-en-ligne`, ce qui necessite **en plus** le role
   `manage-realm`.

   **Etape manuelle a realiser une fois** (console d'administration Keycloak,
   http://localhost:8080/admin, login `admin` / `admin_password`) :
   - Aller dans **Clients > admin-tools > Service account roles**
   - Cliquer sur **Assign role**, filtrer par `realm-management`
   - Ajouter le role **`manage-realm`** (en plus de `manage-users`, `view-users`, `query-users`)

   Sans cette etape, `PUT /api/admin/parametres/securite` echouera avec une
   erreur 502 (403 cote Keycloak).

3. Verifier/ajuster le secret du client `admin-tools` si besoin : la valeur
   par defaut `admin-tools-secret-a-changer` (definie dans
   `keycloak/realm-export.json`) doit correspondre a la variable
   d'environnement `KEYCLOAK_ADMIN_CLIENT_SECRET` (voir ci-dessous).

## Installation

```bash
cd backend
python -m venv .venv

# Windows (PowerShell)
.venv\Scripts\Activate.ps1

# Linux / macOS
source .venv/bin/activate

pip install -r requirements.txt
```

## Configuration (variables d'environnement)

Toutes les variables ont des valeurs par defaut coherentes avec le
`docker-compose.yml` fourni (acces depuis l'hote, hors reseau Docker).
Pour les personnaliser, creer un fichier `backend/.env` (charge
automatiquement par `pydantic-settings`) :

```dotenv
# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=bourse_db
POSTGRES_USER=bourse_admin
POSTGRES_PASSWORD=bourse_admin_password

# Keycloak
KEYCLOAK_BASE_URL=http://localhost:8080
KEYCLOAK_REALM=bourse-en-ligne
KEYCLOAK_BACKEND_CLIENT_ID=backend-api
KEYCLOAK_ADMIN_CLIENT_ID=admin-tools
KEYCLOAK_ADMIN_CLIENT_SECRET=admin-tools-secret-a-changer

# Roles realm
ROLE_ADMINISTRATEUR=administrateur
ROLE_INVESTISSEUR=investisseur
```

## Lancement

```bash
uvicorn app.main:app --reload --port 8000
```

L'API est alors disponible sur http://localhost:8000, avec une documentation
interactive Swagger sur http://localhost:8000/docs.

Verification rapide (sans authentification) :

```bash
curl http://localhost:8000/api/health
# -> {"statut":"ok"}
```

## Authentification - obtenir un token JWT Keycloak

Les routes `/api/admin/...` necessitent un token JWT avec le role realm
`administrateur`. Les routes `/api/utilisateurs/moi/otp` necessitent un
utilisateur authentifie (role `investisseur` ou `administrateur`).

Le realm `bourse-en-ligne` (cf. `keycloak/realm-export.json`) contient deux
utilisateurs de test :

| Utilisateur | Mot de passe | Role |
|---|---|---|
| `admin1` | `Administrateur123!` | `administrateur` |
| `investisseur1` | `Investisseur123!` | `investisseur` |

### Obtenir un access_token (grant "password" / Resource Owner, pour les tests)

Le client `frontend-spa` est public (`directAccessGrantsEnabled: true`),
ce qui permet d'obtenir un token directement via login/mot de passe (a des
fins de test uniquement - en production le frontend utilise le flow
Authorization Code + PKCE) :

```bash
curl -X POST "http://localhost:8080/realms/bourse-en-ligne/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=frontend-spa" \
  -d "username=admin1" \
  -d "password=Administrateur123!"
```

La reponse contient `access_token`, `refresh_token` et `expires_in`.
Extraire `access_token` et l'utiliser dans l'en-tete `Authorization: Bearer <token>`.

### Rafraichir un token

```bash
curl -X POST "http://localhost:8080/realms/bourse-en-ligne/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=refresh_token" \
  -d "client_id=frontend-spa" \
  -d "refresh_token=<refresh_token>"
```

### Recuperer les informations utilisateur (verification)

```bash
curl "http://localhost:8080/realms/bourse-en-ligne/protocol/openid-connect/userinfo" \
  -H "Authorization: Bearer <access_token>"
```

## Exemples d'appels - Module Admin

Dans les exemples suivants, `$TOKEN` designe un `access_token` obtenu pour
l'utilisateur `admin1` (role `administrateur`).

```bash
TOKEN="<access_token de admin1>"
```

### 1. Seuils de securite (US-30, US-31)

```bash
# Lecture
curl http://localhost:8000/api/admin/parametres/securite \
  -H "Authorization: Bearer $TOKEN"

# Mise a jour (synchronise Keycloak : bruteForceProtected, failureFactor, ssoSessionIdleTimeout)
curl -X PUT http://localhost:8000/api/admin/parametres/securite \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"max_tentatives_echouees": 5, "duree_expiration_session_minutes": 30}'
```

Bornes acceptees (contraintes CHECK de `db/init.sql`) :
- `max_tentatives_echouees` : entre 3 et 10
- `duree_expiration_session_minutes` : entre 5 et 120

### 2. Parametres OTP globaux (US-32, US-33)

```bash
# Lecture
curl http://localhost:8000/api/admin/parametres/otp \
  -H "Authorization: Bearer $TOKEN"

# Mise a jour : OTP impose a chaque connexion pour tous les investisseurs
curl -X PUT http://localhost:8000/api/admin/parametres/otp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"otp_actif_global": true, "otp_frequence_type": "chaque_connexion", "otp_frequence_valeur": null}'

# Mise a jour : OTP demande tous les 30 jours
curl -X PUT http://localhost:8000/api/admin/parametres/otp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"otp_actif_global": true, "otp_frequence_type": "apres_n_jours", "otp_frequence_valeur": 30}'
```

### 3. OTP par utilisateur

```bash
# Self-service : un investisseur (token de "investisseur1") consulte son etat OTP
TOKEN_INVESTISSEUR="<access_token de investisseur1>"

curl http://localhost:8000/api/utilisateurs/moi/otp \
  -H "Authorization: Bearer $TOKEN_INVESTISSEUR"

# Self-service : activer son OTP
curl -X PUT http://localhost:8000/api/utilisateurs/moi/otp \
  -H "Authorization: Bearer $TOKEN_INVESTISSEUR" \
  -H "Content-Type: application/json" \
  -d '{"otp_active": true}'

# Admin : consulter/modifier l'OTP d'un utilisateur specifique
# (remplacer {id} par l'UUID de identite.utilisateurs)
curl http://localhost:8000/api/admin/utilisateurs/{id}/otp \
  -H "Authorization: Bearer $TOKEN"

curl -X PUT http://localhost:8000/api/admin/utilisateurs/{id}/otp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"otp_active": true}'
```

### 4. Devise de la plateforme (US-34)

```bash
# Lecture
curl http://localhost:8000/api/admin/parametres/devise \
  -H "Authorization: Bearer $TOKEN"

# Mise a jour (s'applique uniquement aux nouveaux comptes crees apres ce changement)
curl -X PUT http://localhost:8000/api/admin/parametres/devise \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"devise_par_defaut": "USD"}'
```

## Notes d'implementation

- **Validation JWT** : la signature des tokens est verifiee via le endpoint
  JWKS du realm (`/realms/bourse-en-ligne/protocol/openid-connect/certs`),
  avec mise en cache des cles publiques (`PyJWKClient`). L'`issuer` du token
  doit correspondre exactement a `KEYCLOAK_BASE_URL`/`realms/bourse-en-ligne`
  (attention a `KC_HOSTNAME=localhost` dans `docker-compose.yml`: le backend
  et le frontend doivent utiliser la meme URL `localhost:8080` pour que
  l'`issuer` corresponde).
- **RBAC** : le role realm `administrateur` est lu depuis le claim
  `realm_access.roles` du token (roles realm "standards" de Keycloak, pas
  besoin de role mapper supplementaire).
- **Tracabilite** : chaque modification de parametre (securite, OTP, devise)
  est journalisee dans `identite.journal_securite`
  (`type_evenement = 'modification_parametre'`), a condition que l'utilisateur
  authentifie ait une ligne correspondante dans `identite.utilisateurs`
  (cf. `keycloak_user_id`). Si ce n'est pas le cas (ex: utilisateur de test
  cree uniquement dans Keycloak sans miroir PostgreSQL), la mise a jour est
  effectuee mais non journalisee, et `modifie_par` reste `null`.
- **Coherence transactionnelle** : pour `/api/admin/parametres/securite` et
  `/api/admin/utilisateurs/{id}/otp`, si l'appel a l'Admin REST API Keycloak
  echoue, la transaction PostgreSQL est annulee (rollback) afin d'eviter une
  desynchronisation entre la base et Keycloak.

## Etapes manuelles restantes (recapitulatif)

1. Demarrer la stack Docker (`docker compose up -d`) si ce n'est pas deja fait.
2. **Ajouter le role `manage-realm` (realm-management) au service account
   `admin-tools`** dans la console Keycloak (cf. section "Prerequis" ci-dessus) -
   indispensable pour `PUT /api/admin/parametres/securite`.
3. (Optionnel) Creer un fichier `backend/.env` si les valeurs par defaut ne
   correspondent pas a votre environnement (ports/mots de passe modifies).
4. Pour que les endpoints `/api/utilisateurs/moi/otp` et
   `/api/admin/utilisateurs/{id}/otp` fonctionnent, les utilisateurs de test
   (`admin1`, `investisseur1`) doivent exister dans
   `identite.utilisateurs` (table PostgreSQL), avec leur `keycloak_user_id`
   correspondant au `sub` Keycloak. Le `db/init.sql` fourni ne contient pas
   ces lignes de demonstration : il faudra les inserer manuellement (ou via
   le futur endpoint `/api/inscriptions`), par exemple :

   ```sql
   -- Recuperer le "sub" Keycloak de admin1 et investisseur1 via :
   -- GET /admin/realms/bourse-en-ligne/users?username=admin1 (avec un token admin-tools)

   INSERT INTO identite.utilisateurs (keycloak_user_id, email, nom, prenom, statut)
   VALUES
     ('<sub-keycloak-admin1>', 'admin1@bourse-en-ligne.local', 'Admin', 'Bob', 'actif'),
     ('<sub-keycloak-investisseur1>', 'investisseur1@bourse-en-ligne.local', 'Martin', 'Alice', 'actif');
   ```

5. Installer les dependances et lancer le serveur :

   ```bash
   cd backend
   pip install -r requirements.txt
   uvicorn app.main:app --reload --port 8000
   ```
