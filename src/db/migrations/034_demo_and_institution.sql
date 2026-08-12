-- =============================================================================
-- Migration 034 — demo_and_institution Visibility Type
--
-- Adds a new visibility value 'demo_and_institution' to both simulations and
-- simulation_catalogs. A simulation/catalog with this visibility is accessible
-- to both unauthenticated public visitors (demo mode) AND institution users
-- whose institution has an assigned catalog containing it.
-- =============================================================================

BEGIN;

-- ── 1. simulations.visibility ─────────────────────────────────────────────────

ALTER TABLE simulations
  DROP CONSTRAINT IF EXISTS simulations_visibility_check;

ALTER TABLE simulations
  ADD CONSTRAINT simulations_visibility_check
  CHECK (visibility IN ('private', 'institution', 'demo_public', 'demo_and_institution'));

-- ── 2. simulation_catalogs.visibility ────────────────────────────────────────

ALTER TABLE simulation_catalogs
  DROP CONSTRAINT IF EXISTS simulation_catalogs_visibility_check;

ALTER TABLE simulation_catalogs
  ADD CONSTRAINT simulation_catalogs_visibility_check
  CHECK (visibility IN ('global', 'institution', 'demo_public', 'demo_and_institution'));

COMMIT;
