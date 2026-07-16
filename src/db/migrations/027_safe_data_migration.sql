-- =============================================================================
-- Migration 027 — Safe Data Migration: backfill existing courses
--
-- For each department that already has courses with no academic_year_id,
-- creates a default "Academic Year 1" and "Semester 1" and assigns them.
-- Runs inside a DO block — safe to re-run (idempotent).
-- =============================================================================

BEGIN;

DO $$
DECLARE
  dept_rec         RECORD;
  default_year_id  UUID;
  default_term_id  UUID;
  updated_count    INTEGER;
BEGIN
  FOR dept_rec IN
    SELECT DISTINCT c.department_id, c.institution_id
      FROM courses c
     WHERE c.deleted_at IS NULL
       AND c.academic_year_id IS NULL
       AND c.department_id IS NOT NULL
  LOOP
    -- Create default academic year for this department (idempotent)
    INSERT INTO academic_years
      (institution_id, department_id, name, code, year_order, status)
    VALUES
      (dept_rec.institution_id, dept_rec.department_id,
       'Academic Year 1', 'AY1', 1, 'active')
    ON CONFLICT DO NOTHING;

    SELECT id INTO default_year_id
      FROM academic_years
     WHERE department_id = dept_rec.department_id
       AND code = 'AY1'
       AND deleted_at IS NULL
     LIMIT 1;

    -- Create default semester term (idempotent)
    INSERT INTO semester_terms
      (institution_id, department_id, academic_year_id, name, code, term_order, status)
    VALUES
      (dept_rec.institution_id, dept_rec.department_id, default_year_id,
       'Semester 1', 'S1', 1, 'active')
    ON CONFLICT DO NOTHING;

    SELECT id INTO default_term_id
      FROM semester_terms
     WHERE academic_year_id = default_year_id
       AND code = 'S1'
       AND deleted_at IS NULL
     LIMIT 1;

    -- Backfill courses
    UPDATE courses
       SET academic_year_id = default_year_id,
           semester_term_id = default_term_id,
           updated_at       = NOW()
     WHERE department_id    = dept_rec.department_id
       AND institution_id   = dept_rec.institution_id
       AND academic_year_id IS NULL
       AND deleted_at       IS NULL;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'dept=% inst=%: year=% term=% courses_updated=%',
      dept_rec.department_id, dept_rec.institution_id,
      default_year_id, default_term_id, updated_count;
  END LOOP;
END;
$$;

COMMIT;
