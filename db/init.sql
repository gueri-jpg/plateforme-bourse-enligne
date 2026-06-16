-- ============================================================================
-- Script d'initialisation PostgreSQL - Plateforme de Bourse en Ligne
--
-- Ce script est execute automatiquement au premier demarrage du conteneur
-- PostgreSQL (monte dans /docker-entrypoint-initdb.d/).
--
-- Il cree :
--   1. Une base dediee "keycloak_db" pour le stockage interne de Keycloak
--      (separee de la base metier "bourse_db", deja creee via la variable
--      d'environnement POSTGRES_DB du service postgres).
--   2. Les schemas et tables metier dans "bourse_db", conformement a
--      docs/architecture.md section 3 :
--        - identite       : utilisateurs, profil KYC, journal de securite
--        - marche         : instruments, cours, parametres du marche unique
--        - portefeuille   : comptes especes, positions
--        - ordres         : ordres au marche et a cours limite, executions
--        - historique     : mouvements de compte
--        - administration : parametres de securite, OTP et devise de la
--                            plateforme (US-23 a US-34)
-- ============================================================================


-- ----------------------------------------------------------------------
-- 1. Base de donnees dediee a Keycloak
-- ----------------------------------------------------------------------
-- Keycloak utilise sa propre base pour stocker realms, clients, utilisateurs,
-- sessions, etc. On la separe de la base metier "bourse_db" pour des raisons
-- de cloisonnement (cf. docker-compose.yml, service "keycloak").
CREATE DATABASE keycloak_db;


-- ----------------------------------------------------------------------
-- Extension utilisee pour la generation d'identifiants UUID
-- (gen_random_uuid() est fournie par l'extension pgcrypto)
-- ----------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================================
-- 2. SCHEMA "identite"
--    Reference locale des utilisateurs (miroir de l'identite Keycloak),
--    profil KYC simplifie et journal de securite (traçabilite des connexions)
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS identite;

-- Table des utilisateurs : reference applicative miroir de Keycloak.
-- Keycloak reste la source de verite pour le mot de passe et l'etat
-- d'activation/blocage (enabled, brute-force) - cf. architecture.md section 2.5.
CREATE TABLE identite.utilisateurs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Identifiant "sub" de l'utilisateur cote Keycloak (UUID unique)
    keycloak_user_id    UUID NOT NULL UNIQUE,
    email               VARCHAR(255) NOT NULL UNIQUE,
    nom                 VARCHAR(100) NOT NULL,
    prenom              VARCHAR(100) NOT NULL,
    -- Statut applicatif synchronise a des fins d'affichage/reporting
    -- (la source de verite du blocage reste Keycloak - brute force detection)
    statut              VARCHAR(20) NOT NULL DEFAULT 'actif'
                        CHECK (statut IN ('actif', 'bloque', 'desactive')),
    date_creation       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE identite.utilisateurs IS
    'Reference applicative des utilisateurs, miroir de l''identite Keycloak (US-01, US-02)';

-- Table du profil KYC simplifie, collecte a l'inscription (US-01)
-- Relation 1-1 avec utilisateurs.
CREATE TABLE identite.profil_kyc (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    utilisateur_id      UUID NOT NULL UNIQUE
                        REFERENCES identite.utilisateurs(id) ON DELETE CASCADE,
    type_piece_identite VARCHAR(50) NOT NULL,
    numero_piece        VARCHAR(100) NOT NULL,
    adresse             TEXT NOT NULL,
    date_naissance      DATE NOT NULL,
    -- Resultat du controle KYC automatique (US-02)
    statut_validation   VARCHAR(20) NOT NULL DEFAULT 'en_cours'
                        CHECK (statut_validation IN ('valide', 'rejete', 'en_cours')),
    date_validation     TIMESTAMPTZ
);

COMMENT ON TABLE identite.profil_kyc IS
    'Informations declaratives KYC controlees automatiquement a l''inscription (US-01, US-02)';

-- Table de journalisation des evenements de securite/connexion (traçabilite, US-04 a US-07)
CREATE TABLE identite.journal_securite (
    id                  BIGSERIAL PRIMARY KEY,
    utilisateur_id      UUID NOT NULL
                        REFERENCES identite.utilisateurs(id) ON DELETE CASCADE,
    type_evenement      VARCHAR(30) NOT NULL
                        CHECK (type_evenement IN (
                            'connexion_reussie',
                            'connexion_echouee',
                            'blocage',
                            'deblocage',
                            'verif_otp_reussie',
                            'verif_otp_echouee',
                            'reinitialisation_mdp',
                            'modification_parametre'
                        )),
    horodatage          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Details libres (ex: adresse IP, user-agent, motif), au format JSON
    details             JSONB
);

COMMENT ON TABLE identite.journal_securite IS
    'Journal de tracabilite des evenements de connexion/securite (US-04, US-06, US-07, specs section 5)';

-- Index pour acceleration des requetes de supervision (US-07 : comptes bloques,
-- recherche du dernier evenement par utilisateur)
CREATE INDEX idx_journal_securite_utilisateur ON identite.journal_securite (utilisateur_id, horodatage DESC);
CREATE INDEX idx_journal_securite_type ON identite.journal_securite (type_evenement);


-- ============================================================================
-- 2.5 SCHEMA "administration"
--    Parametres de configuration de la plateforme, modifiables par un
--    administrateur sans redeploiement (US-30 a US-34, architecture.md
--    section 3.7). Place avant "portefeuille" car portefeuille.comptes.devise
--    herite de administration.parametres_plateforme.devise_par_defaut.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS administration;

-- Parametres de securite de connexion, synchronises vers Keycloak
-- (Brute Force Detection / SSO Session Idle) - US-30, US-31.
-- Modelisation "ligne unique" representant la configuration courante
-- (cf. architecture.md section 3.7, note sur la modelisation).
CREATE TABLE administration.parametres_securite (
    id                                  SERIAL PRIMARY KEY,
    -- Nombre de tentatives de connexion echouees avant blocage temporaire
    -- (valeur par defaut 5, US-30)
    max_tentatives_echouees             INTEGER NOT NULL DEFAULT 5
                                        CHECK (max_tentatives_echouees BETWEEN 3 AND 10),
    -- Duree d'inactivite avant expiration automatique de session, en minutes
    -- (valeur par defaut 30, US-31)
    duree_expiration_session_minutes    INTEGER NOT NULL DEFAULT 30
                                        CHECK (duree_expiration_session_minutes BETWEEN 5 AND 120),
    date_maj                            TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Administrateur ayant effectue la derniere modification (traçabilite)
    modifie_par                         UUID REFERENCES identite.utilisateurs(id) ON DELETE SET NULL
);

COMMENT ON TABLE administration.parametres_securite IS
    'Parametres de securite de connexion (seuil de tentatives echouees, duree d''expiration de session), synchronises vers Keycloak (US-30, US-31)';

-- Ligne unique de configuration courante, avec les valeurs par defaut
-- (5 tentatives, 30 minutes - specs section 0 et 5)
INSERT INTO administration.parametres_securite (max_tentatives_echouees, duree_expiration_session_minutes)
VALUES (5, 30);


-- Parametres globaux de l'authentification a deux facteurs (OTP) - US-32, US-33
CREATE TABLE administration.parametres_otp (
    id                          SERIAL PRIMARY KEY,
    -- Indique si l'OTP est impose a tous les investisseurs (US-32)
    otp_actif_global            BOOLEAN NOT NULL DEFAULT false,
    -- Regle de frequence de demande d'OTP (US-33)
    otp_frequence_type          VARCHAR(20) NOT NULL DEFAULT 'chaque_connexion'
                                CHECK (otp_frequence_type IN (
                                    'chaque_connexion',
                                    'apres_n_jours',
                                    'apres_n_connexions'
                                )),
    -- Valeur N associee a la regle de frequence (nullable si "chaque_connexion")
    otp_frequence_valeur        INTEGER
                                CHECK (otp_frequence_valeur IS NULL OR otp_frequence_valeur > 0),
    date_maj                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    modifie_par                 UUID REFERENCES identite.utilisateurs(id) ON DELETE SET NULL
);

COMMENT ON TABLE administration.parametres_otp IS
    'Parametres globaux de l''authentification a deux facteurs : activation globale et regle de frequence (US-32, US-33)';

-- Ligne unique de configuration courante : OTP non impose globalement par defaut,
-- frequence par defaut "a chaque connexion" si l'OTP est active pour un utilisateur
INSERT INTO administration.parametres_otp (otp_actif_global, otp_frequence_type, otp_frequence_valeur)
VALUES (false, 'chaque_connexion', NULL);


-- Parametrage OTP individuel par investisseur (override, US-24, US-32)
CREATE TABLE administration.otp_utilisateur (
    utilisateur_id                      UUID PRIMARY KEY
                                        REFERENCES identite.utilisateurs(id) ON DELETE CASCADE,
    -- Etat effectif de l'OTP pour cet utilisateur (tient compte de otp_actif_global)
    otp_active                           BOOLEAN NOT NULL DEFAULT false,
    -- Date de la derniere verification OTP reussie (pour la regle "apres_n_jours")
    date_derniere_verif_otp              TIMESTAMPTZ,
    -- Nombre de connexions depuis la derniere verification OTP reussie
    -- (pour la regle "apres_n_connexions")
    nb_connexions_depuis_derniere_verif  INTEGER NOT NULL DEFAULT 0,
    date_maj                             TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE administration.otp_utilisateur IS
    'Parametrage OTP individuel par investisseur : activation/desactivation (US-24) et suivi des regles de frequence (US-32, US-33)';


-- Parametres generaux de la plateforme, dont la devise par defaut (US-34)
CREATE TABLE administration.parametres_plateforme (
    id                  SERIAL PRIMARY KEY,
    -- Devise par defaut appliquee aux nouveaux comptes especes (code ISO 4217)
    -- Valeur initiale : EUR (point ouvert specs section 7.1, choix simple par defaut)
    devise_par_defaut   CHAR(3) NOT NULL DEFAULT 'EUR',
    date_maj            TIMESTAMPTZ NOT NULL DEFAULT now(),
    modifie_par         UUID REFERENCES identite.utilisateurs(id) ON DELETE SET NULL
);

COMMENT ON TABLE administration.parametres_plateforme IS
    'Parametres generaux de la plateforme, dont la devise par defaut appliquee aux nouveaux comptes especes (US-34)';

-- Ligne unique de configuration courante : devise par defaut = EUR
INSERT INTO administration.parametres_plateforme (devise_par_defaut)
VALUES ('EUR');


-- ============================================================================
-- 3. SCHEMA "marche"
--    Referentiel des instruments financiers, cours, et parametres du
--    marche unique a horaires fixes (US-08, US-09, US-10, US-16)
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS marche;

-- Referentiel des instruments financiers negociables sur le marche unique (US-10)
CREATE TABLE marche.instruments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Code/ticker unique de l'instrument (ex: "AAPL", "TTE")
    code                VARCHAR(20) NOT NULL UNIQUE,
    nom                 VARCHAR(150) NOT NULL,
    -- Type d'instrument (action, obligation, etf, ...)
    type                VARCHAR(30) NOT NULL DEFAULT 'action',
    -- Indique si l'instrument est actuellement negociable (US-10)
    actif               BOOLEAN NOT NULL DEFAULT true,
    date_creation       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE marche.instruments IS
    'Referentiel des instruments financiers disponibles a la negociation (US-08, US-10)';

CREATE INDEX idx_instruments_actif ON marche.instruments (actif);

-- Dernier cours connu par instrument : table "cache" pour lecture rapide
-- par l'API (US-08, US-09). Mise a jour par le Market Data Feed Service.
CREATE TABLE marche.cours_actuels (
    instrument_id       UUID PRIMARY KEY
                        REFERENCES marche.instruments(id) ON DELETE CASCADE,
    dernier_prix        NUMERIC(18, 4) NOT NULL CHECK (dernier_prix >= 0),
    horodatage_maj      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Variation en pourcentage par rapport au cours precedent (affichage US-08)
    variation_pct       NUMERIC(8, 4)
);

COMMENT ON TABLE marche.cours_actuels IS
    'Dernier cours connu par instrument, alimente via le topic Kafka market.prices (US-08, US-09)';

-- Historique des cours, alimente par le Market Data Feed Service via Kafka
CREATE TABLE marche.historique_cours (
    id                  BIGSERIAL PRIMARY KEY,
    instrument_id       UUID NOT NULL
                        REFERENCES marche.instruments(id) ON DELETE CASCADE,
    prix                NUMERIC(18, 4) NOT NULL CHECK (prix >= 0),
    horodatage          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE marche.historique_cours IS
    'Historique complet des cours par instrument, alimente depuis le topic Kafka market.prices';

-- Index pour les requetes d'historique par instrument et periode
CREATE INDEX idx_historique_cours_instrument_horodatage
    ON marche.historique_cours (instrument_id, horodatage DESC);

-- Parametres du marche unique : horaires d'ouverture/fermeture fixes (US-09, US-16)
-- Une ligne par jour de la semaine (0 = dimanche ... 6 = samedi), ou une ligne
-- unique si les horaires sont identiques tous les jours ouvres.
CREATE TABLE marche.parametres_marche (
    id                  SERIAL PRIMARY KEY,
    -- Jour de la semaine (0 = dimanche, 1 = lundi, ..., 6 = samedi)
    jour_semaine        SMALLINT NOT NULL CHECK (jour_semaine BETWEEN 0 AND 6),
    heure_ouverture     TIME NOT NULL,
    heure_fermeture     TIME NOT NULL,
    -- Indique si le marche est ouvert ce jour-la (permet de marquer
    -- les week-ends/jours feries comme fermes sans heures)
    jour_ouvre          BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (jour_semaine)
);

COMMENT ON TABLE marche.parametres_marche IS
    'Configuration des horaires d''ouverture/fermeture du marche unique, identiques pour tous les instruments (US-09, US-16)';

-- Donnees par defaut : marche ouvert du lundi au vendredi, 9h00-17h30
-- (a ajuster selon la decision finale - point ouvert specs section 7.5)
INSERT INTO marche.parametres_marche (jour_semaine, heure_ouverture, heure_fermeture, jour_ouvre) VALUES
    (1, '09:00:00', '17:30:00', true),  -- lundi
    (2, '09:00:00', '17:30:00', true),  -- mardi
    (3, '09:00:00', '17:30:00', true),  -- mercredi
    (4, '09:00:00', '17:30:00', true),  -- jeudi
    (5, '09:00:00', '17:30:00', true),  -- vendredi
    (6, '00:00:00', '00:00:00', false), -- samedi : ferme
    (0, '00:00:00', '00:00:00', false); -- dimanche : ferme


-- ============================================================================
-- 4. SCHEMA "portefeuille"
--    Compte especes et positions detenues par chaque investisseur
--    (US-17, US-18, US-19)
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS portefeuille;

-- Compte especes de l'investisseur (relation 1-1 avec utilisateurs)
CREATE TABLE portefeuille.comptes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    utilisateur_id      UUID NOT NULL UNIQUE
                        REFERENCES identite.utilisateurs(id) ON DELETE CASCADE,
    -- Solde en especes disponible pour passer des ordres d'achat
    solde_especes       NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (solde_especes >= 0),
    -- Devise du compte (code ISO 4217, ex. EUR/USD/MAD). Heritee de
    -- administration.parametres_plateforme.devise_par_defaut au moment de la
    -- creation du compte (US-34) via le trigger
    -- portefeuille.trg_comptes_devise_par_defaut ci-dessous. Une modification
    -- ulterieure de la devise par defaut de la plateforme n'affecte pas
    -- retroactivement les comptes existants (specs section 4.4).
    devise              CHAR(3) NOT NULL DEFAULT 'EUR',
    date_maj            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE portefeuille.comptes IS
    'Compte especes de l''investisseur : solde disponible pour les ordres au marche (US-13, US-17), devise heritee de administration.parametres_plateforme a la creation (US-34)';

-- ----------------------------------------------------------------------
-- Trigger : a la creation d'un compte, si la devise n'est pas explicitement
-- renseignee par l'application (valeur par defaut 'EUR' du champ), on la
-- remplace par la devise par defaut courante de la plateforme
-- (administration.parametres_plateforme.devise_par_defaut), conformement a
-- US-34. Ce trigger ne s'applique qu'a l'INSERT (pas a l'UPDATE), afin de ne
-- jamais modifier retroactivement la devise d'un compte existant.
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION portefeuille.appliquer_devise_par_defaut()
RETURNS TRIGGER AS $$
BEGIN
    -- Si l'application n'a pas explicitement fourni de devise (NULL),
    -- on applique la devise par defaut courante de la plateforme.
    -- NB : le champ etant NOT NULL avec DEFAULT 'EUR', l'application
    -- souhaitant explicitement forcer une devise differente de la valeur
    -- par defaut de la plateforme peut le faire en la renseignant elle-meme.
    IF NEW.devise IS NULL THEN
        SELECT devise_par_defaut INTO NEW.devise
        FROM administration.parametres_plateforme
        ORDER BY id DESC
        LIMIT 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_comptes_devise_par_defaut
    BEFORE INSERT ON portefeuille.comptes
    FOR EACH ROW
    EXECUTE FUNCTION portefeuille.appliquer_devise_par_defaut();

-- Positions detenues par instrument (relation N-1 avec comptes et instruments)
CREATE TABLE portefeuille.positions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compte_id           UUID NOT NULL
                        REFERENCES portefeuille.comptes(id) ON DELETE CASCADE,
    instrument_id       UUID NOT NULL
                        REFERENCES marche.instruments(id) ON DELETE RESTRICT,
    -- Quantite detenue (>= 0, une vente ne peut pas faire passer la position en negatif)
    quantite            NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (quantite >= 0),
    -- Prix de revient moyen pondere (PRMP), utilise pour le calcul de performance
    prix_revient_moyen  NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (prix_revient_moyen >= 0),
    -- Un compte ne peut avoir qu'une seule ligne de position par instrument
    CONSTRAINT uq_positions_compte_instrument UNIQUE (compte_id, instrument_id)
);

COMMENT ON TABLE portefeuille.positions IS
    'Positions detenues par instrument et par compte, mises a jour a chaque execution d''ordre (US-12, US-17, US-18)';

CREATE INDEX idx_positions_compte ON portefeuille.positions (compte_id);


-- ============================================================================
-- 5. SCHEMA "ordres"
--    Ordres au marche (achat/vente) et executions associees
--    (US-11 a US-16, US-20 a US-22)
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS ordres;

-- Ordres passes par les investisseurs : "au marche" (execution immediate)
-- ou "a cours limite" (execution conditionnee a un seuil de prix) - US-11 a
-- US-16, US-26 a US-29
CREATE TABLE ordres.ordres (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compte_id           UUID NOT NULL
                        REFERENCES portefeuille.comptes(id) ON DELETE RESTRICT,
    instrument_id       UUID NOT NULL
                        REFERENCES marche.instruments(id) ON DELETE RESTRICT,
    -- Sens de l'ordre : achat ou vente
    sens                VARCHAR(10) NOT NULL CHECK (sens IN ('achat', 'vente')),
    -- Type d'ordre : "marche" (execution immediate au meilleur prix) ou
    -- "limite" (execution conditionnee a l'atteinte d'un seuil de prix) -
    -- US-26 a US-29
    type_ordre          VARCHAR(10) NOT NULL DEFAULT 'marche'
                        CHECK (type_ordre IN ('marche', 'limite')),
    -- Quantite demandee (toujours positive)
    quantite            NUMERIC(18, 6) NOT NULL CHECK (quantite > 0),
    -- Prix limite (achat : prix maximal, vente : prix minimal). Obligatoire
    -- et strictement positif si type_ordre = 'limite', doit etre NULL sinon
    -- (US-26 a US-29, architecture.md section 3.4)
    prix_limite         NUMERIC(18, 4)
                        CHECK (
                            (type_ordre = 'limite' AND prix_limite IS NOT NULL AND prix_limite > 0)
                            OR (type_ordre = 'marche' AND prix_limite IS NULL)
                        ),
    -- Statut de l'ordre : cycle de vie defini en specs section 5
    --   en_attente -> execute | annule | rejete (transitions definitives une fois finales)
    --   Pour un ordre a cours limite, "en_attente" couvre a la fois l'attente
    --   de traitement initial et l'attente d'atteinte du seuil de prix
    --   (US-28), jusqu'a declenchement par le Limit Order Trigger Service.
    statut              VARCHAR(15) NOT NULL DEFAULT 'en_attente'
                        CHECK (statut IN ('en_attente', 'execute', 'annule', 'rejete')),
    -- Motif de rejet, renseigne uniquement si statut = 'rejete'
    -- (solde_insuffisant / position_insuffisante / marche_ferme - cf. architecture.md section 4.1)
    motif_rejet         VARCHAR(30)
                        CHECK (motif_rejet IS NULL OR motif_rejet IN (
                            'solde_insuffisant',
                            'position_insuffisante',
                            'marche_ferme'
                        )),
    date_creation       TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_maj            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ordres.ordres IS
    'Ordres au marche et a cours limite (achat/vente) avec leur statut et motif de rejet eventuel (US-11 a US-16, US-20 a US-22, US-26 a US-29)';

-- Index pour les listes/filtres d'ordres par compte, statut et date (US-20, US-21, US-22)
CREATE INDEX idx_ordres_compte ON ordres.ordres (compte_id, date_creation DESC);
CREATE INDEX idx_ordres_statut ON ordres.ordres (statut);
CREATE INDEX idx_ordres_instrument ON ordres.ordres (instrument_id);
-- Index utilise par le Limit Order Trigger Service pour recuperer rapidement
-- les ordres a cours limite en attente sur un instrument donne (architecture.md
-- section 4.2)
CREATE INDEX idx_ordres_limite_en_attente
    ON ordres.ordres (instrument_id, type_ordre, statut)
    WHERE type_ordre = 'limite' AND statut = 'en_attente';

-- Detail de l'execution d'un ordre (un ordre au marche = une seule execution possible)
CREATE TABLE ordres.executions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ordre_id            UUID NOT NULL UNIQUE
                        REFERENCES ordres.ordres(id) ON DELETE CASCADE,
    prix_execution      NUMERIC(18, 4) NOT NULL CHECK (prix_execution >= 0),
    quantite_executee   NUMERIC(18, 6) NOT NULL CHECK (quantite_executee > 0),
    montant_total       NUMERIC(18, 2) NOT NULL CHECK (montant_total >= 0),
    horodatage_execution TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ordres.executions IS
    'Detail de l''execution d''un ordre (au marche ou a cours limite) : prix, quantite et montant reels (US-15, US-20, US-28)';


-- ============================================================================
-- 6. SCHEMA "historique"
--    Mouvements ayant impacte le compte especes / les positions
--    (US-20, US-21, traçabilite specs section 5)
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS historique;

CREATE TABLE historique.mouvements_compte (
    id                  BIGSERIAL PRIMARY KEY,
    compte_id           UUID NOT NULL
                        REFERENCES portefeuille.comptes(id) ON DELETE CASCADE,
    -- Type de mouvement : execution d'ordre (achat/vente), ou depot/retrait
    -- (depot/retrait hors perimetre MVP - point ouvert specs section 7.2,
    -- mais la valeur est prevue dans le modele pour une evolution future)
    type_mouvement      VARCHAR(20) NOT NULL
                        CHECK (type_mouvement IN (
                            'execution_achat',
                            'execution_vente',
                            'depot',
                            'retrait'
                        )),
    -- Montant du mouvement (positif = credit, negatif = debit, selon convention applicative)
    montant             NUMERIC(18, 2) NOT NULL,
    -- Instrument et quantite concernes (nullable pour depot/retrait)
    instrument_id       UUID REFERENCES marche.instruments(id) ON DELETE RESTRICT,
    quantite            NUMERIC(18, 6),
    -- Reference vers l'ordre ayant genere le mouvement (nullable pour depot/retrait)
    ordre_id            UUID REFERENCES ordres.ordres(id) ON DELETE SET NULL,
    horodatage          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE historique.mouvements_compte IS
    'Historique des mouvements ayant impacte le solde especes et/ou les positions (US-20, US-21)';

-- Index pour les requetes d'historique filtrees par compte/periode/ordre (US-21)
CREATE INDEX idx_mouvements_compte_compte ON historique.mouvements_compte (compte_id, horodatage DESC);
CREATE INDEX idx_mouvements_compte_ordre ON historique.mouvements_compte (ordre_id);


-- ============================================================================
-- 7. Donnees de demonstration (optionnel) - quelques instruments du
--    referentiel marche pour permettre des tests fonctionnels immediats
-- ============================================================================

INSERT INTO marche.instruments (code, nom, type, actif) VALUES
    ('AAPL', 'Apple Inc.', 'action', true),
    ('MSFT', 'Microsoft Corporation', 'action', true),
    ('TTE',  'TotalEnergies SE', 'action', true);

-- Initialisation du dernier cours connu pour chaque instrument de demonstration
INSERT INTO marche.cours_actuels (instrument_id, dernier_prix, variation_pct)
SELECT id, 100.00, 0.00 FROM marche.instruments;
