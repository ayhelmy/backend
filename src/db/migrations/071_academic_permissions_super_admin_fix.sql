-- =============================================================================
-- Migration 067 — Fix: grant academic structure permissions to super_admin
--
-- Migration 026 added academic_years.*, semester_terms.*, and
-- academic_assignments.* permission codes but never granted them to
-- super_admin explicitly. Unlike the permissions that existed when 015's
-- super_admin CROSS JOIN ran, these are new codes — super_admin does NOT
-- get them automatically (see the same gap fixed for LTI permissions in
-- migration 058). Result: even a super_admin gets 403 Forbidden trying to
-- create/manage an academic year.
-- Additive to RBAC v2 (015) and 026. Does not edit either. Idempotent.
-- =============================================================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'super_admin'
  AND p.code IN (
    'academic_years.create', 'academic_years.view', 'academic_years.manage',
    'semester_terms.create', 'semester_terms.view', 'semester_terms.manage',
    'academic_assignments.manage', 'academic_assignments.view'
  )
ON CONFLICT DO NOTHING;
