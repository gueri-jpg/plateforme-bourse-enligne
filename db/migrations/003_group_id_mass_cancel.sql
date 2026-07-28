-- Migration 003 : GroupID (27017) — bucket client-assignable pour le Mass
-- Cancel ciblé (MassCancelRequestType 56=For Group / 57=For Instrument For
-- Group), section 6.4.3/2.1.2.2 de MIT202. Distinct du Trader Group (76) qui
-- reste le scope de base (compte_id) de tout Mass Cancel.
-- Aucune donnée supprimée. Idempotent (IF NOT EXISTS / IF EXISTS).

BEGIN;

-- 1. GroupID (27017) — "0" = ordre non groupé (défaut, valeur FIX déjà
--    utilisée par fix_messages.build_exec_report). Bornes 1-255 documentées
--    en 6.4.3 pour un groupe réel ; "0" reste hors de cette plage par
--    construction (non groupé n'est pas un groupe).
ALTER TABLE ordres.ordres
    ADD COLUMN IF NOT EXISTS group_id VARCHAR(3) NOT NULL DEFAULT '0';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ordres_group_id_check'
    ) THEN
        ALTER TABLE ordres.ordres
            ADD CONSTRAINT ordres_group_id_check
            CHECK (group_id = '0' OR group_id ~ '^([1-9][0-9]?|1[0-9]{2}|2[0-4][0-9]|25[0-5])$');
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ordres_group_id ON ordres.ordres (compte_id, group_id)
    WHERE group_id <> '0';

COMMIT;
