# Spécification fonctionnelle — MVP Plateforme de Bourse en Ligne

## 0. Cadrage et hypothèses retenues

| # | Décision de cadrage | Implication fonctionnelle |
|---|---|---|
| 1 | Validation KYC automatique et simplifiée | Pas de file d'attente de validation manuelle, pas de rôle Compliance actif dans ce MVP |
| 2 | Sécurité de connexion paramétrable | Le nombre de tentatives échouées avant blocage (par défaut 5) et la durée d'expiration de session par inactivité (par défaut 30 minutes) sont configurables par l'administrateur, sans redéploiement |
| 3 | Marché unique | Un seul marché, avec des horaires d'ouverture/fermeture fixes, identiques pour tous les instruments |
| 4 | Types d'ordre | Ordres "au marché" (exécution au meilleur prix disponible immédiatement) **et** ordres "à cours limité" (exécution conditionnée à un seuil de prix défini par l'investisseur), pour achat et vente |
| 5 | Authentification à deux facteurs (OTP) | Disponible et paramétrable par l'administrateur (activation globale ou par utilisateur, règles de fréquence de demande configurables) |
| 6 | Réinitialisation de mot de passe | Disponible en self-service via un flow "mot de passe oublié", sans intervention du support |
| 7 | Devise du compte espèces | Paramétrable par l'administrateur (devise par défaut de la plateforme), non figée en dur ; possibilité d'une devise spécifique par utilisateur (cf. section 8 — Administration et paramétrage) |

---

## 1. Rôles utilisateurs

| Rôle | Description | Périmètre d'action principal |
|---|---|---|
| **Investisseur particulier** | Client final de la plateforme, possède un compte et un portefeuille | Inscription, connexion (avec OTP si activé), réinitialisation de mot de passe, consultation des cours, passage d'ordres au marché et à cours limité, suivi de portefeuille, consultation de l'historique |
| **Administrateur** | Gère la plateforme, les utilisateurs et les paramètres globaux | Gestion des comptes utilisateurs (activation, désactivation, déblocage), configuration des horaires de marché, gestion du référentiel d'instruments financiers, supervision globale des ordres, configuration des paramètres de sécurité (seuils de blocage, expiration de session, règles OTP), configuration de la devise de la plateforme |
| **Support client** | Assiste les investisseurs dans l'utilisation de la plateforme | Consultation (lecture seule) des comptes, portefeuilles et historiques des investisseurs, déblocage de compte suite à une demande utilisateur, aide au diagnostic d'incidents |

> **Remarque** : aucun rôle Compliance actif n'est prévu dans ce MVP. La validation KYC est entièrement automatisée (cf. règles métier section 5). Ce rôle reste identifié comme évolution future (section 6).

---

## 2. Fonctionnalités principales

### 2.1 Inscription / Connexion

| Fonctionnalité | Description |
|---|---|
| Inscription | Création d'un compte investisseur avec saisie des informations d'identité requises pour le KYC simplifié (identité, coordonnées, justificatifs déclaratifs) |
| Validation KYC automatique | Contrôle automatique et immédiat des informations saisies (cohérence, complétude, format) permettant l'activation du compte sans intervention humaine |
| Connexion | Authentification de l'utilisateur via identifiant/mot de passe, complétée le cas échéant par une vérification OTP (authentification à deux facteurs) |
| Authentification à deux facteurs (OTP) | Vérification complémentaire par code à usage unique, activable globalement par l'administrateur et/ou par utilisateur, selon des règles de fréquence paramétrables |
| Gestion des tentatives échouées | Comptage des tentatives de connexion infructueuses, blocage temporaire après un nombre d'échecs paramétrable (par défaut 5) |
| Déblocage de compte | Déblocage automatique après expiration du délai de blocage, ou déblocage manuel par le support/admin |
| Gestion de session | Session active maintenue tant que l'utilisateur interagit ; expiration automatique après une durée d'inactivité paramétrable (par défaut 30 minutes) |
| Réinitialisation de mot de passe (self-service) | L'investisseur peut, sans intervention du support, demander et réaliser la réinitialisation de son mot de passe via un flow "mot de passe oublié" |
| Déconnexion | Fermeture volontaire de la session par l'utilisateur |

### 2.2 Consultation des cours

| Fonctionnalité | Description |
|---|---|
| Liste des instruments financiers | Affichage de la liste des instruments disponibles à la négociation sur le marché unique |
| Cours en temps réel | Affichage du dernier cours connu de chaque instrument pendant les heures d'ouverture du marché |
| État du marché | Indication claire de l'état du marché (ouvert / fermé) et des horaires d'ouverture |
| Détail d'un instrument | Affichage des informations descriptives d'un instrument (nom, code, dernier cours, variation) |

### 2.3 Passage d'ordres (au marché et à cours limité)

