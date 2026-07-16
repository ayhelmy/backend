-- =============================================================================
-- Migration 026 — Academic Structure Permissions
--
-- Adds permissions for academic_years, semester_terms, and academic_assignments.
-- Updates role_permissions for institution_admin, dept_manager, instructor, student.
-- =============================================================================

BEGIN;

INSERT INTO permissions (code, resource, action, description) VALUES
  ('academic_years.create',      'academic_years',      'create',  'Create academic years under own institution departments'),
  ('academic_years.view',        'academic_years',      'view',    'View academic years'),
  ('academic_years.manage',      'academic_years',      'manage',  'Update and delete academic years'),
  ('semester_terms.create',      'semester_terms',      'create',  'Create semester terms under academic years'),
  ('semester_terms.view',        'semester_terms',      'view',    'View semester terms'),
  ('semester_terms.manage',      'semester_terms',      'manage',  'Update and delete semester terms'),
  ('academic_assignments.manage','academic_assignments','manage',  'Assign users to academic year/semester term'),
  ('academic_assignments.view',  'academic_assignments','view',    'View user academic assignments')
ON CONFLICT (code) DO NOTHING;

-- institution_admin: full academic structure management
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'institution_admin'
  AND p.code IN (
    'academic_years.create', 'academic_years.view', 'academic_years.manage',
    'semester_terms.create', 'semester_terms.view', 'semester_terms.manage',
    'academic_assignments.manage', 'academic_assignments.view'
  )
ON CONFLICT DO NOTHING;

-- dept_manager: view + assignment view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'dept_manager'
  AND p.code IN ('academic_years.view', 'semester_terms.view', 'academic_assignments.view')
ON CONFLICT DO NOTHING;

-- instructor: view academic structure + own assignments
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'instructor'
  AND p.code IN ('academic_years.view', 'semester_terms.view', 'academic_assignments.view')
ON CONFLICT DO NOTHING;

-- student: view academic structure (to see their current assignment)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'student'
  AND p.code IN ('academic_years.view', 'semester_terms.view')
ON CONFLICT DO NOTHING;

COMMIT;
