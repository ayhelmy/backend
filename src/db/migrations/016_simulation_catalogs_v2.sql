-- =============================================================================
-- Migration 016 — Simulation Catalog v2
--
-- Changes:
--   1. Add visibility column to simulations (private | institution | demo_public)
--   2. Add status column to simulation_catalogs (draft | active | archived)
--   3. Create simulation_catalog_items table (catalog ↔ simulation many-to-many)
--   4. Seed demo visibility for simulations that had NULL institution_id
-- =============================================================================

-- ── 1. Add visibility to simulations ─────────────────────────────────────────

ALTER TABLE simulations
  ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'institution'
    CHECK (visibility IN ('private', 'institution', 'demo_public'));

-- Existing global simulations (institution_id IS NULL) become demo_public
UPDATE simulations
   SET visibility = 'demo_public'
 WHERE institution_id IS NULL AND deleted_at IS NULL;

-- Existing institution-scoped simulations remain 'institution' (default covers them)

CREATE INDEX IF NOT EXISTS idx_simulations_visibility
  ON simulations (visibility) WHERE deleted_at IS NULL;

-- ── 2. Add status to simulation_catalogs ─────────────────────────────────────

ALTER TABLE simulation_catalogs
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'archived'));

CREATE INDEX IF NOT EXISTS idx_sim_catalogs_status ON simulation_catalogs (status);

-- ── 3. simulation_catalog_items: links simulations to named catalogs ──────────

CREATE TABLE IF NOT EXISTS simulation_catalog_items (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id     UUID        NOT NULL REFERENCES simulation_catalogs (id) ON DELETE CASCADE,
  simulation_id  UUID        NOT NULL REFERENCES simulations (id) ON DELETE CASCADE,
  added_by       UUID        REFERENCES users (id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT simulation_catalog_items_unique UNIQUE (catalog_id, simulation_id)
);

CREATE INDEX IF NOT EXISTS idx_sim_catalog_items_catalog ON simulation_catalog_items (catalog_id);
CREATE INDEX IF NOT EXISTS idx_sim_catalog_items_sim     ON simulation_catalog_items (simulation_id);

-- ── 4. Normalise institution_simulation_catalogs naming ───────────────────────
-- The FK column in migration 015 is simulation_catalog_id; ensure index exists.

CREATE INDEX IF NOT EXISTS idx_inst_sim_catalogs_inst
  ON institution_simulation_catalogs (institution_id);
CREATE INDEX IF NOT EXISTS idx_inst_sim_catalogs_catalog
  ON institution_simulation_catalogs (simulation_catalog_id);
