-- =============================================================================
-- Migration 019 — Department Simulation Catalogs
--
-- Adds department-level catalog assignment so departments can independently
-- select which simulation sub-trees their students and instructors can access,
-- independent of (but scoped within) the institution-level assignment.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS department_simulation_catalogs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id         UUID        NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  simulation_catalog_id UUID        NOT NULL REFERENCES simulation_catalogs(id) ON DELETE CASCADE,
  include_subtree       BOOLEAN     NOT NULL DEFAULT TRUE,
  assigned_by           UUID        REFERENCES users(id),
  assigned_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT department_simulation_catalogs_unique
    UNIQUE (department_id, simulation_catalog_id)
);

CREATE INDEX IF NOT EXISTS idx_dept_sim_catalogs_dept
  ON department_simulation_catalogs (department_id);

CREATE INDEX IF NOT EXISTS idx_dept_sim_catalogs_catalog
  ON department_simulation_catalogs (simulation_catalog_id);

COMMIT;
