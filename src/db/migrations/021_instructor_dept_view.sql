-- Grant instructors read access to departments so they can pick one when creating a course.
-- GET /institutions/:id/departments requires institutions.view_own OR departments.view.
-- Instructors had neither, so the department selector returned empty.

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'instructor'
  AND p.code = 'departments.view'
ON CONFLICT DO NOTHING;
