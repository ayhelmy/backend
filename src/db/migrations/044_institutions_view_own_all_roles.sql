-- Grant institutions.view_own to all institution-scoped roles.
--
-- Every authenticated user's session fetches their own institution's basic
-- display info (name, logo) right after login (AuthContext) — this isn't
-- sensitive data and is needed regardless of role. Previously only
-- institution_admin had this permission, so dept_manager, instructor,
-- teaching_assistant, and student all got a 403 on GET /institutions/:id
-- on every single login. requireInstitutionScope() already restricts this
-- route to the caller's own institution, so this permission was only ever
-- gating "own institution" access, not exposing anything cross-tenant.

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name IN ('dept_manager', 'instructor', 'teaching_assistant', 'student')
  AND p.code = 'institutions.view_own'
ON CONFLICT DO NOTHING;
