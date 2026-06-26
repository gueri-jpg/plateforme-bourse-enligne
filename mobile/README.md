# BourseOnline Mobile — Application React Native

**Stage S8 — École Centrale Casablanca — 2025/2026**

> Application mobile compagnon de la [plateforme web BourseOnline](https://github.com/gueri-jpg/plateforme-bourse-enligne). Partage le même backend (FastAPI + Keycloak + Kafka).

## Objectif

Développer l'**application mobile de la plateforme de bourse en ligne BVC** permettant aux investisseurs de consulter les cotations en temps réel et gérer leur portefeuille depuis leur smartphone, avec la même authentification SSO Keycloak que la version web.

## Avancement

| Phase | Contenu | Statut |
|-------|---------|--------|
| **Phase 1 — Setup** | Expo SDK 54, React Navigation, structure projet | ✅ Terminé |
| **Phase 2 — Auth** | Keycloak OAuth2 PKCE via expo-auth-session | ✅ Terminé |
| **Phase 3 — Marché** | WebSocket BVC live, MASI, 80 cotations | ✅ Terminé |
| **Phase 4 — Profil** | Affichage claims JWT, déconnexion SSO | ✅ Terminé |
| **Phase 5 — Trading** | Portefeuille, ordres, watchlist | 🔜 À venir |

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Framework | **React Native** via **Expo SDK 54** |
| Navigation | **React Navigation 7** (Stack + Bottom Tabs) |
| Authentification | **expo-auth-session** — OAuth2 PKCE (Keycloak) |
| Stockage tokens | **AsyncStorage** (dev Expo Go) → SecureStore en production build |
| Données marché | **WebSocket natif** React Native → backend FastAPI |
| Logique trading | **AsyncStorage** par utilisateur (préfixé par Keycloak `sub`) |
| Langage | **TypeScript** |
| Test sur device | **Expo Go** (Android/iOS) |

## Connexion au backend

L'application mobile partage **le même backend** que la plateforme web :

```
Application mobile (Expo Go)
        │
        │ WebSocket ws://IP:8000/ws/market
        ▼
backend/app/ws_market.py (FastAPI)
        │
        ▼
Apache Kafka ── topic: market.prices
        │
        ▼
kafka/producer_bvc_prices.py ── casablanca-bourse.com
```

Le backend, Keycloak, Kafka et PostgreSQL sont lancés via **Docker Compose** du repo web.

## Structure du projet

```
bourse-enligne-mobile/
├── App.tsx                  # Point d'entrée — navigation Stack + Tabs
├── index.ts                 # registerRootComponent (expo)
├── screens/
│   ├── LoginScreen.tsx      # Authentification Keycloak OAuth2 PKCE
│   ├── MarcheScreen.tsx     # Cotations BVC live via WebSocket
│   └── ProfilScreen.tsx     # Profil utilisateur + déconnexion
├── hooks/
│   └── useMarketData.ts     # Hook WebSocket avec reconnexion auto
├── services/
│   ├── auth.ts              # Tokens (saveTokens, refresh, logout)
│   └── trading.ts           # Portefeuille, ordres, watchlist (AsyncStorage)
├── constants/
│   └── config.ts            # URLs backend, Keycloak, clés AsyncStorage
├── app.json                 # Config Expo (scheme, plugins)
└── package.json
```

## Fonctionnalités

### 📊 Marché (temps réel)
- Connexion WebSocket au backend partagé avec la plateforme web
- Affichage MASI (valeur, variation depuis ouverture, dernier tick)
- Volume global et capitalisation en milliards MAD
- Liste des 80 actions BVC avec cours et variation veille
- Indicateur marché ouvert / fermé (horaires BVC 09h00–15h30)
- Reconnexion automatique si le WebSocket se coupe

### 👤 Profil
- Affichage des claims Keycloak (username, nom, email, rôles)
- Déconnexion SSO complète (révocation token + fermeture session Keycloak)

### 🔑 Authentification
- Flow complet OAuth2 PKCE via `expo-auth-session`
- Realm Keycloak `bourse-en-ligne` (partagé avec plateforme web)
- Client dédié `mobile-app` (redirectUri `bourseenligne://`)
- Refresh token automatique
- Isolation des données par utilisateur (Keycloak `sub`)

## Architecture navigation

```
App.tsx
├── Stack.Navigator (headerShown: false)
│   ├── Login ─── LoginScreen.tsx   (si non connecté)
│   └── Main  ─── Tab.Navigator     (si connecté)
│               ├── Marché    ── MarcheScreen.tsx
│               └── Profil    ── ProfilScreen.tsx
```

## Prérequis

- **Node.js** 18+
- **Expo Go** installé sur le téléphone (Android ou iOS)
- **Backend web lancé** via Docker Compose ([repo web](https://github.com/gueri-jpg/plateforme-bourse-enligne))
- Téléphone et PC sur le **même réseau Wi-Fi**

## Installation et lancement

```bash
# Cloner le repo
git clone https://github.com/gueri-jpg/bourse-enligne-mobile.git
cd bourse-enligne-mobile

# Installer les dépendances
npm install --legacy-peer-deps
```

### Configurer l'IP du backend

Éditer `constants/config.ts` et remplacer l'IP par celle de votre machine :

```typescript
// Obtenir l'IP : ipconfig (Windows) → IPv4 Wi-Fi
const BACKEND_IP = '192.168.X.X';  // ← votre IP locale
```

### Lancer Metro Bundler

```powershell
# Windows — forcer l'IP Wi-Fi pour que le téléphone puisse se connecter
$env:REACT_NATIVE_PACKAGER_HOSTNAME="192.168.X.X"; npm start
```

Scanner le QR code avec **Expo Go** sur le téléphone.

> ⚠️ Le téléphone et le PC doivent être sur le même réseau Wi-Fi.  
> ⚠️ Le pare-feu Windows doit autoriser le port 8081 (Metro Bundler).

### Ouvrir le port Metro (si "Failed to download")

```powershell
# PowerShell en administrateur
netsh advfirewall firewall add rule name="Expo Metro 8081" dir=in action=allow protocol=TCP localport=8081
```

## Comptes de test

Mêmes comptes que la plateforme web (realm `bourse-en-ligne`) :

| Compte | Mot de passe | Rôle |
|--------|-------------|------|
| `investisseur1` | `Investisseur123!` | investisseur |
| `support1` | `Support123!` | support_client |

## Évolutions prévues

- [ ] Onglet Watchlist (étoile sur chaque action)
- [ ] Onglet Portefeuille (positions + P&L live)
- [ ] Formulaire de passage d'ordre (achat/vente, marché/limité)
- [ ] Historique des ordres
- [ ] Remplacement AsyncStorage → `expo-secure-store` (development build)
- [ ] Notifications push à l'exécution d'un ordre limité

## Différences avec la version web

| Fonctionnalité | Web (port 3000) | Mobile (Expo Go) |
|----------------|-----------------|------------------|
| Authentification | sessionStorage (non chiffré) | AsyncStorage → SecureStore (build) |
| Navigation | HTML tabs + CSS | React Navigation Bottom Tabs |
| Stockage trading | localStorage | AsyncStorage |
| WebSocket | WebSocket natif browser | WebSocket natif React Native |
| Back-office admin | Port 3001 dédié | Non disponible (rôle admin = back-office web) |

## Note sécurité

En mode **Expo Go** (développement), les tokens sont stockés dans `AsyncStorage` (non chiffré). Pour une version production, il faut :
1. Créer un **development build** (`npx expo run:android`)
2. Remplacer `AsyncStorage` par `expo-secure-store` dans `services/auth.ts`

---

_Stage S8 · École Centrale Casablanca · 2026_