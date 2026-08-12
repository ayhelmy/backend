-- =============================================================================
-- Migration 058 — LTI Platform / Key management permissions
-- Additive to RBAC v2 (015). Does not edit 015. Idempotent.
-- NOTE: unlike permissions that existed when 015's super_admin CROSS JOIN ran,
-- these are new codes — super_admin does NOT get them automatically and must
-- be granted explicitly below.
-- =============================================================================

INSERT INTO permissions (code, resource, action, description) VALUES
  ('lti_platforms.view_all',   'lti_platforms', 'view_all',   'View LTI platform registrations for any institution'),
  ('lti_platforms.manage_all', 'lti_platforms', 'manage_all', 'Create/update/activate LTI platform registrations for any institution'),
  ('lti_platforms.view_own',   'lti_platforms', 'view_own',   'View LTI platform registrations for own institution'),
  ('lti_platforms.manage_own', 'lti_platforms', 'manage_own', 'Create/update/activate LTI platform registrations for own institution'),
  ('lti_keys.view',            'lti_keys',      'view',       'View the tool''s LTI signing key metadata (kid, fingerprint)'),
  ('lti_keys.manage',          'lti_keys',      'manage',     'Generate and rotate the tool''s LTI signing keypair')
ON CONFLICT (code) DO NOTHING;

-- super_admin: explicit grant — the tool's signing identity is platform-wide,
-- so super_admin gets everything including key management.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'super_admin'
  AND p.code IN (
    'lti_platforms.view_all','lti_platforms.manage_all',
    'lti_platforms.view_own','lti_platforms.manage_own',
    'lti_keys.view','lti_keys.manage'
  )
ON CONFLICT DO NOTHING;

-- institution_admin: own-institution scope only, no key management (tool
-- signing keys are platform-wide, not institution-scoped).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'institution_admin'
  AND p.code IN ('lti_platforms.view_own','lti_platforms.manage_own')
ON CONFLICT DO NOTHING;
