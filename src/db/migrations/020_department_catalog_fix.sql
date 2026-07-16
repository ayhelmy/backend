BEGIN;

-- Add missing columns to department_simulation_catalogs (created by migration 019).
-- institution_id enables fast tenant-scoped queries without joining departments.
-- created_at / updated_at bring the table in line with every other entity table.

ALTER TABLE department_simulation_catalogs
  ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill institution_id from the owning department
UPDATE department_simulation_catalogs dsc
   SET institution_id = d.institution_id
  FROM departments d
 WHERE d.id = dsc.department_id
   AND dsc.institution_id IS NULL;

-- Enforce NOT NULL now that all rows are filled
ALTER TABLE department_simulation_catalogs
  ALTER COLUMN institution_id SET NOT NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dept_sim_cats_institution
  ON department_simulation_catalogs (institution_id);

CREATE INDEX IF NOT EXISTS idx_dept_sim_cats_inst_dept
  ON department_simulation_catalogs (institution_id, department_id);

-- Also index courses.department_id for fast lookup when filtering simulations
CREATE INDEX IF NOT EXISTS idx_courses_department
  ON courses (department_id)
  WHERE deleted_at IS NULL;

COMMIT;
