-- =============================================================================
-- Migration 033 — Adjust dept_manager course permissions
--
-- dept_manager should be able to view course details (courses.view_department
-- is already present) but must NOT manage enrollments — that belongs to
-- instructors and institution_admins only.
--
-- This migration is idempotent.
-- =============================================================================

DELETE FROM role_permissions
 WHERE role_id  = (SELECT id FROM roles       WHERE name = 'dept_manager')
   AND permission_id = (SELECT id FROM permissions WHERE code = 'courses.manage_enrollments');
