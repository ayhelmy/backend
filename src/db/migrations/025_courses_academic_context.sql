-- =============================================================================
-- Migration 025 — Add academic_year_id and semester_term_id to courses
--
-- Courses are now scoped to a specific semester term within a department.
-- Existing courses without these columns will be backfilled by migration 027.
-- =============================================================================

BEGIN;

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES academic_years(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS semester_term_id UUID REFERENCES semester_terms(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_courses_academic_year  ON courses (academic_year_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_courses_semester_term  ON courses (semester_term_id)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_courses_dept_term      ON courses (department_id, semester_term_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_courses_term_status    ON courses (semester_term_id, status)         WHERE deleted_at IS NULL;

COMMIT;
