-- =============================================================================
-- Migration 031 — Soft Unassignment for institution_simulation_catalogs
--
-- Changes:
--   1. Add id UUID primary key (replacing composite PK)
--   2. Add status column: active | inactive
--   3. Add unassigned_by, unassigned_at, updated_at columns
--   4. Partial unique index: only one ACTIVE row per (institution_id, catalog_id)
--   5. Performance indexes
--   6. Add permissions: simulation_catalogs.unassign_from_institution
--                       simulation_catalogs.view_assignments
--   7. Grant new permissions to super_admin
-- =============================================================================

BEGIN;

-- ── 1. Add id column ──────────────────────────────────────────────────────────

ALTER TABLE institution_simulation_catalogs
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

-- Backfill for any existing rows that got NULL (shouldn't happen but guard it)
UPDATE institution_simulation_catalogs SET id = gen_random_uuid() WHERE id IS NULL;

ALTER TABLE institution_simulation_catalogs
  ALTER COLUMN id SET NOT NULL;

-- ── 2. Add status column ──────────────────────────────────────────────────────

ALTER TABLE institution_simulation_catalogs
  ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive'));

-- Backfill: all existing rows are active
UPDATE institution_simulation_catalogs SET status = 'active' WHERE status IS NULL;

-- ── 3. Add unassignment tracking + updated_at ─────────────────────────────────

ALTER TABLE institution_simulation_catalogs
  ADD COLUMN IF NOT EXISTS unassigned_by UUID REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unassigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── 4. Replace composite PK with UUID PK ─────────────────────────────────────
-- Drop old composite primary key first, then promote id to PK.

ALTER TABLE institution_simulation_catalogs
  DROP CONSTRAINT IF EXISTS institution_simulation_catalogs_pkey;

ALTER TABLE institution_simulation_catalogs
  ADD PRIMARY KEY (id);

-- ── 5. Partial unique index — one active assignment per institution+catalog ────
-- Allows re-assignment after unassignment (history rows stay with status=inactive).

CREATE UNIQUE INDEX IF NOT EXISTS uq_inst_sim_catalogs_active
  ON institution_simulation_catalogs (institution_id, simulation_catalog_id)
  WHERE status = 'active';

-- ── 6. Performance indexes ────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_inst_sim_catalogs_status
  ON institution_simulation_catalogs (status);

CREATE INDEX IF NOT EXISTS idx_inst_sim_catalogs_inst_catalog
  ON institution_simulation_catalogs (institution_id, simulation_catalog_id);

CREATE INDEX IF NOT EXISTS idx_inst_sim_catalogs_catalog_status
  ON institution_simulation_catalogs (simulation_catalog_id, status);

-- ── 7. New permissions ────────────────────────────────────────────────────────

INSERT INTO permissions (code, resource, action, description) VALUES
  ('simulation_catalogs.unassign_from_institution',
   'simulation_catalogs', 'unassign_from_institution',
   'Remove a simulation catalog assignment from an institution'),
  ('simulation_catalogs.view_assignments',
   'simulation_catalogs', 'view_assignments',
   'View which institutions are assigned to a simulation catalog')
ON CONFLICT (code) DO NOTHING;

-- ── 8. Grant new permissions to super_admin ───────────────────────────────────

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
 CROSS JOIN permissions p
 WHERE r.name = 'super_admin'
   AND p.code IN (
         'simulation_catalogs.unassign_from_institution',
         'simulation_catalogs.view_assignments'
       )
ON CONFLICT DO NOTHING;

COMMIT;


-- =============================================================================
-- ROLLBACK (run manually if needed):
-- =============================================================================
--
-- BEGIN;
--
-- -- Remove permissions from super_admin
-- DELETE FROM role_permissions
--  WHERE permission_id IN (
--    SELECT id FROM permissions
--     WHERE code IN (
--       'simulation_catalogs.unassign_from_institution',
--       'simulation_catalogs.view_assignments'
--     )
--  );
--
-- -- Delete permission records
-- DELETE FROM permissions
--  WHERE code IN (
--    'simulation_catalogs.unassign_from_institution',
--    'simulation_catalogs.view_assignments'
--  );
--
-- -- Drop new indexes
-- DROP INDEX IF EXISTS uq_inst_sim_catalogs_active;
-- DROP INDEX IF EXISTS idx_inst_sim_catalogs_status;
-- DROP INDEX IF EXISTS idx_inst_sim_catalogs_inst_catalog;
-- DROP INDEX IF EXISTS idx_inst_sim_catalogs_catalog_status;
--
-- -- Restore composite PK (re-create from id-based PK)
-- ALTER TABLE institution_simulation_catalogs DROP CONSTRAINT IF EXISTS institution_simulation_catalogs_pkey;
-- ALTER TABLE institution_simulation_catalogs ADD PRIMARY KEY (institution_id, simulation_catalog_id);
--
-- -- Drop added columns
-- ALTER TABLE institution_simulation_catalogs
--   DROP COLUMN IF EXISTS id,
--   DROP COLUMN IF EXISTS status,
--   DROP COLUMN IF EXISTS unassigned_by,
--   DROP COLUMN IF EXISTS unassigned_at,
--   DROP COLUMN IF EXISTS updated_at;
--
-- COMMIT;
