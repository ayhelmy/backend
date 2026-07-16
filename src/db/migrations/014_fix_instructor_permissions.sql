-- =============================================================================
-- Migration 014 — Remove users:list from instructor role
--
-- Instructors must not be able to enumerate the full user directory.
-- They interact with students only through course-enrollment endpoints.
-- This removes the over-broad users:list permission that was inadvertently
-- granted in 003_roles_permissions.sql.
-- =============================================================================

DELETE FROM role_permissions
WHERE role_id  = (SELECT id FROM roles WHERE name = 'instructor')
  AND permission_id = (SELECT id FROM permissions WHERE code = 'users:list');
