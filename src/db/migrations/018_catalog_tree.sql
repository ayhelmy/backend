-- =============================================================================
-- Migration 018 — Simulation Catalog Tree
--
-- Transforms the flat simulation_catalogs table into a self-referencing tree.
-- All existing flat catalogs become depth-0 root nodes (backward compatible).
--
-- Changes:
--   1. Add tree columns to simulation_catalogs
--      (parent_id, root_catalog_id, depth, path, sort_order, slug, visibility,
--       institution_id, deleted_at)
--   2. Back-fill tree columns for existing flat catalog rows
--   3. Add sort_order to simulation_catalog_items
--   4. Add include_subtree flag to institution_simulation_catalogs
--   5. Rename ambiguous FK column alias (no rename, add index alias only)
--   6. Add all required indexes
-- =============================================================================

BEGIN;

-- ── 1. Extend simulation_catalogs ────────────────────────────────────────────

ALTER TABLE simulation_catalogs
  ADD COLUMN IF NOT EXISTS parent_id      UUID REFERENCES simulation_catalogs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS root_catalog_id UUID REFERENCES simulation_catalogs(id),
  ADD COLUMN IF NOT EXISTS depth          INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS path           TEXT        NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sort_order     INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS slug           VARCHAR(255),
  ADD COLUMN IF NOT EXISTS visibility     VARCHAR(30) NOT NULL DEFAULT 'global'
    CHECK (visibility IN ('global', 'institution', 'demo_public')),
  ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ;

-- ── 2. Back-fill tree columns for existing flat roots ────────────────────────

-- Slug: lowercase name, strip non-alphanum, collapse spaces to hyphens
UPDATE simulation_catalogs
SET
  depth          = 0,
  root_catalog_id = id,
  path           = id::text,
  slug           = LOWER(
                     REGEXP_REPLACE(
                       REGEXP_REPLACE(TRIM(name), '[^a-zA-Z0-9\s\-]', '', 'g'),
                       '\s+', '-', 'g'
                     )
                   ),
  visibility     = CASE
                     WHEN is_demo   = TRUE THEN 'demo_public'
                     WHEN is_global = TRUE THEN 'global'
                     ELSE 'institution'
                   END
WHERE parent_id IS NULL AND path = '';

-- ── 3. Add sort_order to simulation_catalog_items ────────────────────────────

ALTER TABLE simulation_catalog_items
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- ── 4. Add include_subtree flag to institution_simulation_catalogs ────────────
-- When TRUE (default), assigning a catalog also grants access to all descendants.

ALTER TABLE institution_simulation_catalogs
  ADD COLUMN IF NOT EXISTS include_subtree BOOLEAN NOT NULL DEFAULT TRUE;

-- ── 5. Indexes ────────────────────────────────────────────────────────────────

-- Tree navigation
CREATE INDEX IF NOT EXISTS idx_sim_catalogs_parent_id
  ON simulation_catalogs (parent_id) WHERE parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sim_catalogs_root_catalog_id
  ON simulation_catalogs (root_catalog_id) WHERE root_catalog_id IS NOT NULL;

-- Path-based subtree queries (LIKE 'prefix/%')
CREATE INDEX IF NOT EXISTS idx_sim_catalogs_path
  ON simulation_catalogs (path);

-- Filtering / browsing
CREATE INDEX IF NOT EXISTS idx_sim_catalogs_visibility
  ON simulation_catalogs (visibility);

CREATE INDEX IF NOT EXISTS idx_sim_catalogs_depth
  ON simulation_catalogs (depth);

CREATE INDEX IF NOT EXISTS idx_sim_catalogs_institution_id
  ON simulation_catalogs (institution_id) WHERE institution_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sim_catalogs_slug
  ON simulation_catalogs (slug) WHERE slug IS NOT NULL;

-- Soft-delete filter
CREATE INDEX IF NOT EXISTS idx_sim_catalogs_deleted_at
  ON simulation_catalogs (deleted_at) WHERE deleted_at IS NULL;

-- Items ordering
CREATE INDEX IF NOT EXISTS idx_sim_catalog_items_sort
  ON simulation_catalog_items (catalog_id, sort_order);

COMMIT;
