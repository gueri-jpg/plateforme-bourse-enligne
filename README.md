# Plateforme de Bourse en Ligne — BVC

**Stage S8 — École Centrale Casablanca — 2025/2026**

## Objectif

Construire le **squelette technique d'une plateforme de bourse en ligne** connectée à la Bourse des Valeurs de Casablanca (BVC), couvrant :

- L'authentification SSO sécurisée via Keycloak (OAuth2 / OIDC + PKCE)
- Le streaming temps réel des cotations BVC via un pipeline Kafka → WebSocket
- La gestion des comptes, ordres, portefeuilles et paramètres métier (PostgreSQL)
- Un back-office administrateur isolé sur un realm Keycloak dédié

## Avancement du projet

| Phase | Contenu | Statut |
|-------|---------|--------|
| **Phase 1 — Architecture** | Schéma BDD, realm Keycloak, topics Kafka, docker-compose | ✅ Terminé |
| **Phase 2 — Pipeline market data** | Scraper BVC → Kafka → WebSocket → Frontend temps réel | ✅ Terminé |
| **Phase 3 — Dashboard trading** | Watchlist, portefeuille, ordres, historique, statuts | ✅ Terminé |
| **Phase 4 — Back-office admin** | Realm séparé, CMS admin port 3001, gestion paramètres | ✅ Terminé |
| **Phase 5 — Application mobile** | React Native + Expo, repo séparé | ✅ En cours |

## Pipeline de données marché

```
casablanca-bourse.com
        │
        │ HTTPS scrape toutes les 30s
        ▼
kafka/producer_bvc_prices.py
        │ publie JSON (bvc_snapshot)
        ▼
Apache Kafka ── topic: market.prices
        │ consomme
        ▼
backend/app/ws_market.py (FastAPI)
        │ diffuse via WebSocket /ws/market
        ▼
dashboard.html (navigateur)
        │ parseOverview() + parseStocks()
        ▼
Affichage MASI + 80 cotations en quasi temps réel
```

Le scraper détecte automatiquement si les données sont gelées (`_stale`) et le signale au frontend.

## Stack technique

### Backend & Infrastructure

| Composant | Technologie |
|-----------|-------------|
| Authentification | **Keycloak 26** — OAuth2 / OIDC + PKCE, deux realms |
| Base de données | **PostgreSQL 16** — 5 schémas métier |
| Streaming | **Apache Kafka 7.7** (mode KRaft, sans Zookeeper) |
| API REST | **FastAPI** (Python 3.11) + Uvicorn |
| Serveur web | **Nginx** (Alpine) — proxy WebSocket + fichiers statiques |
| Conteneurisation | **Docker** + Docker Compose |

### Frontend

| Composant | Technologie |
|-----------|-------------|
| Dashboard trading | HTML5 / CSS3 / JavaScript vanilla (ES Modules) |
| Back-office admin | HTML5 / CSS3 / JavaScript vanilla (ES Modules) |
| Authentification | PKCE natif (`js/pkce.js` + `js/auth.js`) + sessionStorage |
| Données temps réel | WebSocket natif (primaire) + polling HTTP serve.py (secours) |
| Stockage local | localStorage par utilisateur (préfixé par Keycloak `sub`) |

### Données marché

| Source | Méthode | Fréquence |
|--------|---------|-----------|
| casablanca-bourse.com | Scraping Next.js `/_next/data/` | Toutes les 30s |
| MASI intraday | Série `transactTime` + `indexValue` (500 ticks max) | À chaque snapshot |
| 80 actions BVC | `field_cours_courant`, `field_var_veille`, bid/ask, volumes | À chaque snapshot |

## Rôles utilisateurs

| Rôle | Realm Keycloak | Accès |
|------|----------------|-------|
| `investisseur` | `bourse-en-ligne` | Marché live, watchlist, portefeuille, ordres, historique |
| `support_client` | `bourse-en-ligne` | Consultation marché + section assistance (lecture seule) |
| `administrateur` | `bourse-admin` | Back-office admin port 3001 uniquement (realm isolé) |

## Pages et interfaces

### Plateforme investisseurs (port 3000)

| Fichier | Rôle |
|---------|------|
| `frontend/index.html` | Page publique — cotations BVC live, hero section |
| `frontend/dashboard.html` | Dashboard trading authentifié (5 onglets) |
| `frontend/callback.html` | Callback OAuth2 PKCE (échange code → tokens) |
| `frontend/js/auth.js` | Gestion tokens (stockage, décodage JWT, refresh, logout) |
| `frontend/js/trading.js` | Portefeuille, ordres, watchlist (localStorage par utilisateur) |
| `frontend/js/config.js` | URLs Keycloak, backend, clés sessionStorage |
| `frontend/js/pkce.js` | Générateur code verifier / challenge (PKCE) |