| Fonctionnalité | Description |
|---|---|
| Passage d'ordre d'achat au marché | L'investisseur sélectionne un instrument, une quantité, et passe un ordre d'achat exécuté au meilleur prix disponible immédiatement |
| Passage d'ordre de vente au marché | L'investisseur sélectionne un instrument détenu en portefeuille, une quantité, et passe un ordre de vente exécuté au meilleur prix disponible immédiatement |
| Passage d'ordre d'achat à cours limité | L'investisseur sélectionne un instrument, une quantité et un prix limite maximal d'achat ; l'ordre reste en attente jusqu'à ce que le cours du marché atteigne ou descende sous ce prix limite, déclenchant alors son exécution |
| Passage d'ordre de vente à cours limité | L'investisseur sélectionne un instrument détenu, une quantité et un prix limite minimal de vente ; l'ordre reste en attente jusqu'à ce que le cours du marché atteigne ou dépasse ce prix limite, déclenchant alors son exécution |
| Vérification de faisabilité | Contrôle automatique du solde disponible (achat) ou de la position détenue (vente) avant acceptation de l'ordre, quel que soit son type |
| Annulation d'ordre en attente | L'investisseur peut annuler un ordre (au marché ou à cours limité) tant que celui-ci n'a pas été exécuté (statut "en attente") |
| Suivi du statut de l'ordre | L'investisseur peut consulter en temps réel le statut de ses ordres (en attente, exécuté, annulé, rejeté), quel que soit leur type |

### 2.4 Portefeuille

| Fonctionnalité | Description |
|---|---|
| Vue synthétique du portefeuille | Affichage du solde en espèces disponible (dans la devise du compte) et de la liste des positions détenues (instrument, quantité, valeur estimée) |
| Valorisation du portefeuille | Calcul de la valeur totale du portefeuille (espèces + positions valorisées au dernier cours), exprimée dans la devise du compte |
| Mise à jour en temps réel | Mise à jour des positions et du solde après exécution d'un ordre (au marché ou à cours limité) |

### 2.5 Historique

