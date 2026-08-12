-- =============================================================================
-- Migration 061 — Home Page Featured Simulations
--
-- Adds a curated "featured" flag to simulations so the public home page can
-- show a hand-picked set of simulations (independent of demo visibility).
-- =============================================================================

BEGIN;

ALTER TABLE simulations
  ADD COLUMN is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN featured_order INTEGER;

CREATE INDEX idx_simulations_featured
  ON simulations (featured_order)
  WHERE is_featured = TRUE AND deleted_at IS NULL;

COMMIT;