### Back-office administrateur (port 3001)

| Fichier | Rôle |
|---------|------|
| `admin/index.html` | Login admin (realm `bourse-admin`) |
| `admin/dashboard.html` | CMS admin — sécurité, OTP, devise, utilisateurs |
| `admin/callback.html` | Callback OAuth2 dédié admin |
| `admin/js/config.js` | Config pointant vers realm `bourse-admin` |

## Architecture du projet

```
plateforme-bourse-enligne/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entrypoint + lifespan Kafka
│   │   ├── config.py            # Settings pydantic (deux realms Keycloak)
│   │   ├── auth.py              # Validation JWT multi-realm (RS256 JWKS)
│   │   ├── db.py                # Connexion PostgreSQL
│   │   ├── ws_market.py         # Consumer Kafka → WebSocket broadcast
│   │   └── routers/             # Paramètres sécurité, OTP, devise, utilisateurs
│   ├── Dockerfile
│   └── requirements.txt
├── kafka/
│   ├── producer_bvc_prices.py   # Scraper BVC → topic market.prices
│   ├── limit_order_trigger.py   # Déclencheur ordres limités (US-26/29)
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── index.html               # Page publique
│   ├── dashboard.html           # Dashboard trading (5 onglets)
│   ├── callback.html
│   ├── js/                      # auth.js, trading.js, config.js, pkce.js
│   └── nginx.conf               # Proxy /ws/ → backend:8000
├── admin/
│   ├── index.html               # Login back-office
│   ├── dashboard.html           # CMS admin
│   ├── callback.html
│   ├── js/                      # config.js (realm bourse-admin), auth.js, pkce.js
│   └── nginx.conf
├── db/
│   └── init.sql                 # DDL complet — 5 schémas PostgreSQL
├── keycloak/
│   ├── realm-export.json        # Realm bourse-en-ligne (investisseurs + support)
│   └── realm-admin-export.json  # Realm bourse-admin (administrateurs)
├── docs/
│   ├── specs.md                 # User stories US-01 à US-34
│   └── architecture.md          # Architecture technique détaillée
├── docker-compose.yml
├── serve.py                     # Proxy HTTP local BVC (fallback WebSocket)
└── .env.example
```

## Fonctionnalités du dashboard

### 📊 Marché (temps réel)
- MASI intraday (valeur, variation, haut/bas, ouverture, nombre de ticks)
- Volume global et capitalisation boursière
- Largeur du marché (hausses / baisses / stables)
- Top 5 hausses et baisses de la séance
- Table complète des 80 actions avec cours, bid/ask, volumes
- Filtrage et tri multi-critères
- Flash de mise à jour à chaque nouveau cours

### ⭐ Watchlist
- Suivi personnalisé par étoile sur chaque action
- Cours mis à jour en temps réel via WebSocket
- Boutons achat/vente directs

### 💼 Portefeuille
- Solde disponible, valorisation live, plus-value latente
- Positions avec prix moyen pondéré et P&L en temps réel
- Réinitialisation (capital initial : 100 000 MAD)

### 🔄 Passer un ordre
- Achat / Vente au marché ou à cours limité
- Vérification horaires BVC (lundi–vendredi 09h00–15h30 Casablanca)
- Statuts : `en_attente` → `exécuté` | `rejeté` | `annulé`
- Réservation immédiate des fonds/titres (anti sur-engagement)
- Modal de confirmation avec double-clic protégé
- Exécution automatique des ordres limités à chaque nouveau snapshot BVC

### 📋 Historique
- Tous les ordres avec statut, date d'exécution, prix, montant
- Annulation des ordres en attente avec restitution des fonds

### ⚙️ Back-office Admin (port 3001)
- Realm Keycloak dédié (`bourse-admin`) isolé des investisseurs
- Paramètres sécurité : seuil de blocage après échecs (US-30/31)
- Configuration OTP / 2FA global et fréquence (US-32/33)
- Devise par défaut des comptes espèces (US-34)
- Vue utilisateurs du realm `bourse-en-ligne`

## Schéma PostgreSQL

```sql
-- 5 schémas métier
identite.*      -- utilisateurs, comptes, KYC, paramètres sécurité OTP
marche.*        -- instruments, cours_actuels, historique, parametres_marche
ordres.*        -- ordres (marché + limite), statuts
portefeuille.*  -- comptes espèces, positions, mouvements
administration.*-- parametres_securite, parametres_otp, parametres_devise
```

