-- =============================================================================
-- Migration 023 — Semester Terms
--
-- Adds semester_terms table nested under academic_years.
-- Each academic year can have an arbitrary number of semester terms.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS semester_terms (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id   UUID        NOT NULL REFERENCES institutions(id)    ON DELETE CASCADE,
  department_id    UUID        NOT NULL REFERENCES departments(id)     ON DELETE CASCADE,
  academic_year_id UUID        NOT NULL REFERENCES academic_years(id)  ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  code             VARCHAR(50),
  term_order       INTEGER      NOT NULL DEFAULT 1,
  status           VARCHAR(20)  NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'inactive', 'archived')),
  start_date       DATE,
  end_date         DATE,
  created_by       UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_semester_terms_year_code
  ON semester_terms (academic_year_id, code)
  WHERE deleted_at IS NULL AND code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_st_institution    ON semester_terms (institution_id);
CREATE INDEX IF NOT EXISTS idx_st_department     ON semester_terms (department_id);
CREATE INDEX IF NOT EXISTS idx_st_academic_year  ON semester_terms (academic_year_id);
CREATE INDEX IF NOT EXISTS idx_st_dept_year      ON semester_terms (department_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_st_year_order     ON semester_terms (academic_year_id, term_order) WHERE deleted_at IS NULL;

COMMIT;
