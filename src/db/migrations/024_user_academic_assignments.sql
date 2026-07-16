-- =============================================================================
-- Migration 024 — User Academic Assignments
--
-- Links users to department / academic year / semester term.
-- Instructors may have multiple assignments; students have one current assignment.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS user_academic_assignments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES users(id)          ON DELETE CASCADE,
  institution_id   UUID        NOT NULL REFERENCES institutions(id)   ON DELETE CASCADE,
  department_id    UUID        NOT NULL REFERENCES departments(id)    ON DELETE CASCADE,
  academic_year_id UUID        NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  semester_term_id UUID        NOT NULL REFERENCES semester_terms(id) ON DELETE CASCADE,
  role_context     VARCHAR(50) NOT NULL
                   CHECK (role_context IN ('instructor','student','teaching_assistant','dept_manager')),
  is_current       BOOLEAN     NOT NULL DEFAULT TRUE,
  assigned_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  assigned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One row per (user, dept, year, term, role)
  UNIQUE (user_id, department_id, academic_year_id, semester_term_id, role_context)
);

-- Students can have only ONE current assignment at a time
CREATE UNIQUE INDEX IF NOT EXISTS uidx_uaa_student_current
  ON user_academic_assignments (user_id)
  WHERE is_current = TRUE AND role_context = 'student';

CREATE INDEX IF NOT EXISTS idx_uaa_user           ON user_academic_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_uaa_institution    ON user_academic_assignments (institution_id);
CREATE INDEX IF NOT EXISTS idx_uaa_department     ON user_academic_assignments (department_id);
CREATE INDEX IF NOT EXISTS idx_uaa_academic_year  ON user_academic_assignments (academic_year_id);
CREATE INDEX IF NOT EXISTS idx_uaa_semester_term  ON user_academic_assignments (semester_term_id);
CREATE INDEX IF NOT EXISTS idx_uaa_user_current   ON user_academic_assignments (user_id, is_current);
CREATE INDEX IF NOT EXISTS idx_uaa_inst_dept      ON user_academic_assignments (institution_id, department_id);
CREATE INDEX IF NOT EXISTS idx_uaa_year_term      ON user_academic_assignments (academic_year_id, semester_term_id);

COMMIT;
