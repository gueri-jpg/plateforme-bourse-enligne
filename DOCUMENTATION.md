# Documentation Technique — Plateforme de Bourse en Ligne

> Version 1.0 · Casablanca Bourse (BVC) · FIX 5.0/FIXT.1.1 (MIT202) · OAuth2/OIDC · Kafka · PostgreSQL · Azure AKS

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Stack technique](#2-stack-technique)
3. [URLs & ports](#3-urls--ports)
4. [Infrastructure Docker Compose](#4-infrastructure-docker-compose)
5. [Kubernetes / Azure AKS](#5-kubernetes--azure-aks)
6. [CI/CD GitHub Actions](#6-cicd-github-actions)
7. [Authentification Keycloak](#7-authentification-keycloak)
8. [Validation JWT](#8-validation-jwt)
9. [Base de données PostgreSQL](#9-base-de-données-postgresql)
10. [API REST — Tous les endpoints](#10-api-rest--tous-les-endpoints)
11. [WebSockets](#11-websockets)
12. [Protocole FIX MIT202](#12-protocole-fix-mit202)
13. [Moteur de matching](#13-moteur-de-matching)
14. [Phases de marché BVC](#14-phases-de-marché-bvc)
15. [Architecture Kafka](#15-architecture-kafka)
16. [BVC Producer](#16-bvc-producer)
17. [BVC Relay (serve.py)](#17-bvc-relay-servepy)
18. [Carnet d'ordres BVC (bvc_orderbook.py)](#18-carnet-dordres-bvc-bvc_orderbookpy)
19. [Frontend Web (dashboard.html)](#19-frontend-web-dashboardhtml)
20. [Back-office Admin](#20-back-office-admin)
21. [Application Mobile (Expo)](#21-application-mobile-expo)
22. [SSO Inter-service Banque ↔ Bourse](#22-sso-inter-service-banque--bourse)
23. [SCA — Authentification forte sur les ordres](#23-sca--authentification-forte-sur-les-ordres)

---

## 1. Vue d'ensemble

La plateforme est une bourse en ligne complète connectée à la Bourse de Casablanca (BVC). Elle couvre :

- **Authentification SSO multi-realm** via Keycloak (investisseurs + administrateurs)
- **Négociation d'instruments financiers** via le protocole FIX 5.0/FIXT.1.1 (MIT202 — LSE Millennium Exchange)
- **Streaming temps réel** des cotations BVC via Kafka et WebSocket
- **Marchés mondiaux** (QQQ, SPY, Or, BTC, ETH, EUR/USD…) via Twelve Data API
- **Intégration inter-service** avec une banque digitale partenaire (SSO bidirectionnel, dépôts, SCA)
- **Application mobile** Expo React Native (Android / iOS)

---

## 2. Stack technique

| Composant | Technologie |
|-----------|-------------|
| Backend API | FastAPI + Python 3.12, Uvicorn, Pydantic v2 |
| Base de données | PostgreSQL 16-alpine, psycopg2, 6 schémas métier |
| Message streaming | Apache Kafka KRaft 7.7.1 (Confluent), confluent-kafka |
| Authentification | Keycloak 26, OAuth2/OIDC, JWT RS256, 2 realms |
| Frontend web | HTML/CSS/JS vanilla, Nginx Alpine, TradingView widget |
| Mobile | Expo React Native, EAS Build/Update |
| Cloud | Azure AKS (francecentral), ACR, PostgreSQL Flexible |
| Email | Resend API (OTP SCA, mot de passe oublié) |
| Marchés mondiaux | Twelve Data API |

---

## 3. URLs & ports

### Production

| Service | URL |
|---------|-----|
| Frontend investisseur | `https://bourse.cfconsultancy.org` |
| Backend API | `https://api.cfconsultancy.org` |
| Keycloak SSO | `https://auth.cfconsultancy.org` |
| Admin back-office | `https://admin.cfconsultancy.org` |
| BVC Relay | `https://relay.cfconsultancy.org` |

### Local Docker Compose

| Service | URL / Port |
|---------|------------|
| Frontend investisseur | `http://localhost:3000` |
| Admin back-office | `http://localhost:3001` |
| Backend API | `http://localhost:8000` |
| Keycloak | `http://localhost:9090` |
| PostgreSQL | `localhost:5432` |
| Kafka broker | `localhost:9092` |
| BVC Relay (interne) | `http://localhost:8765` |

---

## 4. Infrastructure Docker Compose

Réseau bridge `bourse-network` partagé entre tous les services.

### Services

| Service | Image | Rôle | Dépend de |
|---------|-------|------|-----------|
| `postgres` | postgres:16-alpine | Base de données principale (`bourse_db`) + Keycloak (`keycloak_db`) | — |
| `kafka` | confluentinc/cp-kafka:7.7.1 | Broker KRaft (sans Zookeeper), topic `market.prices` | — |
| `keycloak` | quay.io/keycloak/keycloak:26.0 | IAM/SSO, import automatique des 2 realms au démarrage | postgres |
| `backend` | build ./backend | FastAPI port 8000 : API REST + WebSocket + FIX engine | kafka, postgres |
| `bvc-producer` | build ./kafka | Scrape BVC toutes les 30 s → topic `market.prices` | kafka |
| `bvc-relay` | python:3.12-slim | Proxy CORS BVC port 8765 (serve.py) | — |
| `frontend` | nginx:alpine | SPA statique port 3000, proxy `/api/` → bvc-relay | keycloak, backend |
| `admin-frontend` | nginx:alpine | Back-office admin port 3001 | keycloak, backend |

### Volumes persistants

- `postgres_data` — données PostgreSQL
- `kafka_data` — données Kafka (topics, offsets)

### Variables d'environnement clés (docker-compose.yml)

```
POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB
KC_ADMIN_USERNAME / KC_ADMIN_PASSWORD
KEYCLOAK_ADMIN_CLIENT_SECRET
RESEND_API_KEY
EMAIL_FROM
SMTP_HOST / SMTP_PORT / SMTP_FROM
TWELVE_DATA_API_KEY
INTER_SERVICE_TOKEN
BANQUE_FRONTEND_URL
```

---

## 5. Kubernetes / Azure AKS

### Cluster

| Attribut | Valeur |
|----------|--------|
| Cluster | `bourse-aks-dev` |
| Région | `francecentral` |
| Resource Group | `rg-cfc-dev` |
| Managed RG | `MC_rg-cfc-dev_bourse-aks-dev_francecentral` |
| Node pool | 1–2 × Standard_D2s_v3 (2 vCPU, 8 GB) |
| Namespace | `bourse` |

### Chart Helm : bourse-platform

Chemin : `infra/helm/bourse-platform/`. Inclut les sous-charts Bitnami Keycloak et Kafka (KRaft).

| Déploiement Kubernetes | Image ACR | Replicas |
|------------------------|-----------|----------|
| bourse-platform-backend | bourse-backend:latest | 2 |
| bourse-platform-frontend | bourse-frontend:latest | 2 |
| bourse-platform-admin-frontend | bourse-admin-frontend:latest | 1 |
| bourse-platform-bvc-relay | bourse-bvc-relay:latest | 1 |
| bourse-platform-bvc-producer | bourse-bvc-producer:latest | 1 |
| bourse-platform-keycloak | bourse-keycloak:latest | 1 |

### Ingress & DNS

- **NGINX Ingress Controller** gère le routage des sous-domaines
- **Cloudflare Flexible** : HTTPS Cloudflare → HTTP AKS (Cloudflare gère le certificat TLS)
- Pas de TLS sur l'ingress AKS côté origine

> **⚠️ Auto-shutdown** : Les nœuds AKS dev peuvent être arrêtés automatiquement par la politique Azure (`PowerState/stopped`). Pour redémarrer :
> ```bash
> az vmss start \
>   --resource-group MC_rg-cfc-dev_bourse-aks-dev_francecentral \
>   --name aks-nodepool1-*-vmss \
>   --instance-ids 0
> ```

---

## 6. CI/CD GitHub Actions

### Workflow : deploy.yml

Déclenché sur push vers `main` ou `workflow_dispatch`. Détection des changements via `dorny/paths-filter` — seuls les services modifiés sont rebuild et redéployés.

| Job | Condition | Action |
|-----|-----------|--------|
| `changes` | toujours | Détecte les fichiers modifiés |
| `deploy` | ≥ 1 composant changé | Azure login → ACR login → docker build/push → `kubectl set image` → health check → rollback auto si échec |
| `tests-fonctionnels` | deploy réussi | pytest Selenium E2E contre production |
| `build-mobile` | workflow_dispatch + `build_apk=true` | EAS Build Android APK (quota : 15/mois) |
| `update-mobile` | JS mobile changé, pas natif | EAS Update OTA (sans nouvel APK) |

### Secrets requis

```
AZURE_CLIENT_ID          # Federated identity (OIDC sans mot de passe)
AZURE_TENANT_ID
AZURE_SUBSCRIPTION_ID
ACR_LOGIN_SERVER         # ex : acrboursprod.azurecr.io
EXPO_TOKEN               # Pour EAS Build/Update
TWELVE_DATA_API_KEY      # Cotations marchés mondiaux
RESEND_API_KEY           # Emails transactionnels
```

---

## 7. Authentification Keycloak

### Deux realms isolés

| Realm | Utilisateurs | Clients | Rôles |
|-------|-------------|---------|-------|
| `bourse-en-ligne` | Investisseurs, support | frontend-spa, backend-api, admin-tools, mobile-app | investisseur, support |
| `bourse-admin` | Administrateurs plateforme | admin-console | administrateur |

### Clients OAuth2

| Client ID | Flux | Rôle |
|-----------|------|------|
| `frontend-spa` | Authorization Code + PKCE | SPA investisseur (public, pas de secret) |
| `backend-api` | Bearer-only | Valide les tokens JWT entrants (resource server) |
| `admin-tools` | Client Credentials | Service account backend → Admin REST API Keycloak (manage-users, view-users, manage-realm) |
| `mobile-app` | Authorization Code + PKCE | Application Expo React Native |

### Paramètres de sécurité (synchronisés depuis l'API)

- **Brute Force Detection** : 5 tentatives max (configurable via `PUT /api/admin/parametres-securite`)
- **Session idle** : 30 minutes (configurable)
- **OTP 2FA** : désactivé par défaut, activable par investisseur ou globalement
- **SMTP** : Resend configuré pour emails de vérification, mot de passe oublié, OTP

### Thème personnalisé

Thème Keycloak dark `bourse` dans `keycloak/themes/bourse/`, chargé via volume Docker. Couleurs navy/or de la plateforme.

### Import automatique des realms

Au démarrage du conteneur Keycloak, les fichiers `keycloak/realm-export-bourse-en-ligne.json` et `keycloak/realm-export-bourse-admin.json` sont importés via la variable `KC_IMPORT`.

---

## 8. Validation JWT

### Flux investisseur (Authorization Code + PKCE)

```
1. Navigateur → Keycloak : GET /realms/bourse-en-ligne/protocol/openid-connect/auth
                             ?response_type=code&client_id=frontend-spa
                             &code_challenge=...&code_challenge_method=S256
2. Keycloak  → Navigateur : redirect callback ?code=...
3. Navigateur → Keycloak : POST /token (code + code_verifier)
4. Keycloak  → Navigateur : { access_token (JWT RS256), refresh_token, id_token }
5. Navigateur → Backend   : Authorization: Bearer <access_token>
6. Backend   → Keycloak   : GET /certs (JWKS, mis en cache par PyJWKClient)
7. Backend   : valide signature RS256, issuer, expiry, audience → extrait roles
```

### Stratégie multi-realm (backend/app/auth.py)

Le backend lit le claim `iss` sans vérifier la signature pour identifier le realm, puis sélectionne le bon client JWKS (`_jwks_bourse` ou `_jwks_admin`) et valide l'ensemble.

```python
class UtilisateurAuthentifie:
    keycloak_user_id : str   # claim "sub"
    username         : str   # claim "preferred_username"
    email            : str
    roles            : list[str]  # realm_access.roles
```

### Dépendances FastAPI

| Dépendance | Realm accepté | Rôle requis |
|-----------|---------------|------------|
| `utilisateur_courant` | bourse-en-ligne ou bourse-admin | aucun (token valide suffit) |
| `investisseur_requis` | bourse-en-ligne | investisseur |
| `administrateur_requis` | bourse-admin | administrateur |

---

## 9. Base de données PostgreSQL

Deux bases de données :
- `bourse_db` — données métier (6 schémas)
- `keycloak_db` — données internes Keycloak

Extension `pgcrypto` activée pour `gen_random_uuid()`.

### Schémas

| Schéma | Contenu |
|--------|---------|
| `identite` | Utilisateurs, KYC, journal sécurité |
| `marche` | Instruments financiers, cours, horaires |
| `portefeuille` | Comptes espèces, positions titres |
| `ordres` | Ordres de bourse, exécutions |
| `historique` | Mouvements de compte |
| `administration` | Paramètres plateforme |

---

### identite.utilisateurs

| Colonne | Type | Contrainte | Description |
|---------|------|-----------|-------------|
| id | UUID PK | DEFAULT gen_random_uuid() | Identifiant interne |
| keycloak_user_id | UUID | NOT NULL UNIQUE | Claim "sub" Keycloak |
| email | VARCHAR(255) | NOT NULL UNIQUE | |
| nom, prenom | VARCHAR(100) | NOT NULL | |
| statut | VARCHAR(20) | DEFAULT 'actif' | actif / bloque / desactive |
| date_creation | TIMESTAMPTZ | DEFAULT now() | |

### identite.profil_kyc

| Colonne | Type | Description |
|---------|------|-------------|
| utilisateur_id | UUID FK UNIQUE | Relation 1-1 (ON DELETE CASCADE) |
| type_piece_identite | VARCHAR(50) | CIN, Passeport… |
| numero_piece | VARCHAR(100) | |
| adresse | TEXT | |
| date_naissance | DATE | |
| statut_validation | VARCHAR(20) | valide / rejete / en_cours |
| date_validation | TIMESTAMPTZ | Nullable |

### identite.journal_securite

| Colonne | Type | Description |
|---------|------|-------------|
| id | BIGSERIAL PK | |
| utilisateur_id | UUID FK | ON DELETE CASCADE |
| type_evenement | VARCHAR(30) | connexion_reussie / connexion_echouee / blocage / deblocage / verif_otp_reussie / verif_otp_echouee / reinitialisation_mdp / modification_parametre |
| horodatage | TIMESTAMPTZ | Index sur (utilisateur_id, horodatage DESC) |
| details | JSONB | IP, user-agent, motif… |

---

### marche.instruments

| Colonne | Type | Description |
|---------|------|-------------|
| id | UUID PK | |
| code | VARCHAR(20) UNIQUE | Ticker (ex : ATW, IAM, TQM) |
| nom | VARCHAR(150) | Nom complet |
| type | VARCHAR(30) | action / obligation / etf… |
| actif | BOOLEAN | Instrument négociable |

### marche.cours_actuels

Cache du dernier cours connu par instrument. PK = `instrument_id`.

| Colonne | Type | Description |
|---------|------|-------------|
| instrument_id | UUID PK FK | |
| dernier_prix | NUMERIC(18,4) | ≥ 0 |
| horodatage_maj | TIMESTAMPTZ | |
| variation_pct | NUMERIC(8,4) | Variation % vs cours précédent |

### marche.parametres_marche

Une ligne par jour de semaine. Défaut : lundi–vendredi 09:00–17:30, week-end fermé.

---

### portefeuille.comptes

Un compte espèces par investisseur (relation 1-1).

| Colonne | Type | Description |
|---------|------|-------------|
| id | UUID PK | |
| utilisateur_id | UUID FK UNIQUE | |
| solde_especes | NUMERIC(18,2) | Solde disponible (≥ 0) |
| devise | CHAR(3) | ISO 4217 — héritée de `administration.parametres_plateforme` à l'INSERT via trigger |
| iban | VARCHAR(35) | IBAN du compte (migration douce) |
| numero | VARCHAR(15) UNIQUE | Numéro de compte interne |
| type | VARCHAR(30) | actions / obligations / opcvm / mixte |
| statut | VARCHAR(20) | actif / suspendu / cloture |
| date_ouverture | DATE | |

> **Trigger `trg_comptes_devise_par_defaut`** : à l'INSERT, applique la devise par défaut courante si la colonne `devise` n'est pas fournie (User Story US-34).

### portefeuille.positions

| Colonne | Type | Description |
|---------|------|-------------|
| compte_id + instrument_id | UNIQUE | Une ligne par (compte, instrument) |
| quantite | NUMERIC(18,6) | Quantité détenue (≥ 0) |
| prix_revient_moyen | NUMERIC(18,4) | PRMP — prix de revient moyen pondéré |

---

### ordres.ordres

| Colonne | Type | Valeurs / Contraintes |
|---------|------|----------------------|
| id | UUID PK | |
| compte_id | UUID FK | ON DELETE RESTRICT |
| instrument_id | UUID FK | ON DELETE RESTRICT |
| sens | VARCHAR(10) | `achat` / `vente` |
| type_ordre | VARCHAR(15) | `marche` / `limite` / `stop` / `stop_limite` / `iceberg` / `cache` / `pegged` / `offset` |
| quantite | NUMERIC(18,6) | > 0 |
| prix_limite | NUMERIC(18,4) | Requis pour limite/stop_limite/iceberg/cache. Interdit pour marche/stop |
| time_in_force | VARCHAR(3) | `day` / `gtc` / `ioc` / `fok` / `opg` / `atc` / `gfx` / `gfa` / `gfs` / `gtd` / `gtt` / `cpx` |
| stop_px | NUMERIC(18,4) | Tag 99 — requis pour stop/stop_limite |
| display_qty | NUMERIC(18,6) | Tag 1138 — Iceberg : quantité affichée (< quantite) |
| display_method | VARCHAR(10) | `random` / `hidden` (Tag 1084) |
| min_qty | NUMERIC(18,6) | Tag 110 MES — Pegged |
| pre_trade_anonymity | VARCHAR(1) | `Y` (défaut, anonyme) / `N` (Named) |
| expire_time | TIMESTAMPTZ | Tag 126 — GTT |
| expire_date | DATE | Tag 432 — GTD |
| offset_bp | NUMERIC(9,4) | Tag 27018 — points de base pour Offset |
| group_id | VARCHAR(3) | Tag 27017 — bucket Mass Cancel [1-255]. `'0'` = non groupé |
| statut | VARCHAR(22) | `en_attente` / `execute` / `partiellement_execute` / `annule` / `rejete` / `expire` |
| motif_rejet | VARCHAR(30) | `solde_insuffisant` / `position_insuffisante` / `marche_ferme` |
| date_creation, date_maj | TIMESTAMPTZ | |

### ordres.executions

| Colonne | Type | Description |
|---------|------|-------------|
| ordre_id | UUID FK UNIQUE | Relation 1-1 avec l'ordre |
| prix_execution | NUMERIC(18,4) | Prix réel d'exécution |
| quantite_executee | NUMERIC(18,6) | |
| montant_total | NUMERIC(18,2) | |
| horodatage_execution | TIMESTAMPTZ | |

---

### historique.mouvements_compte

| Colonne | Type | Description |
|---------|------|-------------|
| id | BIGSERIAL PK | |
| compte_id | UUID FK | |
| type_mouvement | VARCHAR(20) | `execution_achat` / `execution_vente` / `depot` / `retrait` |
| montant | NUMERIC(18,2) | Positif = crédit, négatif = débit |
| instrument_id | UUID FK nullable | Null pour dépôts/retraits |
| quantite | NUMERIC(18,6) nullable | |
| ordre_id | UUID FK nullable | ON DELETE SET NULL |
| reference_externe | VARCHAR(140) | Migration douce — référence banque inter-service |
| horodatage | TIMESTAMPTZ | Index sur (compte_id, horodatage DESC) |

---

### administration.parametres_securite

| Colonne | Plage | Défaut |
|---------|-------|--------|
| max_tentatives_echouees | 3–10 | 5 |
| duree_expiration_session_minutes | 5–120 | 30 |

### administration.parametres_otp

| Colonne | Valeurs | Défaut |
|---------|---------|--------|
| otp_actif_global | bool | false |
| otp_frequence_type | `chaque_connexion` / `apres_n_jours` / `apres_n_connexions` | chaque_connexion |
| otp_frequence_valeur | int | — |

### administration.otp_utilisateur

| Colonne | Description |
|---------|-------------|
| otp_active | OTP activé pour cet investisseur |
| date_derniere_verif_otp | Dernière vérification OTP réussie |
| nb_connexions_depuis_derniere_verif | Compteur pour fréquence par connexions |

### administration.parametres_plateforme

| Colonne | Description |
|---------|-------------|
| devise_par_defaut | ISO 4217 (défaut : `EUR`) — appliquée aux nouveaux comptes via trigger |

---

## 10. API REST — Tous les endpoints

### Supervision (sans authentification)

| Méthode | Endpoint | Description |
|---------|---------|-------------|
| GET | `/api/health` | Health check — retourne `{"statut":"ok"}` |
| GET | `/api/config` | Config publique frontend : `banque_frontend_url` |

### Administration (rôle : administrateur)

| Méthode | Endpoint | Description |
|---------|---------|-------------|
| GET | `/api/admin/parametres-securite` | Lire paramètres de sécurité |
| PUT | `/api/admin/parametres-securite` | Modifier — synchronise vers Keycloak (Brute Force + Session Idle) |
| GET | `/api/admin/parametres-otp` | Lire configuration OTP globale |
| PUT | `/api/admin/parametres-otp` | Modifier OTP global (activer, régler fréquence) |
| GET | `/api/admin/parametres-devise` | Lire la devise par défaut |
| PUT | `/api/admin/parametres-devise` | Modifier (s'applique aux nouveaux comptes uniquement) |
| GET | `/api/admin/utilisateurs/{id}/otp` | Lire config OTP d'un investisseur |
| PUT | `/api/admin/utilisateurs/{id}/otp` | Activer/désactiver OTP pour un investisseur |

### Investisseur (self-service)

| Méthode | Endpoint | Description |
|---------|---------|-------------|
| GET | `/api/utilisateurs/moi/otp` | Lire son propre état OTP |
| PUT | `/api/utilisateurs/moi/otp` | Modifier son état OTP |
| DELETE | `/api/utilisateurs/moi` | Supprimer définitivement son compte (PostgreSQL + Keycloak). Utilisé par les tests E2E pour nettoyage. |
| POST | `/forgot-password` | Demander un code OTP de réinitialisation par email (Resend) |
| POST | `/verify-reset-code` | Vérifier le code OTP (expire après 10 min) |
| POST | `/reset-password` | Réinitialiser le mot de passe après vérification |

### Ordres (rôle : investisseur)

Préfixe : `/api/ordres`. Chaque ordre passe par le moteur FIX simulé.

| Méthode | Endpoint | Description |
|---------|---------|-------------|
| GET | `/api/ordres` | Lister ses ordres (filtres : statut, instrument, sens, dates, pagination) |
| POST | `/api/ordres` | Passer un ordre (voir corps ci-dessous) |
| PUT | `/api/ordres/{id}/annuler` | Annuler un ordre en attente (Cancel Request 35=F) |
| PUT | `/api/ordres/{id}/modifier` | Modifier quantité/prix/group_id d'un ordre vivant (Cancel/Replace 35=G) |
| PUT | `/api/ordres/annuler-tout` | Mass Cancel (35=q) : tout / par instrument / par groupe / par instrument+groupe |
| GET | `/api/ordres/carnet/{symbol}` | Snapshot du carnet d'ordres interne (bids/asks top 10) |

#### Corps de la requête POST /api/ordres

```json
{
  "instrument_code": "ATW",
  "sens": "achat",
  "type_ordre": "limite",
  "quantite": 100,
  "prix_limite": 42.50,
  "time_in_force": "day",

  "stop_px": 40.00,
  "display_qty": 20,
  "display_method": "random",
  "min_qty": 10,
  "pre_trade_anonymity": "Y",
  "expire_date": "2026-12-31",
  "expire_time": "2026-08-10T14:00:00Z",
  "offset_bp": 10.0,
  "group_id": "42",
  "passive_only": false
}
```

### Portefeuille (rôle : investisseur)

| Méthode | Endpoint | Description |
|---------|---------|-------------|
| POST | `/api/portefeuille/creer` | Créer le compte espèces (automatique à l'inscription) |
| GET | `/api/portefeuille` | Lire son portefeuille : solde, positions, mouvements |
| POST | `/api/portefeuille/comptes-titres/ouvrir` | Ouvrir un compte titres (type : actions/obligations/opcvm/mixte) |
| GET | `/api/portefeuille/comptes-titres` | Lister ses comptes titres |
| GET | `/api/portefeuille/comptes-titres/inter-service` | Endpoint inter-service pour la banque |
| POST | `/api/portefeuille/depot` | Déposer des fonds (appel inter-service depuis la banque) |
| POST | `/api/portefeuille/crediter-compte-test` | Créditer un compte (dev/test uniquement) |

### Market Data

| Méthode | Endpoint | Authentification | Description |
|---------|---------|-----------------|-------------|
| GET | `/api/market/orderbook/{ticker}` | Public | Carnet d'ordres BVC temps réel (bid/ask + 10 dernières transactions). Scrape casablanca-bourse.com |

### SSO Inter-service

Toutes les routes inter-service nécessitent le header `X-Inter-Service-Token: <INTER_SERVICE_TOKEN>`.

| Méthode | Endpoint | Auth | Description |
|---------|---------|------|-------------|
| GET | `/api/sso/existe` | inter-service | Vérifie si un email banque a un compte Keycloak bourse |
| GET | `/api/sso/est-lie` | investisseur | Vérifie si l'investisseur possède aussi un compte banque |
| GET | `/api/sso/status-banque` | investisseur | Retourne le statut de session banque |
| POST | `/api/sso/logout-banque` | inter-service | Notifie la bourse d'une déconnexion banque (blacklist mémoire) |
| GET | `/api/sso/heartbeat` | investisseur | Vérifie que le JWT investisseur est toujours valide |
| GET | `/api/sso/generate-handoff` | investisseur | Génère un token court-vécu (2 min) pour naviguer bourse → banque |
| GET | `/api/sso/exchange-handoff` | inter-service | Échange le token handoff contre un access_token bourse |
| GET | `/api/sso/web-exchange` | inter-service | Échange de token web (flow SSO banque → bourse via URL redirect) |
| GET | `/api/sso/generate-tokens-for-user` | inter-service | Génère des tokens Keycloak bourse pour un email donné |

### SCA — Authentification forte

| Méthode | Endpoint | Auth | Description |
|---------|---------|------|-------------|
| POST | `/api/sca/envoyer-otp` | investisseur | Génère et envoie OTP 6 chiffres par email (Resend). Valide 10 min. |
| POST | `/api/sca/verifier` | investisseur | Vérifie le code OTP → crée une session SCA (15 min TTL en mémoire) |

---

## 11. WebSockets

| Endpoint | Source | Format payload | Comportement |
|---------|--------|----------------|--------------|
| `ws://<host>/ws/market` | Kafka topic `market.prices` | `{"evenement":"bvc_snapshot","horodatage":"...","donnees":{"overview":{},"stocks":{}}}` | Thread daemon Kafka → broadcast asyncio. Replay du dernier snapshot à la connexion. Consumer group unique par pod (`ws-market-{uuid}`). |
| `ws://<host>/ws/market-global` | Twelve Data API REST | Tableau de `{symbol, label, type, price, change_percent}` | Poll toutes les `TWELVE_DATA_REFRESH_SEC` secondes. Gestion 429 avec backoff. |

Symboles Twelve Data : `QQQ`, `SPY`, `EWQ`, `USO`, `XAU/USD`, `BTC/USD`, `ETH/USD`, `EUR/USD`

---

## 12. Protocole FIX MIT202

### Vue d'ensemble

La plateforme simule le comportement du **London Stock Exchange Millennium Exchange**, protocole **FIX 5.0/FIXT.1.1** conforme à la spécification **MIT202**, avec les horaires de la Bourse de Casablanca (Africa/Casablanca).

- Séparateur de champ : `SOH` (0x01)
- Matching : Price-time priority
- Carnet d'ordres : en mémoire, par instrument

### Messages FIX

| Tag 35 | Nom | Direction | Déclencheur |
|--------|-----|-----------|------------|
| D | New Order Single | Client → Marché | POST /api/ordres |
| F | Order Cancel Request | Client → Marché | PUT /api/ordres/{id}/annuler |
| G | Order Cancel/Replace Request | Client → Marché | PUT /api/ordres/{id}/modifier |
| q | Mass Cancel Request | Client → Marché | PUT /api/ordres/annuler-tout |
| 8 | Execution Report | Marché → Client | Résultat matching |
| 9 | Order Cancel Reject | Marché → Client | Échec cancel/replace |
| r | Mass Cancel Report | Marché → Client | Résultat mass cancel |
| 3 | Session Reject | Marché → Client | Message malformé |
| j | Business Message Reject | Marché → Client | Règle métier violée |

### Tags FIX principaux

| Tag | Nom | Valeurs clés |
|-----|-----|-------------|
| 35 | MsgType | D/F/G/q/8/9/r/3/j |
| 40 | OrdType | 1=Market, 2=Limit, 3=Stop, 4=Stop Limit, P=Pegged, W=Offset |
| 54 | Side | 1=Buy, 2=Sell |
| 59 | TimeInForce | 0=Day, 2=OPG, 3=IOC, 4=FOK, 6=GTD, 7=ATC, 8=GFX, 9=GFA, C=GFS |
| 39 | OrdStatus | 0=New, 1=PartialFill, 2=Filled, 4=Canceled, 8=Rejected, A=Pending, C=Expired |
| 150 | ExecType | 0=New, F=Trade, 4=Canceled, 8=Rejected, D=Restated, C=Expired, 5=Replaced |
| 99 | StopPx | Stop/Stop Limit — prix déclencheur |
| 126 | ExpireTime | GTT — expire à cette heure (utilisé avec TIF=GTD) |
| 432 | ExpireDate | GTD — expire à cette date (format YYYYMMDD) |
| 1084 | DisplayMethod | 1=Random, 2=Hidden |
| 1138 | DisplayQty | Quantité affichée Iceberg |
| 110 | MinQty | Minimum Execution Size (Pegged) |
| 1091 | PreTradeAnonymity | Y=Anonyme (défaut), N=Named |
| 27010 | PassiveOnlyOrder | 0=None, 99=No visible match, 100=New visible BBO, 1=At/join BBO, 2=Within 1 tick, 3=Within 2 ticks |
| 27017 | GroupID | Bucket Mass Cancel [1-255], 0=non groupé |
| 27018 | Offset | Points de base vs DRP (ordres Offset) |
| 336 | TradingSessionID | `"a"` = Closing Price Crossing (CPX) |
| 452 | PartyRole | 76=TraderGroup, 12=ExecTrader, 38=ClientID |
| 378 | ExecRestatementReason | 3=Market option, 10=Partial decline, 99=Iceberg replenishment |

### TimeInForce — Mappings API ↔ FIX

| Valeur API | Tag 59 FIX | Notes |
|------------|-----------|-------|
| `day` | `0` (Day) | Défaut — expire en fin de séance |
| `gtc` | `0` (Day) | ⚠️ GTC n'existe pas dans MIT202 — mappé sur Day |
| `ioc` | `3` (IOC) | Immediate Or Cancel |
| `fok` | `4` (FOK) | Fill Or Kill |
| `opg` | `2` (OPG) | At the Opening — enchère d'ouverture |
| `atc` | `7` (ATC) | At the Close — enchère de clôture. Requis pour Offset. |
| `gfx` | `8` | Good For Auction EDSP |
| `gfa` | `9` | Good For next Auction |
| `gfs` | `C` | Good For next Scheduled auction |
| `gtd` | `6` (GTD) | Good Till Date — `expire_date` (tag 432) requis |
| `gtt` | `6` (GTD) | ⚠️ Mapping — GTD + ExpireTime (126). `expire_time` requis. |
| `cpx` | `0` (Day) | ⚠️ CPX n'est pas une TIF — c'est Day + TradingSessionID=`"a"` (336) |

---

## 13. Moteur de matching

Fichier : `backend/app/services/fix_engine.py`

### Architecture

Carnet d'ordres en mémoire (`OrderBook` par instrument), matching price-time priority. Thread-safe. Rechargé depuis la DB au démarrage via `reload_order_book()`.

### Fonctions principales

| Fonction | Message entrant | Retour |
|----------|----------------|--------|
| `process_new_order(fix_msg)` | 35=D New Order Single | Execution Report 35=8 (New, Trade, Rejected) |
| `process_cancel(fix_msg)` | 35=F Cancel Request | Exec Report (Canceled) ou Cancel Reject 35=9 |
| `process_replace(fix_msg)` | 35=G Cancel/Replace | Exec Report (Replaced) ou Cancel Reject 35=9 |
| `process_mass_cancel(fix_msg)` | 35=q Mass Cancel | Mass Cancel Report 35=r |
| `get_order_book_snapshot(symbol)` | — | Dict bids/asks top 10 |
| `reload_order_book()` | — | Charge les ordres `en_attente` depuis PostgreSQL |

### Règles de matching

- **Ordre marché (1)** : exécuté immédiatement au meilleur prix disponible côté opposé. Rejeté si marché fermé.
- **Ordre limite (2)** : exécuté si le prix limite est satisfait, sinon placé dans le carnet.
- **Stop (3)** : déclenché quand le last price franchit StopPx — devient Market.
- **Stop Limit (4)** : idem Stop mais devient Limit au lieu de Market.
- **Iceberg** : affiche `DisplayQty` dans le carnet. Restatement (ExecType=D, reason=99) après chaque exécution partielle.
- **Hidden (caché)** : `DisplayMethod=2`, aucune quantité visible. Incompatible avec PassiveOnly 100/1/2/3.
- **Pegged** : prix suivant le BBO. MES (MinQty) optionnel.
- **Offset** : DRP + `offset_bp`. TIF=ATC obligatoire. Mis en file CPX.
- **PassiveOnly (27010=99)** : rejette l'ordre s'il agresserait la liquidité visible.

### Simplifications documentées

> Les simplifications suivantes s'appliquent à ce moteur (POC/squelette) :
> - Pas de table de taille de tick (aucune contrainte de pas de cotation)
> - OPG/ATC/GFA/GFX/GFS suivent le chemin PRE_OPEN sans mécanique d'enchère dédiée
> - CPX dénouement paresseux (pas d'enchère EDSP complète)
> - DRP Offset approximé par le dernier prix négocié

---

## 14. Phases de marché BVC

| Phase | Horaire (Africa/Casablanca) | Comportement |
|-------|----------------------------|--------------|
| PRE_OPEN | 08:30 – 09:00 | Ordres acceptés et placés dans le carnet. Pas de matching. |
| CONTINUOUS | 09:00 – 15:30 | Matching continu price-time priority. |
| CLOSED | Hors horaires | Ordres Market rejetés (motif : `marche_ferme`). Ordres Limite acceptés et mis en attente. |

---

## 15. Architecture Kafka

| Attribut | Valeur |
|----------|--------|
| Mode | KRaft (sans Zookeeper) — broker + controller combinés |
| Topic principal | `market.prices` |
| Partitions | 3 |
| Replication factor | 1 (dev) |
| Consumer group WS | `ws-market-{uuid}` par pod (chaque pod reçoit tout le topic) |
| Intervalle producer | 30 s (`BVC_INTERVAL_SECONDS`) |

### Format du message Kafka (topic : market.prices)

```json
{
  "evenement": "bvc_snapshot",
  "horodatage": "2026-08-06T09:15:00+01:00",
  "donnees": {
    "overview": {
      "masi": 13642.5,
      "variation": 0.12,
      "volume": 145000000,
      "capitalisation": 850000000000
    },
    "stocks": {
      "secteur_banques": [
        {
          "ticker": "ATW",
          "open": 420.0,
          "high": 425.5,
          "low": 418.0,
          "close": 422.0,
          "volume": 12500,
          "variation_ytd": 8.5
        }
      ]
    }
  }
}
```

---

## 16. BVC Producer

Fichier : `kafka/producer_bvc_prices.py`

Scrape la Bourse de Casablanca via le Next.js Data API toutes les `BVC_INTERVAL_SECONDS` secondes (défaut : 30 s). Publie sur le topic `market.prices`.

### Endpoints scrapés

```
GET https://www.casablanca-bourse.com/_next/data/{buildId}/fr/live-market/overview.json
GET https://www.casablanca-bourse.com/_next/data/{buildId}/fr/live-market/marche-actions-groupement.json
```

### Données extraites

- OHLC (open, high, low, close)
- Volume, montant traité
- Variation annuelle YTD
- 81 instruments cotés (tickers BVC réels)

> **Note technique** : le buildId Next.js est mis en cache 10 min. La vérification SSL est désactivée sur les connexions Linux (chaîne intermédiaire BVC absente).

---

## 17. BVC Relay (serve.py)

Proxy HTTP minimal (port 8765) qui résout le blocage CORS entre le frontend Nginx et les endpoints BVC. En production, Nginx proxy_pass vers ce service sous le chemin `/api/`.

| Endpoint | Cible BVC | Cache |
|---------|----------|-------|
| GET `/api/overview` | pageProps de `/fr/live-market/overview` | Non |
| GET `/api/stocks` | pageProps de `/fr/live-market/marche-actions-groupement` | Non |
| GET `/api/buildId` | Extrait le buildId depuis la page HTML BVC | Oui (interne) |

---

## 18. Carnet d'ordres BVC (bvc_orderbook.py)

Endpoint `GET /api/market/orderbook/{ticker}` — données temps réel sans authentification BVC.

### Flux en 3 étapes

```
1. GET casablanca-bourse.com/fr/live-market/overview
   → extraire buildId (cache 10 min)

2. GET casablanca-bourse.com/_next/data/{buildId}/fr/live-market/instruments/{ticker}.json
   → extraire UUID market_watch (cache 30 s par ticker)

3. GET api.casablanca-bourse.com/fr/api/bourse_data/market_watch/{uuid}
   → retourne bids, asks, dernières transactions
```

---

## 19. Frontend Web (dashboard.html)

SPA vanilla HTML/CSS/JS, servi par Nginx sur le port 3000 (local) ou `bourse.cfconsultancy.org` (production).

### Fonctionnalités

- Authentification Keycloak Authorization Code + PKCE (client `frontend-spa`)
- Dashboard multi-onglets : Marché BVC, Portefeuille, Ordres, Marchés mondiaux
- Flux temps réel via WebSocket `/ws/market` (cotations BVC) et `/ws/market-global` (monde)
- Carnet d'ordres en temps réel par ticker (`/api/market/orderbook/{ticker}`)
- Passage d'ordres complets (tous types MIT202) avec SCA OTP email
- TradingView widget intégré pour les graphiques (~50 instruments mappés via `_BVC_TV`)
- Logos des entreprises : 68 logos via `LOGO_DOMAINS` (Google Favicon), 13 avec initiales colorées
- Bouton de navigation vers la banque digitale partenaire (SSO handoff)

### LOGO_DOMAINS — Mappings (68 entreprises)

Table `LOGO_DOMAINS` (ticker → domaine) dans `dashboard.html`. Utilise Google Favicon `https://www.google.com/s2/favicons?domain={domain}&sz=64` avec fallback initiales colorées.

**Entreprises sans logo disponible (13)** : MSA, BAL, DRI, UMR, ATL, SRM, DLM, ADI, ADH, HPS, SMI, SAM, DIS — aucun favicon accessible depuis leurs domaines connus.

### Nginx (frontend/nginx.conf)

- Fallback SPA : toutes les routes → `index.html`
- `location /api/` → `proxy_pass http://bvc-relay:8765` (BVC Relay)
- CORS déjà géré côté FastAPI, Nginx ne réécrit pas les headers

---

## 20. Back-office Admin

Frontend distinct (`admin/`), port 3001 (local) / `admin.cfconsultancy.org` (production).

- Realm Keycloak dédié : `bourse-admin`
- Accès restreint au compte `admin1`
- Fonctionnalités : paramètres sécurité, OTP global/investisseur, devise par défaut

---

## 21. Application Mobile (Expo React Native)

Répertoire : `mobile/`. Build Android/iOS via **EAS Build** (APK preview). OTA updates via **EAS Update** (channel : `production`).

### Écrans

| Écran | Fonctionnalité |
|-------|----------------|
| AccueilScreen | Tableau de bord : solde, positions, variation du portefeuille |
| MarketScreen | Cotations BVC en temps réel, graphiques TradingView WebView |
| OrdresScreen | Liste des ordres, passage d'ordres, annulation |

### Variables d'environnement EAS (`expo-constants`)

```
EXPO_PUBLIC_API_URL              = https://api.cfconsultancy.org
EXPO_PUBLIC_KEYCLOAK_URL         = https://auth.cfconsultancy.org
EXPO_PUBLIC_KEYCLOAK_REALM       = bourse-en-ligne
EXPO_PUBLIC_KEYCLOAK_CLIENT_ID   = mobile-app
EXPO_PUBLIC_BANQUE_DASHBOARD_URL = https://banquedigitale.cfconsultancy.org
EXPO_PUBLIC_MARKET_OPEN_HOUR     = 9
EXPO_PUBLIC_MARKET_CLOSE_HOUR    = 15
EXPO_PUBLIC_MARKET_CLOSE_MIN     = 30
```

---

## 22. SSO Inter-service Banque ↔ Bourse

Cinq scénarios de navigation seamless entre les deux plateformes :

### Scénario 1 — Banque → Bourse (nouveau compte bourse)

```
Banque → GET /api/sso/existe?email=...
       ← { "existe": false }
Banque → Redirige vers la page d'inscription bourse (email pré-rempli)
```

### Scénario 2 — Banque → Bourse (compte existant)

```
Banque → GET /api/sso/generate-tokens-for-user?email=...
       ← { "access_token": "...", "refresh_token": "..." }
Banque → Injecte les tokens dans le contexte bourse → connexion automatique
```

### Scénario 3 — Bourse → Banque (handoff)

```
Investisseur clique "Aller à ma banque"
Bourse → GET /api/sso/generate-handoff
       ← { "token": "abc123" } (valide 2 min)
Bourse → Redirige vers https://banquedigitale.cfconsultancy.org?handoff=abc123
Banque → GET /api/sso/exchange-handoff?token=abc123
       ← { "access_token": "..." }
```

### Scénario 4 — Logout banque propagé

```
Investisseur se déconnecte de la banque
Banque → POST /api/sso/logout-banque { "email": "..." }
Bourse → Met l'email en blacklist (mémoire)
        Au prochain heartbeat bourse → détecte la blacklist → déconnecte
```

### Scénario 5 — Dépôt inter-service

```
Investisseur initie un virement depuis la banque vers son compte bourse
Banque → POST /api/portefeuille/depot
         Headers: X-Inter-Service-Token: <secret>
         Body: { "montant": 5000.00, "devise": "EUR", "email": "...", "reference": "..." }
Bourse → Crédit du compte espèces + écriture dans historique.mouvements_compte
```

### Stores mémoire (POC)

| Store | TTL | Usage |
|-------|-----|-------|
| Logout blacklist | — | Emails banque déconnectés |
| SCA sessions | 15 min | Sessions OTP validées |
| OTP store | 10 min | Codes OTP en attente |
| Handoff tokens | 2 min | Tokens de navigation inter-service |

> **⚠️ En production** : ces stores devraient être déplacés vers Redis pour la résilience multi-pod.

---

## 23. SCA — Authentification forte sur les ordres

Strong Customer Authentication (SCA) par email OTP avant validation d'un ordre sensible (DSP2).

### Flux complet

```
1. Mobile/Frontend : POST /api/sca/envoyer-otp
   Body: { "email": "investisseur@exemple.com" }
   → Resend API envoie email avec code 6 chiffres
   → Code haché SHA-256 stocké en mémoire (TTL : 10 min)

2. Utilisateur : saisit le code reçu par email

3. POST /api/sca/verifier
   Body: { "email": "investisseur@exemple.com", "code": "123456" }
   → Vérifie le hash
   → Si valide : crée une session SCA en mémoire (TTL : 15 min)

4. POST /api/ordres (avec en-tête X-SCA-Session si requis)
```

---

*Documentation générée automatiquement · Plateforme Bourse en Ligne · cfconsultancy.org*
