-- =============================================================================
-- Migration 032 — Grant missing course permissions to institution_admin
--
-- Migration 015 omitted courses.publish from institution_admin's grant list.
-- The PATCH route was also tightened to courses.update_own only, which works
-- because institution_admin has update_own, but courses.publish was never
-- granted, causing POST /:id/publish to return 403.
--
-- This migration is idempotent (ON CONFLICT DO NOTHING).
-- =============================================================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name = 'institution_admin'
   AND p.code IN (
     'courses.publish',
     'courses.update_own',
     'courses.create'
   )
ON CONFLICT DO NOTHING;
