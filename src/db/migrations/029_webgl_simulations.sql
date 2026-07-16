-- Migration 029: WebGL simulation build support
-- SRS §4.7 SIM-01 — Unity WebGL upload, extraction, and play flow.
-- Adds build fields to simulations table.

-- Add launch_type (webgl|scorm|lti|internal). Existing rows keep NULL → treated as legacy.
ALTER TABLE simulations
  ADD COLUMN IF NOT EXISTS launch_type VARCHAR(20)
    CHECK (launch_type IN ('webgl','scorm','lti','internal'));

-- Build artifact fields (WebGL only)
ALTER TABLE simulations
  ADD COLUMN IF NOT EXISTS build_uuid UUID UNIQUE,
  ADD COLUMN IF NOT EXISTS original_zip_filename TEXT,
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS public_entry_url TEXT,
  ADD COLUMN IF NOT EXISTS entry_file VARCHAR(255) DEFAULT 'index.html',
  ADD COLUMN IF NOT EXISTS build_status VARCHAR(20)
    CHECK (build_status IN ('processing','ready','failed')),
  ADD COLUMN IF NOT EXISTS build_validation JSONB,
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;

-- Expand the existing type CHECK to allow 'webgl' (column kept for backward compat)
DO $$
DECLARE
  v_con TEXT;
BEGIN
  SELECT conname INTO v_con
    FROM pg_constraint
   WHERE conrelid = 'simulations'::regclass
     AND contype  = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%type%scorm%';
  IF v_con IS NOT NULL THEN
    EXECUTE 'ALTER TABLE simulations DROP CONSTRAINT ' || quote_ident(v_con);
  END IF;
END $$;

ALTER TABLE simulations
  ADD CONSTRAINT simulations_type_webgl_check
    CHECK (type IS NULL OR type IN ('scorm','lti','internal','webgl'));

-- Index for fast UUID lookup (launch endpoint)
CREATE UNIQUE INDEX IF NOT EXISTS idx_simulations_build_uuid
  ON simulations (build_uuid) WHERE build_uuid IS NOT NULL;
