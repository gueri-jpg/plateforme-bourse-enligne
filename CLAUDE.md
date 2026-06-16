# Plateforme de Bourse en Ligne

## Objectif
Construire le squelette technique d'une plateforme de bourse en ligne, couvrant :
- L'authentification et la gestion des utilisateurs (SSO)
- La base de données métier (comptes, ordres, instruments financiers)
- Le streaming temps réel des données de marché (cours, ordres exécutés)

## Stack technique de base
- **Authentification** : Keycloak (OAuth2 / OpenID Connect, SSO)
- **Base de données** : PostgreSQL
- **Streaming temps réel** : Apache Kafka

D'autres technologies peuvent être introduites si elles sont pertinentes pour répondre aux besoins du projet (ex : langage/framework backend, frontend, librairies). Il n'est plus nécessaire de demander une validation explicite avant de les utiliser.

## Agents disponibles
- **business-analyst** : définit les besoins fonctionnels, rôles utilisateurs, fonctionnalités et user stories.
- **architecte** : conçoit l'architecture technique (Keycloak / PostgreSQL / Kafka), schémas, flux et APIs.
- **developpeur** : implémente le code (docker-compose, SQL, configuration Keycloak, producers/consumers Kafka).

## Ordre de travail recommandé
1. **business-analyst** — clarifier les besoins métier et user stories
2. **architecte** — traduire les besoins en architecture technique (Keycloak, PostgreSQL, Kafka)
3. **developpeur** — implémenter le squelette de code conforme à l'architecture
