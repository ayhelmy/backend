-- =============================================================================
-- Migration 063 — Normalize simulation media paths to relative
--
-- Prior code baked the CURRENT request's protocol+host directly into
-- simulations.thumbnail_url, simulation_click_regions.reference_image_url,
-- and simulations.storage_path at upload time (e.g.
-- "http://172.20.44.1:5000/thumbnails/xyz.jpg"). That breaks the moment the
-- app is served from a different host/domain — exactly the kind of value
-- that must never be baked into the database. The application code has been
-- fixed to store relative paths going forward (resolved back to absolute at
-- response time by src/middleware/mediaUrlRewriter.js); this migration
-- normalizes any already-stored absolute values.
--
-- storage_path is recomputed from build_uuid (not regex-stripped) since it's
-- a filesystem-style path, not a URL, and build_uuid is always available —
-- deterministic recomputation is safer than trying to parse arbitrary
-- absolute OS paths (Windows drive letters, POSIX roots, differing storage
-- dirs). Assumes the default storage dir convention ("storage/simulations");
-- harmless no-op for rows that were already relative.
-- =============================================================================

UPDATE simulations
SET thumbnail_url = regexp_replace(thumbnail_url, '^https?://[^/]+', '')
WHERE thumbnail_url ~ '^https?://';

UPDATE simulation_click_regions
SET reference_image_url = regexp_replace(reference_image_url, '^https?://[^/]+', '')
WHERE reference_image_url ~ '^https?://';

UPDATE simulations
SET storage_path = 'storage/simulations/' || build_uuid
WHERE build_uuid IS NOT NULL
  AND (storage_path IS NULL OR storage_path ~ '^https?://' OR storage_path ~ '^[A-Za-z]:[\\/]' OR storage_path ~ '^/');
