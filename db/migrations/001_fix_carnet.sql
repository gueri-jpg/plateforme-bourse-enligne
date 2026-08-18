-- Migration 001 : persistance du carnet FIX
-- Ajoute time_in_force dans ordres.ordres et corrige le CHECK statut.
-- Aucune donnée supprimée. Idempotent (IF NOT EXISTS / IF EXISTS).
-- Appliquée automatiquement en production par .github/workflows/deploy.yml
-- (step "Appliquer les migrations DB").

BEGIN;

-- 1. Colonne time_in_force : durée de validité de l'ordre (day/gtc/ioc/fok)
--    DEFAULT 'day' pour les ordres existants qui n'ont pas de valeur.
ALTER TABLE ordres.ordres
    ADD COLUMN IF NOT EXISTS time_in_force VARCHAR(3) NOT NULL DEFAULT 'day';

-- Contrainte de valeur sur la nouvelle colonne (ajoutée séparément pour
-- éviter les erreurs si la colonne existait déjà sans contrainte)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ordres_time_in_force_check'
    ) THEN
        ALTER TABLE ordres.ordres
            ADD CONSTRAINT ordres_time_in_force_check
            CHECK (time_in_force IN ('day', 'gtc', 'ioc', 'fok'));
    END IF;
END $$;

-- 2. Corriger le CHECK statut : ajouter 'partiellement_execute'
--    (manquait depuis l'origine — les ordres partiels plantaient en DB)
ALTER TABLE ordres.ordres DROP CONSTRAINT IF EXISTS ordres_statut_check;
ALTER TABLE ordres.ordres
    ADD CONSTRAINT ordres_statut_check
    CHECK (statut IN (
        'en_attente',
        'execute',
        'partiellement_execute',
        'annule',
        'rejete',
        'expire'
    ));

COMMIT;
