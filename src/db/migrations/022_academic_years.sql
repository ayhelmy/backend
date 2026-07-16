-- =============================================================================
-- Migration 022 — Academic Years
--
-- Adds academic_years table scoped to department.
-- Each department manages its own academic years independently.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS academic_years (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID        NOT NULL REFERENCES institutions(id)  ON DELETE CASCADE,
  department_id   UUID        NOT NULL REFERENCES departments(id)   ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  code            VARCHAR(50),
  year_order      INTEGER      NOT NULL DEFAULT 1,
  status          VARCHAR(20)  NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'inactive', 'archived')),
  start_date      DATE,
  end_date        DATE,
  created_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- Unique code per department (partial: only non-deleted rows with a code)
CREATE UNIQUE INDEX IF NOT EXISTS uidx_academic_years_dept_code
  ON academic_years (department_id, code)
  WHERE deleted_at IS NULL AND code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ay_institution    ON academic_years (institution_id);
CREATE INDEX IF NOT EXISTS idx_ay_department     ON academic_years (department_id);
CREATE INDEX IF NOT EXISTS idx_ay_inst_dept      ON academic_years (institution_id, department_id);
CREATE INDEX IF NOT EXISTS idx_ay_dept_order     ON academic_years (department_id, year_order) WHERE deleted_at IS NULL;

COMMIT;