## Variables d'environnement

Copier `.env.example` vers `.env` :

```env
# PostgreSQL
POSTGRES_USER=bourse_admin
POSTGRES_PASSWORD=votre_mot_de_passe
POSTGRES_DB=bourse_db

# Keycloak (admin console)
KC_ADMIN_USERNAME=admin
KC_ADMIN_PASSWORD=votre_mot_de_passe

# Keycloak (client admin-tools backend)
KEYCLOAK_ADMIN_CLIENT_SECRET=votre_secret

# SMTP Resend (emails Keycloak)
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_FROM=votre@email.com
SMTP_FROM_DISPLAY_NAME=BourseOnline
RESEND_API_KEY=re_xxxxxxxxxxxx
```

## Démarrage rapide

### Prérequis

- Docker Desktop
- Python 3.11+ (pour `serve.py` optionnel)

### Lancement

```bash
# Cloner le repo
git clone https://github.com/gueri-jpg/plateforme-bourse-enligne.git
cd plateforme-bourse-enligne

# Configurer les variables d'environnement
cp .env.example .env
# Éditer .env avec vos valeurs

# Démarrer tous les services
docker compose up -d --build

# Vérifier l'état
docker compose ps
```

### Services démarrés

| Service | URL | Description |
|---------|-----|-------------|
| Frontend investisseurs | http://localhost:3000 | Plateforme de trading |
| Back-office admin | http://localhost:3001 | Administration (admin1) |
| Keycloak | http://localhost:9090 | Console SSO |
| Backend API | http://localhost:8000 | FastAPI + WebSocket |
| PostgreSQL | localhost:5432 | Base de données |
| Kafka | localhost:9092 | Broker de messages |

### Comptes de test

| Compte | Mot de passe | Rôle | Plateforme |
|--------|-------------|------|------------|
| `investisseur1` | `Investisseur123!` | investisseur | http://localhost:3000 |
| `support1` | `Support123!` | support_client | http://localhost:3000 |
| `admin1` | `Administrateur123!` | administrateur | http://localhost:3001 |

### Réinitialisation complète (reset données)

```bash
docker compose down -v && docker compose up -d
```

## Flux d'authentification

```
Navigateur                  Nginx :3000              Keycloak :9090
│                               │                         │
│── GET /dashboard.html ───────►│ sert fichier statique   │
│                               │                         │
│── clic "Se connecter" ───────►│ js/pkce.js génère       │
│   code_verifier + challenge   │   code_verifier/state   │
│◄── redirect Keycloak ─────────│                         │
│                               │                   realm bourse-en-ligne
│── authentification ──────────►│                         │
│◄── code + state ──────────────│                         │
│                               │                         │
│── POST /token (code_verifier)►│────────────────────────►│
│◄── access_token + id_token ───│◄────────────────────────│
│                               │                         │
│   sessionStorage tokens       │                         │
│                               │                         │
│── WebSocket /ws/market ──────►│ proxy → backend:8000    │
│◄── snapshots BVC live ────────│◄── Kafka consumer ──────│
```

## Notes techniques importantes

- **Données BVC** : l'endpoint public `/_next/data/` de casablanca-bourse.com est limité à **500 ticks intraday**. Au-delà de cette limite (~70 minutes de marché), les données MASI sont gelées jusqu'à la prochaine séance. Les cours des 80 actions restent disponibles. Le flag `_stale` dans les messages Kafka signale cet état.
- **Fallback HTTP** : si le WebSocket est indisponible, le frontend bascule automatiquement sur `serve.py` (polling HTTP toutes les 10s).
- **Isolation des données** : le localStorage est préfixé par le `sub` Keycloak — chaque investisseur a ses propres données (watchlist, portefeuille, ordres).
- **Sécurité admin** : le realm `bourse-admin` est entièrement séparé de `bourse-en-ligne`. Les tokens admin sont rejetés sur la plateforme investisseurs et vice-versa.

## User Stories couvertes

| Catégorie | US | Description |
|-----------|----|-------------|
| Connexion | US-01 à US-10 | Inscription, OTP, reset mdp, sessions, blocage |
| Consultation | US-11 à US-20 | Cours en temps réel, état du marché, détail instrument |
| Ordres | US-21 à US-29 | Achat/vente marché et limité, statuts, annulation |
| Administration | US-30 à US-34 | Sécurité, OTP, devise, paramètres plateforme |

---

_Stage S8 · École Centrale Casablanca · 2026_