| Fonctionnalité | Description |
|---|---|
| Historique des ordres | Consultation de l'ensemble des ordres passés par l'investisseur (type d'ordre — au marché ou à cours limité —, sens achat/vente, statut, date/heure, quantité, prix limite éventuel, prix d'exécution) |
| Historique des transactions exécutées | Consultation des mouvements ayant impacté le portefeuille (exécutions d'ordres, dépôts/retraits le cas échéant), dans la devise du compte |
| Filtrage et tri | Filtrage de l'historique par période, type d'ordre, instrument, statut |

### 2.6 Administration et paramétrage

| Fonctionnalité | Description |
|---|---|
| Configuration des seuils de sécurité de connexion | L'administrateur configure le nombre de tentatives de connexion échouées avant blocage du compte (valeur par défaut : 5) |
| Configuration de l'expiration de session | L'administrateur configure la durée d'inactivité au-delà de laquelle une session est automatiquement expirée (valeur par défaut : 30 minutes) |
| Configuration de l'authentification à deux facteurs (OTP) | L'administrateur active ou désactive l'OTP globalement, ou pour des utilisateurs spécifiques, et définit les règles de fréquence de demande d'OTP (à chaque connexion, après un certain nombre de jours, après un certain nombre de connexions) |
| Configuration de la devise de la plateforme | L'administrateur définit la devise par défaut utilisée pour les comptes espèces des investisseurs |
| Application des changements sans redéploiement | Toute modification des paramètres de sécurité, d'OTP ou de devise par l'administrateur est prise en compte par la plateforme sans nécessiter d'intervention technique ou de redéploiement |

---

## 3. User stories

### 3.1 Inscription / Connexion

| ID | User story |
|---|---|
| US-01 | En tant qu'**investisseur particulier**, je veux **créer un compte en renseignant mes informations personnelles**, afin de **pouvoir accéder à la plateforme et investir** |
| US-02 | En tant qu'**investisseur particulier**, je veux **que mon compte soit validé automatiquement après inscription**, afin de **commencer à utiliser la plateforme sans délai d'attente** |
| US-03 | En tant qu'**investisseur particulier**, je veux **me connecter avec mon identifiant et mon mot de passe**, afin de **accéder à mon espace personnel et mon portefeuille** |
| US-04 | En tant qu'**investisseur particulier**, je veux **être informé du nombre de tentatives restantes en cas d'échec de connexion**, afin de **éviter le blocage de mon compte** |
| US-05 | En tant qu'**investisseur particulier**, je veux **être déconnecté automatiquement après une période d'inactivité définie par la plateforme**, afin de **protéger mon compte en cas d'oubli de déconnexion** |
| US-06 | En tant que **support client**, je veux **débloquer le compte d'un investisseur bloqué après vérification de son identité**, afin de **lui permettre de retrouver l'accès à la plateforme** |
| US-07 | En tant qu'**administrateur**, je veux **consulter la liste des comptes bloqués**, afin de **superviser les incidents de sécurité liés aux connexions** |
| US-23 | En tant qu'**investisseur particulier**, je veux **réinitialiser moi-même mon mot de passe via un lien ou un code reçu suite à une demande "mot de passe oublié"**, afin de **retrouver l'accès à mon compte sans devoir contacter le support** |
| US-24 | En tant qu'**investisseur particulier**, je veux **activer ou désactiver l'authentification à deux facteurs sur mon compte** (si cette option m'est ouverte par la plateforme), afin de **renforcer la sécurité de mon compte selon mes préférences** |
| US-25 | En tant qu'**investisseur particulier**, je veux **saisir un code de vérification (OTP) lors de ma connexion lorsque cela est requis**, afin de **confirmer mon identité avant d'accéder à mon espace personnel** |

### 3.2 Consultation des cours

| ID | User story |
|---|---|
| US-08 | En tant qu'**investisseur particulier**, je veux **consulter la liste des instruments disponibles et leurs cours actuels**, afin de **identifier des opportunités d'investissement** |
| US-09 | En tant qu'**investisseur particulier**, je veux **savoir si le marché est ouvert ou fermé**, afin de **comprendre si je peux passer un ordre immédiatement** |
| US-10 | En tant qu'**administrateur**, je veux **gérer le référentiel des instruments financiers disponibles sur le marché**, afin de **maintenir une offre de négociation à jour** |

### 3.3 Passage d'ordres

| ID | User story |
|---|---|
| US-11 | En tant qu'**investisseur particulier**, je veux **passer un ordre d'achat au marché sur un instrument**, afin de **acquérir des titres au meilleur prix disponible immédiatement** |
| US-12 | En tant qu'**investisseur particulier**, je veux **passer un ordre de vente au marché sur un instrument que je détiens**, afin de **céder mes titres au meilleur prix disponible immédiatement** |
| US-13 | En tant qu'**investisseur particulier**, je veux **être informé si mon solde ou ma position est insuffisant avant de valider un ordre**, afin de **éviter un ordre rejeté** |
| US-14 | En tant qu'**investisseur particulier**, je veux **annuler un ordre tant qu'il est en attente d'exécution**, afin de **revenir sur ma décision avant qu'elle ne soit définitive** |
| US-15 | En tant qu'**investisseur particulier**, je veux **suivre en temps réel le statut de mes ordres**, afin de **savoir si mon ordre a été exécuté, annulé ou rejeté** |
| US-16 | En tant qu'**investisseur particulier**, je veux **être empêché de passer un ordre en dehors des horaires d'ouverture du marché**, afin de **comprendre les contraintes de négociation** |
| US-26 | En tant qu'**investisseur particulier**, je veux **passer un ordre d'achat à cours limité en fixant un prix maximal**, afin de **n'acheter un instrument que si son prix descend à un niveau qui me convient** |
| US-27 | En tant qu'**investisseur particulier**, je veux **passer un ordre de vente à cours limité en fixant un prix minimal**, afin de **ne céder mes titres que si leur prix atteint un niveau qui me convient** |
| US-28 | En tant qu'**investisseur particulier**, je veux **qu'un ordre à cours limité reste en attente jusqu'à ce que le seuil de prix soit atteint**, afin de **ne pas avoir à surveiller le marché en continu** |
| US-29 | En tant qu'**investisseur particulier**, je veux **annuler un ordre à cours limité tant qu'il n'a pas été exécuté**, afin de **revoir ma stratégie si les conditions de marché changent** |

### 3.4 Portefeuille

| ID | User story |
|---|---|
| US-17 | En tant qu'**investisseur particulier**, je veux **consulter la composition de mon portefeuille (espèces et positions)**, afin de **suivre la valeur de mes investissements** |
| US-18 | En tant qu'**investisseur particulier**, je veux **voir la valeur totale de mon portefeuille mise à jour**, afin de **évaluer la performance de mes placements** |
| US-19 | En tant que **support client**, je veux **consulter en lecture seule le portefeuille d'un investisseur**, afin de **l'assister en cas de question ou de litige** |

### 3.5 Historique

| ID | User story |
|---|---|
| US-20 | En tant qu'**investisseur particulier**, je veux **consulter l'historique de tous mes ordres passés**, afin de **suivre mon activité de trading** |
| US-21 | En tant qu'**investisseur particulier**, je veux **filtrer mon historique d'ordres par période, instrument ou statut**, afin de **retrouver rapidement une opération spécifique** |
| US-22 | En tant qu'**administrateur**, je veux **consulter l'ensemble des ordres passés sur la plateforme**, afin de **assurer une supervision globale de l'activité** |

### 3.6 Administration et paramétrage

| ID | User story |
|---|---|
| US-30 | En tant qu'**administrateur**, je veux **configurer le nombre de tentatives de connexion échouées avant blocage d'un compte**, afin de **adapter le niveau de sécurité de la plateforme sans dépendre d'une mise à jour technique** |
| US-31 | En tant qu'**administrateur**, je veux **configurer la durée d'inactivité avant expiration automatique d'une session**, afin de **adapter le compromis sécurité/confort des utilisateurs** |
| US-32 | En tant qu'**administrateur**, je veux **activer ou désactiver l'authentification à deux facteurs au niveau de la plateforme ou pour un utilisateur donné**, afin de **renforcer la sécurité globale ou répondre à un besoin spécifique** |
| US-33 | En tant qu'**administrateur**, je veux **définir les règles de fréquence de demande d'OTP (à chaque connexion, après N jours, après N connexions)**, afin de **équilibrer sécurité et expérience utilisateur** |
| US-34 | En tant qu'**administrateur**, je veux **définir la devise par défaut de la plateforme pour les comptes espèces**, afin de **adapter la plateforme au marché cible sans dépendre d'une valeur figée dans le code** |

---

## 4. Critères d'acceptation détaillés

### 4.1 Connexion (intégrant les seuils de sécurité paramétrables, l'OTP et la réinitialisation de mot de passe)

**User story de référence** : US-03, US-04, US-05, US-23, US-24, US-25

| Scénario | Critères d'acceptation (Given / When / Then) |
|---|---|
| Connexion réussie (sans OTP requis) | **Given** un investisseur possède un compte actif et valide, et que l'OTP n'est pas requis pour sa connexion<br>**When** il saisit un identifiant et un mot de passe corrects<br>**Then** une session est ouverte et l'investisseur accède à son espace personnel |
| Connexion réussie avec OTP requis | **Given** un investisseur possède un compte actif et valide, et que les règles de fréquence d'OTP en vigueur imposent une vérification OTP pour cette connexion<br>**When** il saisit un identifiant et un mot de passe corrects, puis un code OTP valide<br>**Then** une session est ouverte et l'investisseur accède à son espace personnel |
| Échec de connexion par OTP invalide | **Given** un investisseur a saisi des identifiants corrects et doit fournir un OTP<br>**When** il saisit un code OTP incorrect ou expiré<br>**Then** la connexion est refusée, un message d'erreur est affiché, et l'investisseur peut redemander un nouveau code selon les règles en vigueur |
| Échec de connexion (compte non bloqué) | **Given** un investisseur saisit un mot de passe incorrect et que son compte compte moins de N tentatives échouées consécutives (N = seuil configuré par l'administrateur, par défaut 5)<br>**When** il valide la tentative de connexion<br>**Then** la connexion est refusée, le compteur de tentatives échouées est incrémenté, et un message d'erreur générique est affiché sans préciser si l'identifiant ou le mot de passe est en cause |
| Blocage après N échecs | **Given** un investisseur a déjà accumulé N-1 tentatives de connexion échouées consécutives (N = seuil configuré par l'administrateur)<br>**When** il effectue une Nème tentative avec des identifiants incorrects<br>**Then** le compte est temporairement bloqué, un message informe l'utilisateur du blocage, et toute nouvelle tentative de connexion est refusée même avec les bons identifiants tant que le blocage est actif |
| Réinitialisation du compteur après succès | **Given** un investisseur a entre 1 et N-1 tentatives échouées enregistrées<br>**When** il se connecte avec succès<br>**Then** le compteur de tentatives échouées est remis à zéro |
| Déblocage du compte | **Given** un compte est bloqué suite à l'atteinte du seuil de tentatives échouées configuré<br>**When** le délai de blocage temporaire expire (ou qu'un déblocage manuel est effectué par le support/admin)<br>**Then** le compte redevient accessible et le compteur de tentatives échouées est remis à zéro |
| Expiration de session pour inactivité | **Given** un investisseur est connecté et n'effectue aucune action pendant la durée d'inactivité configurée par l'administrateur (par défaut 30 minutes)<br>**When** ce seuil d'inactivité est atteint<br>**Then** la session est automatiquement terminée et l'utilisateur doit se reconnecter (avec OTP si requis) pour accéder de nouveau à son espace |
| Maintien de session en cas d'activité | **Given** un investisseur est connecté<br>**When** il effectue une action sur la plateforme avant l'expiration du délai d'inactivité configuré<br>**Then** le compteur d'inactivité est réinitialisé et la session reste active |
| Déconnexion volontaire | **Given** un investisseur est connecté<br>**When** il choisit de se déconnecter<br>**Then** sa session est immédiatement terminée et il doit se réauthentifier pour accéder à nouveau à son espace |
| Demande de réinitialisation de mot de passe | **Given** un investisseur a oublié son mot de passe et accède à la fonction "mot de passe oublié"<br>**When** il indique son identifiant ou son adresse associée au compte<br>**Then** un mécanisme de vérification (lien ou code de réinitialisation) lui est transmis, sans confirmer explicitement l'existence ou non d'un compte associé |
| Réinitialisation effective du mot de passe | **Given** un investisseur a initié une demande de réinitialisation et dispose d'un lien/code de réinitialisation valide et non expiré<br>**When** il saisit ce code et définit un nouveau mot de passe conforme aux règles de robustesse en vigueur<br>**Then** son mot de passe est mis à jour, le compteur de tentatives échouées est remis à zéro, et il peut se connecter avec son nouveau mot de passe |
| Échec de réinitialisation (lien/code expiré ou invalide) | **Given** un investisseur utilise un lien ou un code de réinitialisation expiré ou déjà utilisé<br>**When** il tente de définir un nouveau mot de passe<br>**Then** la demande est refusée, un message l'invite à effectuer une nouvelle demande de réinitialisation |
| Activation de l'OTP par l'investisseur | **Given** l'OTP est proposé en option au niveau de la plateforme (non imposé globalement) et l'investisseur souhaite renforcer la sécurité de son compte<br>**When** il active l'authentification à deux facteurs depuis son espace personnel<br>**Then** l'OTP devient requis pour ses connexions futures selon les règles de fréquence en vigueur |
| Désactivation de l'OTP par l'investisseur | **Given** l'OTP est activé sur le compte d'un investisseur et que la plateforme autorise la désactivation par l'utilisateur (OTP non imposé globalement par l'administrateur pour son profil)<br>**When** il désactive l'authentification à deux facteurs depuis son espace personnel<br>**Then** l'OTP n'est plus demandé lors de ses connexions futures, sauf si l'administrateur l'impose de nouveau globalement |

### 4.2 Passage d'un ordre au marché (achat ou vente)

**User story de référence** : US-11, US-12, US-13, US-14, US-15, US-16

| Scénario | Critères d'acceptation (Given / When / Then) |
|---|---|
| Passage d'un ordre d'achat au marché — succès | **Given** le marché est ouvert et l'investisseur dispose d'un solde en espèces suffisant (dans la devise de son compte) pour couvrir le montant estimé de l'achat<br>**When** il sélectionne un instrument, indique une quantité et valide un ordre d'achat au marché<br>**Then** l'ordre est accepté avec le statut "en attente", puis exécuté au meilleur prix disponible, le solde en espèces est débité du montant correspondant, et la position de l'instrument dans le portefeuille est augmentée de la quantité achetée |
| Passage d'un ordre de vente au marché — succès | **Given** le marché est ouvert et l'investisseur détient une quantité suffisante de l'instrument concerné dans son portefeuille<br>**When** il sélectionne cet instrument, indique une quantité inférieure ou égale à sa position détenue et valide un ordre de vente au marché<br>**Then** l'ordre est accepté avec le statut "en attente", puis exécuté au meilleur prix disponible, la position de l'instrument est diminuée de la quantité vendue, et le solde en espèces est crédité du montant correspondant (dans la devise du compte) |
| Rejet pour solde insuffisant (achat) | **Given** le marché est ouvert mais le solde en espèces de l'investisseur est inférieur au montant estimé de l'ordre d'achat<br>**When** il tente de valider l'ordre<br>**Then** l'ordre est rejeté avant exécution, son statut est "rejeté", et un message explicite indique l'insuffisance de solde |
| Rejet pour position insuffisante (vente) | **Given** le marché est ouvert mais l'investisseur ne détient pas la quantité demandée de l'instrument (ou ne le détient pas du tout)<br>**When** il tente de valider l'ordre de vente<br>**Then** l'ordre est rejeté avant exécution, son statut est "rejeté", et un message explicite indique l'insuffisance de position |
| Refus hors horaires de marché | **Given** le marché est fermé (hors des horaires d'ouverture fixes définis pour le marché unique)<br>**When** l'investisseur tente de passer un ordre d'achat ou de vente au marché<br>**Then** la saisie/validation de l'ordre est refusée, et un message indique les horaires d'ouverture du marché |
| Annulation d'un ordre en attente — succès | **Given** un investisseur a passé un ordre dont le statut est "en attente" et qui n'a pas encore été exécuté<br>**When** il demande l'annulation de cet ordre<br>**Then** l'ordre passe au statut "annulé", aucun débit/crédit n'est appliqué au solde ou aux positions, et l'ordre apparaît comme annulé dans l'historique |
| Annulation impossible — ordre déjà exécuté | **Given** un ordre a déjà été exécuté (statut "exécuté")<br>**When** l'investisseur tente de l'annuler<br>**Then** la demande d'annulation est refusée et un message indique que l'ordre ne peut plus être annulé |
| Suivi du statut après exécution | **Given** un ordre au marché a été exécuté avec succès<br>**When** l'investisseur consulte la liste de ses ordres<br>**Then** l'ordre apparaît avec le statut "exécuté", la quantité, le prix d'exécution et l'horodatage de l'exécution |

### 4.3 Passage d'un ordre à cours limité (achat ou vente)

**User story de référence** : US-26, US-27, US-28, US-29

| Scénario | Critères d'acceptation (Given / When / Then) |
|---|---|
| Création d'un ordre d'achat à cours limité — succès | **Given** le marché est ouvert (ou les conditions de soumission d'ordres à cours limité hors séance sont autorisées par la plateforme) et l'investisseur dispose d'un solde en espèces suffisant pour couvrir le montant correspondant à la quantité et au prix limite indiqués<br>**When** il sélectionne un instrument, indique une quantité, un prix limite maximal d'achat, et valide<br>**Then** l'ordre est accepté avec le statut "en attente", et reste en attente jusqu'à ce que le cours de l'instrument atteigne ou descende sous le prix limite indiqué |
| Création d'un ordre de vente à cours limité — succès | **Given** l'investisseur détient une quantité suffisante de l'instrument concerné<br>**When** il sélectionne cet instrument, indique une quantité inférieure ou égale à sa position détenue, un prix limite minimal de vente, et valide<br>**Then** l'ordre est accepté avec le statut "en attente", et reste en attente jusqu'à ce que le cours de l'instrument atteigne ou dépasse le prix limite indiqué |
| Rejet pour solde insuffisant (achat à cours limité) | **Given** le solde en espèces de l'investisseur est inférieur au montant correspondant à la quantité multipliée par le prix limite indiqué<br>**When** il tente de valider l'ordre d'achat à cours limité<br>**Then** l'ordre est rejeté avant acceptation, son statut est "rejeté", et un message explicite indique l'insuffisance de solde |
| Rejet pour position insuffisante (vente à cours limité) | **Given** l'investisseur ne détient pas la quantité demandée de l'instrument (ou ne le détient pas du tout)<br>**When** il tente de valider l'ordre de vente à cours limité<br>**Then** l'ordre est rejeté avant acceptation, son statut est "rejeté", et un message explicite indique l'insuffisance de position |
| Exécution conditionnelle d'un ordre d'achat à cours limité | **Given** un ordre d'achat à cours limité est en statut "en attente" avec un prix limite maximal défini<br>**When** le cours de l'instrument atteint ou descend sous ce prix limite pendant les horaires d'ouverture du marché<br>**Then** l'ordre est exécuté au prix limite (ou à un prix plus favorable selon la règle de meilleure exécution retenue), son statut passe à "exécuté", le solde en espèces est débité du montant correspondant, et la position de l'instrument est augmentée de la quantité achetée |
| Exécution conditionnelle d'un ordre de vente à cours limité | **Given** un ordre de vente à cours limité est en statut "en attente" avec un prix limite minimal défini<br>**When** le cours de l'instrument atteint ou dépasse ce prix limite pendant les horaires d'ouverture du marché<br>**Then** l'ordre est exécuté au prix limite (ou à un prix plus favorable selon la règle de meilleure exécution retenue), son statut passe à "exécuté", la position de l'instrument est diminuée de la quantité vendue, et le solde en espèces est crédité du montant correspondant |
| Ordre à cours limité non déclenché | **Given** un ordre à cours limité (achat ou vente) est en statut "en attente"<br>**When** le cours de l'instrument n'atteint jamais le seuil de prix défini pendant les horaires d'ouverture du marché<br>**Then** l'ordre reste au statut "en attente" sans exécution, jusqu'à annulation par l'investisseur ou (si applicable) expiration selon une durée de validité définie |
| Annulation d'un ordre à cours limité en attente — succès | **Given** un ordre à cours limité (achat ou vente) a le statut "en attente" et n'a pas encore été exécuté, même partiellement<br>**When** l'investisseur demande l'annulation de cet ordre<br>**Then** l'ordre passe au statut "annulé", aucun débit/crédit n'est appliqué au solde ou aux positions, et l'ordre apparaît comme annulé dans l'historique |
| Annulation impossible — ordre à cours limité déjà exécuté | **Given** un ordre à cours limité a déjà été exécuté (statut "exécuté") suite à l'atteinte du seuil de prix<br>**When** l'investisseur tente de l'annuler<br>**Then** la demande d'annulation est refusée et un message indique que l'ordre ne peut plus être annulé |
| Suivi du statut d'un ordre à cours limité | **Given** un investisseur a passé un ordre à cours limité<br>**When** il consulte la liste de ses ordres<br>**Then** l'ordre apparaît avec son type ("à cours limité"), son sens (achat/vente), le prix limite défini, son statut courant (en attente, exécuté, annulé, rejeté), et, s'il est exécuté, le prix d'exécution effectif et l'horodatage |

### 4.4 Administration et paramétrage de la sécurité, de l'OTP et de la devise

**User story de référence** : US-30, US-31, US-32, US-33, US-34

| Scénario | Critères d'acceptation (Given / When / Then) |
|---|---|
| Modification du seuil de tentatives échouées | **Given** un administrateur accède à la configuration des paramètres de sécurité<br>**When** il modifie le nombre de tentatives de connexion échouées avant blocage (valeur par défaut 5) vers une nouvelle valeur valide<br>**Then** la nouvelle valeur est appliquée immédiatement, sans redéploiement, à toutes les tentatives de connexion suivantes sur la plateforme |
| Modification de la durée d'expiration de session | **Given** un administrateur accède à la configuration des paramètres de sécurité<br>**When** il modifie la durée d'inactivité avant expiration de session (valeur par défaut 30 minutes) vers une nouvelle valeur valide<br>**Then** la nouvelle valeur est appliquée immédiatement, sans redéploiement, aux sessions actives et futures |
| Rejet d'une valeur de paramètre invalide | **Given** un administrateur modifie le seuil de tentatives échouées ou la durée d'expiration de session<br>**When** il saisit une valeur hors des plages acceptables définies (ex. valeur nulle, négative ou démesurée)<br>**Then** la modification est refusée et un message indique la plage de valeurs acceptable |
| Activation globale de l'OTP | **Given** un administrateur souhaite renforcer la sécurité de l'ensemble de la plateforme<br>**When** il active l'authentification à deux facteurs au niveau global<br>**Then** l'OTP devient requis pour tous les investisseurs lors de leurs connexions, selon les règles de fréquence définies, sans qu'aucun investisseur ne puisse le désactiver individuellement |
| Activation/désactivation de l'OTP pour un utilisateur spécifique | **Given** un administrateur consulte le profil d'un investisseur<br>**When** il active ou désactive l'OTP pour ce compte spécifique (alors que l'OTP n'est pas imposé globalement)<br>**Then** le paramètre est appliqué uniquement à ce compte, sans affecter les autres investisseurs |
| Configuration de la règle de fréquence d'OTP | **Given** un administrateur accède à la configuration des règles OTP<br>**When** il définit une règle de fréquence (ex. "à chaque connexion", "après N jours depuis la dernière vérification OTP réussie", "après N connexions depuis la dernière vérification OTP réussie")<br>**Then** la règle choisie est appliquée pour déterminer si un OTP est demandé lors des connexions suivantes des utilisateurs concernés |
| Configuration de la devise par défaut de la plateforme | **Given** un administrateur accède à la configuration de la devise de la plateforme<br>**When** il sélectionne une devise par défaut parmi une liste de devises supportées<br>**Then** cette devise devient la devise par défaut appliquée aux nouveaux comptes espèces créés à partir de cette modification |
| Devise des comptes existants non modifiée rétroactivement | **Given** des comptes investisseurs existants possèdent déjà une devise associée à leur compte espèces<br>**When** un administrateur modifie la devise par défaut de la plateforme<br>**Then** la devise des comptes existants n'est pas automatiquement convertie ni modifiée par ce changement |

---

## 5. Règles métier et contraintes

| Domaine | Règle métier / contrainte |
|---|---|
| **KYC simplifié** | À l'inscription, les informations déclaratives de l'investisseur sont contrôlées automatiquement (complétude, format, cohérence). Si les contrôles passent, le compte est activé immédiatement sans intervention humaine. Aucune file d'attente de validation manuelle n'existe dans ce MVP élargi. |
| **Sécurité de connexion (paramétrable)** | Après un nombre de tentatives de connexion échouées consécutives atteignant le seuil configuré par l'administrateur (valeur par défaut : 5), le compte est bloqué temporairement. Le compteur d'échecs est remis à zéro après une connexion réussie, après une réinitialisation de mot de passe réussie, ou après déblocage. Le seuil est modifiable par l'administrateur sans redéploiement, dans une plage acceptable raisonnable (ex. entre 3 et 10 tentatives, valeur exacte à confirmer). |
| **Expiration de session (paramétrable)** | Une session active expire automatiquement après une durée d'inactivité configurée par l'administrateur (valeur par défaut : 30 minutes), nécessitant une nouvelle authentification (et un nouvel OTP si requis selon les règles en vigueur). Cette durée est modifiable sans redéploiement, dans une plage acceptable raisonnable (ex. entre 5 et 120 minutes, valeur exacte à confirmer). |
| **Authentification à deux facteurs (OTP)** | L'OTP peut être imposé globalement par l'administrateur (tous les investisseurs) ou activé/désactivé au cas par cas pour des utilisateurs spécifiques. Lorsque l'OTP est imposé globalement, un investisseur ne peut pas le désactiver individuellement. La fréquence de demande d'OTP est définie par une règle paramétrable (à chaque connexion, après un nombre de jours depuis la dernière vérification réussie, ou après un nombre de connexions depuis la dernière vérification réussie). |
| **Réinitialisation de mot de passe** | Un investisseur peut initier une réinitialisation de mot de passe via un flow "mot de passe oublié", sans intervention du support. Le mécanisme de réinitialisation (lien ou code) a une durée de validité limitée et ne peut être utilisé qu'une seule fois. Une réinitialisation réussie remet à zéro le compteur de tentatives de connexion échouées. |
| **Marché unique et horaires fixes** | Tous les instruments financiers sont négociés sur un seul marché, avec des horaires d'ouverture et de fermeture fixes et identiques pour tous les instruments. Aucun ordre au marché ne peut être exécuté en dehors de ces horaires ; les ordres à cours limité ne peuvent être exécutés que pendant ces horaires, même s'ils peuvent rester en attente hors séance. |
| **Types d'ordre** | Deux types d'ordre sont pris en charge : "au marché" (exécution immédiate au meilleur prix disponible pendant les horaires d'ouverture) et "à cours limité" (exécution conditionnée à l'atteinte d'un seuil de prix défini par l'investisseur, à l'achat comme à la vente). |
| **Vérification du solde (achat)** | Tout ordre d'achat (au marché ou à cours limité) doit être préalablement validé par un contrôle du solde en espèces disponible de l'investisseur, dans la devise de son compte. Pour un ordre à cours limité, le contrôle se base sur le montant correspondant à la quantité multipliée par le prix limite indiqué. Un solde insuffisant entraîne un rejet automatique de l'ordre. |
| **Vérification de la position (vente)** | Tout ordre de vente (au marché ou à cours limité) doit être préalablement validé par un contrôle de la position détenue par l'investisseur sur l'instrument concerné. Une position insuffisante entraîne un rejet automatique de l'ordre. |
| **Déclenchement des ordres à cours limité** | Un ordre d'achat à cours limité est exécuté lorsque le cours du marché atteint ou descend sous le prix limite défini. Un ordre de vente à cours limité est exécuté lorsque le cours du marché atteint ou dépasse le prix limite défini. Tant que ce seuil n'est pas atteint, l'ordre reste au statut "en attente". |
| **Statuts d'ordre** | Un ordre (au marché ou à cours limité) peut prendre les statuts suivants : **en attente** (créé, en cours de traitement ou en attente d'atteinte du seuil de prix), **exécuté** (transaction réalisée, portefeuille mis à jour), **annulé** (annulé par l'investisseur avant exécution), **rejeté** (refusé automatiquement pour non-respect d'une règle métier, ex. solde/position insuffisant ou marché fermé). |
| **Annulation d'ordre** | Un ordre (au marché ou à cours limité) ne peut être annulé que tant qu'il est au statut "en attente". Une fois exécuté, annulé ou rejeté, son statut est définitif. |
| **Mise à jour du portefeuille** | Toute exécution d'ordre (achat ou vente, au marché ou à cours limité) entraîne une mise à jour immédiate et cohérente du solde en espèces (dans la devise du compte) et des positions détenues par l'investisseur. |
| **Devise du compte espèces** | La devise du compte espèces n'est pas fixée en dur. Une devise par défaut est définie au niveau de la plateforme par l'administrateur et s'applique aux nouveaux comptes créés. Tous les montants affichés (solde, valorisation, historique des transactions) sont exprimés dans la devise du compte de l'investisseur concerné. |
| **Traçabilité** | Toute action significative (inscription, connexion, échec de connexion, vérification OTP, réinitialisation de mot de passe, blocage/déblocage de compte, passage d'ordre, annulation d'ordre, exécution d'ordre, modification de paramètres par un administrateur) doit être horodatée et conservée pour permettre une consultation ultérieure dans l'historique ou les journaux d'administration. |
| **Confidentialité des données** | Un investisseur ne peut consulter que ses propres informations (portefeuille, ordres, historique, paramètres OTP personnels). Le support client dispose d'un accès en lecture seule aux données des investisseurs dans le cadre de l'assistance. L'administrateur dispose d'une vue de supervision globale et de la capacité de configurer les paramètres de sécurité, d'OTP et de devise de la plateforme. |

---

## 6. Priorisation MVP vs évolutions futures

| Fonctionnalité / Capacité | MVP | Évolution future | Commentaire |
|---|---|---|---|
| Inscription avec KYC automatique simplifié | Oui | — | Contrôle automatique, activation immédiate |
| Validation KYC manuelle / rôle Compliance actif | Non | **Oui** | Confirmé hors MVP élargi. Ajout d'un workflow de validation manuelle et d'un rôle Compliance pour les cas complexes ou réglementés, en évolution future |
| Connexion avec seuils de sécurité paramétrables (tentatives échouées, expiration de session) | Oui | — | Valeurs par défaut (5 tentatives, 30 minutes), configurables par l'administrateur sans redéploiement |
| Authentification à deux facteurs (OTP), paramétrable | Oui | — | Activation globale ou par utilisateur, règles de fréquence configurables par l'administrateur |
| Réinitialisation de mot de passe en self-service | Oui | — | Flow "mot de passe oublié" sans intervention du support |
| Devise paramétrable du compte espèces | Oui | — | Devise par défaut configurable par l'administrateur au niveau plateforme ; application aux nouveaux comptes |
| Consultation des cours en temps réel | Oui | — | Sur le marché unique uniquement |
| Marché unique à horaires fixes | Oui | — | — |
| Marchés multiples (places boursières différentes, horaires variés) | Non | **Oui** | Extension du référentiel de marchés et gestion d'horaires différenciés |
| Ordres au marché (achat/vente) | Oui | — | Exécution immédiate au meilleur prix disponible |
| Ordres à cours limité (achat/vente) | Oui | — | Désormais en périmètre MVP : exécution conditionnée à l'atteinte d'un seuil de prix |
| Annulation d'ordre en attente (au marché et à cours limité) | Oui | — | — |
| Suivi du portefeuille (solde + positions) | Oui | — | Montants exprimés dans la devise du compte |
| Historique des ordres et transactions | Oui | — | Avec filtres de base (période, instrument, statut) ; inclut le type d'ordre et le prix limite éventuel |
| Rôle support client (lecture seule + déblocage de compte) | Oui | — | — |
| Rôle administrateur (gestion des comptes, instruments, paramètres de sécurité/OTP/devise) | Oui | — | Périmètre élargi par rapport à la version précédente |
| Notifications en temps réel (email, push) | Non | **Oui** | Alertes sur exécution d'ordre, blocage de compte, déclenchement d'un ordre à cours limité, etc. |
| Ordres conditionnels avancés (stop-loss, ordres programmés) | Non | **Oui** | S'appuie sur la disponibilité des ordres à cours limité, désormais en MVP |
| Reporting avancé / analyses de performance | Non | **Oui** | Tableaux de bord enrichis, indicateurs de performance |
| Gestion de comptes multi-devises pour un même investisseur | Non | **Oui** | Le MVP élargi prévoit une devise unique par compte ; la gestion de soldes en plusieurs devises pour un même investisseur reste une évolution future (cf. points ouverts) |

---

## 7. Points ouverts / questions de clarification

Les points suivants pourront nécessiter un approfondissement lors des phases ultérieures (architecture, implémentation) :

1. **Devise par défaut de la plateforme** : quelle devise doit être configurée par défaut au lancement (ex. EUR, USD, MAD) ? Cette valeur initiale doit être confirmée par l'administrateur/le tuteur du projet.
2. **Devise par compte vs devise unique plateforme** : pour ce MVP élargi, chaque compte investisseur a-t-il une devise propre définie à la création (héritée de la devise par défaut de la plateforme au moment de la création), ou tous les comptes partagent-ils strictement la même devise tant que l'administrateur ne change pas le paramètre global ? Si la devise est définie par compte à la création, peut-elle être modifiée ultérieurement pour un compte existant, et si oui selon quelles règles (conversion, blocage temporaire) ?
3. **Alimentation du compte espèces** : comment l'investisseur approvisionne-t-il son solde en espèces (dépôt, virement) ? Ce flux est-il dans le périmètre du MVP ou hors périmètre (solde initial fictif/de démonstration) ?
4. **Frais de transaction** : des frais sont-ils appliqués sur les ordres exécutés (commission, taxe), pour les ordres au marché et/ou à cours limité ?
5. **Durée précise du blocage de compte** : quelle est la durée du blocage temporaire après atteinte du seuil de tentatives échouées (ex. 15 minutes, 1 heure) avant déblocage automatique ? Cette durée est-elle elle-même paramétrable par l'administrateur, au même titre que le seuil de tentatives et la durée d'inactivité ?
6. **Plages acceptables des paramètres de sécurité** : quelles sont les bornes minimales et maximales acceptables pour le nombre de tentatives échouées avant blocage et pour la durée d'expiration de session par inactivité (ex. 3 à 10 tentatives, 5 à 120 minutes) ?
7. **Canal de transmission de l'OTP** : par quel canal l'OTP est-il transmis à l'investisseur (email, SMS, application d'authentification) ? Ce choix est-il configurable par l'administrateur ou par l'investisseur ?
8. **Validité et expiration des ordres à cours limité** : un ordre à cours limité non exécuté reste-t-il en attente indéfiniment, ou existe-t-il une durée de validité au-delà de laquelle il est automatiquement annulé ou expiré ?
9. **Règle de meilleure exécution pour les ordres à cours limité** : lorsqu'un ordre à cours limité est déclenché, est-il exécuté strictement au prix limite indiqué, ou au meilleur prix disponible si celui-ci est plus favorable que le prix limite ?
10. **Horaires précis du marché** : quels jours et plages horaires définissent l'ouverture du marché unique (ex. jours ouvrés, plage horaire fixe) ?
