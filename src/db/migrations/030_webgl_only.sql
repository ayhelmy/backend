-- Migration 030: WebGL-only simulations
-- Removes SCORM and LTI support. All simulations must be type = 'webgl'.
-- Converts any existing rows that still carry old types.

-- 1. Convert all existing rows to webgl
UPDATE simulations
SET
  type        = 'webgl',
  launch_type = 'webgl',
  launch_url  = NULL
WHERE deleted_at IS NULL
  AND (type IS NULL OR type <> 'webgl');

-- 2. Drop all CHECK constraints that reference 'type' (covers both 006 and 029 variants)
DO $$
DECLARE v_con TEXT;
BEGIN
  FOR v_con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'simulations'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%type%'
  LOOP
    EXECUTE 'ALTER TABLE simulations DROP CONSTRAINT ' || quote_ident(v_con);
  END LOOP;
END $$;

-- Re-add a single, strict type check: only 'webgl' allowed
ALTER TABLE simulations
  ADD CONSTRAINT simulations_type_check CHECK (type = 'webgl');

ALTER TABLE simulations ALTER COLUMN type SET DEFAULT 'webgl';

-- 3. Drop all CHECK constraints that reference 'launch_type'
DO $$
DECLARE v_con TEXT;
BEGIN
  FOR v_con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'simulations'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%launch_type%'
  LOOP
    EXECUTE 'ALTER TABLE simulations DROP CONSTRAINT ' || quote_ident(v_con);
  END LOOP;
END $$;

ALTER TABLE simulations
  ADD CONSTRAINT simulations_launch_type_check
    CHECK (launch_type IS NULL OR launch_type = 'webgl');

-- 4. Make launch_url nullable — WebGL uses public_entry_url, not launch_url
ALTER TABLE simulations ALTER COLUMN launch_url DROP NOT NULL;
