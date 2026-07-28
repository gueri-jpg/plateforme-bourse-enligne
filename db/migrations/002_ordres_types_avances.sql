-- Migration 002 : types d'ordre et TimeInForce avancés (MIT202)
-- Ajoute les colonnes nécessaires à Stop/Stop Limit/Iceberg/Hidden/Pegged/
-- Offset et aux TIF GTD/GTT/OPG/ATC/GFX/GFA/GFS/CPX.
-- Aucune donnée supprimée. Idempotent (IF NOT EXISTS / IF EXISTS).
-- Appliquée automatiquement en production par .github/workflows/deploy.yml
-- (step "Appliquer les migrations DB").

BEGIN;

-- 0. Élargir type_ordre : "stop_limite" (11 caractères) dépasse VARCHAR(10)
ALTER TABLE ordres.ordres ALTER COLUMN type_ordre TYPE VARCHAR(15);

-- 1. StopPx (99) — ordres Stop / Stop Limit
ALTER TABLE ordres.ordres
    ADD COLUMN IF NOT EXISTS stop_px NUMERIC(18, 4);

-- 2. DisplayQty (1138) / DisplayMethod (1084) — Iceberg / Hidden
ALTER TABLE ordres.ordres
    ADD COLUMN IF NOT EXISTS display_qty NUMERIC(18, 6);
ALTER TABLE ordres.ordres
    ADD COLUMN IF NOT EXISTS display_method VARCHAR(10);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ordres_display_method_check'
    ) THEN
        ALTER TABLE ordres.ordres
            ADD CONSTRAINT ordres_display_method_check
            CHECK (display_method IS NULL OR display_method IN ('random', 'hidden'));
    END IF;
END $$;

-- 3. MinQty (110) — MES des ordres Pegged
ALTER TABLE ordres.ordres
    ADD COLUMN IF NOT EXISTS min_qty NUMERIC(18, 6);

-- 4. PreTradeAnonymity (1091) — ordres Named ('N') vs anonymes ('Y', défaut)
ALTER TABLE ordres.ordres
    ADD COLUMN IF NOT EXISTS pre_trade_anonymity VARCHAR(1) NOT NULL DEFAULT 'Y';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ordres_pre_trade_anonymity_check'
    ) THEN
        ALTER TABLE ordres.ordres
            ADD CONSTRAINT ordres_pre_trade_anonymity_check
            CHECK (pre_trade_anonymity IN ('Y', 'N'));
    END IF;
END $$;

-- 5. ExpireTime (126) / ExpireDate (432) — TIF GTT / GTD
ALTER TABLE ordres.ordres
    ADD COLUMN IF NOT EXISTS expire_time TIMESTAMPTZ;
ALTER TABLE ordres.ordres
    ADD COLUMN IF NOT EXISTS expire_date DATE;

-- 6. Offset (27018, basis points) — ordres Offset
ALTER TABLE ordres.ordres
    ADD COLUMN IF NOT EXISTS offset_bp NUMERIC(9, 4);

-- 7. Élargir type_ordre : stop, stop_limite, iceberg, cache, pegged, offset
ALTER TABLE ordres.ordres DROP CONSTRAINT IF EXISTS type_ordre_check;
ALTER TABLE ordres.ordres DROP CONSTRAINT IF EXISTS ordres_type_ordre_check;
ALTER TABLE ordres.ordres
    ADD CONSTRAINT ordres_type_ordre_check
    CHECK (type_ordre IN (
        'marche', 'limite', 'stop', 'stop_limite',
        'iceberg', 'cache', 'pegged', 'offset'
    ));

-- 7bis. Élargir la contrainte prix_limite pour les nouveaux type_ordre :
--    limite/stop_limite/iceberg/cache exigent un prix ; marche/stop
--    l'interdisent (marche = exécution immédiate, stop = StopPx sert de
--    déclencheur, pas de plafond) ; pegged/offset sont libres (le prix est
--    calculé par le moteur, un plafond optionnel reste possible pour pegged).
ALTER TABLE ordres.ordres DROP CONSTRAINT IF EXISTS prix_limite_check;
ALTER TABLE ordres.ordres DROP CONSTRAINT IF EXISTS ordres_prix_limite_check;
-- Nom auto-généré par Postgres pour le CHECK multi-colonnes non nommé
-- d'origine dans init.sql (portait sur type_ordre + prix_limite).
ALTER TABLE ordres.ordres DROP CONSTRAINT IF EXISTS ordres_check;
ALTER TABLE ordres.ordres
    ADD CONSTRAINT ordres_prix_limite_check
    CHECK (
        (type_ordre IN ('limite', 'stop_limite', 'iceberg', 'cache')
            AND prix_limite IS NOT NULL AND prix_limite > 0)
        OR (type_ordre IN ('marche', 'stop') AND prix_limite IS NULL)
        OR (type_ordre IN ('pegged', 'offset'))
    );

-- 7ter. StopPx obligatoire seulement pour Stop/Stop Limit
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ordres_stop_px_check'
    ) THEN
        ALTER TABLE ordres.ordres
            ADD CONSTRAINT ordres_stop_px_check
            CHECK (
                (type_ordre IN ('stop', 'stop_limite') AND stop_px IS NOT NULL)
                OR (type_ordre NOT IN ('stop', 'stop_limite') AND stop_px IS NULL)
            );
    END IF;
END $$;

-- 7quater. Offset obligatoire seulement pour les ordres Offset
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ordres_offset_bp_check'
    ) THEN
        ALTER TABLE ordres.ordres
            ADD CONSTRAINT ordres_offset_bp_check
            CHECK (
                (type_ordre = 'offset' AND offset_bp IS NOT NULL)
                OR (type_ordre != 'offset' AND offset_bp IS NULL)
            );
    END IF;
END $$;

-- 8. Élargir time_in_force : opg, atc, gfx, gfa, gfs, gtd, gtt, cpx
ALTER TABLE ordres.ordres DROP CONSTRAINT IF EXISTS ordres_time_in_force_check;
ALTER TABLE ordres.ordres
    ADD CONSTRAINT ordres_time_in_force_check
    CHECK (time_in_force IN (
        'day', 'gtc', 'ioc', 'fok',
        'opg', 'atc', 'gfx', 'gfa', 'gfs', 'gtd', 'gtt', 'cpx'
    ));

-- 9. Élargir statut : 'expire' (GTD/GTT ou DAY expiré en fin de séance —
--    sweep paresseux du moteur, cf. fix_engine._expirer_ordres)
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
