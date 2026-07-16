-- =============================================================================
-- Migration 003 — Roles, Permissions, and §12 RBAC Matrix (complete seed)
-- SRS §12: 9 roles × 23 permission codes
-- Roles: super_admin, institution_admin, dept_manager, instructor,
--        teaching_assistant, student, content_creator, simulation_developer, guest
-- =============================================================================

CREATE TABLE IF NOT EXISTS roles (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL UNIQUE,   -- machine identifier
  label       VARCHAR(100) NOT NULL,           -- display name
  description TEXT,
  is_system   BOOLEAN     NOT NULL DEFAULT FALSE, -- system roles cannot be deleted
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(100) NOT NULL UNIQUE,   -- e.g. "courses:create"
  resource    VARCHAR(50)  NOT NULL,           -- e.g. "courses"
  action      VARCHAR(50)  NOT NULL,           -- e.g. "create"
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       UUID NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Users can hold multiple roles, scoped to an institution
CREATE TABLE IF NOT EXISTS user_roles (
  user_id        UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id        UUID NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  institution_id UUID REFERENCES institutions (id) ON DELETE CASCADE,
  assigned_by    UUID REFERENCES users (id),
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id, institution_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user        ON user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_institution ON user_roles (institution_id);

-- -------------------------------------------------------------------------
-- Seed: 9 system roles (SRS §12)
-- -------------------------------------------------------------------------
INSERT INTO roles (name, label, description, is_system) VALUES
  ('super_admin',          'Super Admin',          'Full platform access; manages all institutions',   TRUE),
  ('institution_admin',    'Institution Admin',    'Full access within their institution',             TRUE),
  ('dept_manager',         'Department Manager',   'Manages courses and users within a department',    TRUE),
  ('instructor',           'Instructor',           'Creates and delivers courses',                     TRUE),
  ('teaching_assistant',   'Teaching Assistant',   'Assists instructor; limited grade access',         TRUE),
  ('student',              'Student',              'Enrolled learner; accesses assigned content',      TRUE),
  ('content_creator',      'Content Creator',      'Authors lessons and uploads media assets',         TRUE),
  ('simulation_developer', 'Simulation Developer', 'Builds and deploys simulations',                   TRUE),
  ('guest',                'Guest',                'Unauthenticated or anonymous demo access',         TRUE)
ON CONFLICT (name) DO NOTHING;

-- -------------------------------------------------------------------------
-- Seed: 23 permissions from §12 matrix
-- -------------------------------------------------------------------------
INSERT INTO permissions (code, resource, action, description) VALUES
  ('institutions:manage',     'institutions', 'manage',          'Create, edit, and delete institutions'),
  ('users:manage_all',        'users',        'manage_all',      'Manage all users across the institution'),
  ('users:manage_dept',       'users',        'manage_dept',     'Manage users within own department'),
  ('users:list',              'users',        'list',            'View user list and profiles'),
  ('courses:create',          'courses',      'create',          'Create and edit courses'),
  ('courses:publish',         'courses',      'publish',         'Publish and archive courses'),
  ('courses:delete',          'courses',      'delete',          'Delete courses'),
  ('modules:create',          'modules',      'create',          'Create and edit modules and lessons'),
  ('content:upload',          'content',      'upload',          'Upload media, files, and SCORM packages'),
  ('grades:view_all',         'grades',       'view_all',        'View grades for all students in a course'),
  ('grades:view_own',         'grades',       'view_own',        'View own grade records'),
  ('grades:override',         'grades',       'override',        'Manually override auto-calculated grades'),
  ('grades:export',           'grades',       'export',          'Export gradebook to CSV/PDF'),
  ('simulations:create',      'simulations',  'create',          'Create and configure simulations'),
  ('simulations:add_to_course','simulations', 'add_to_course',   'Add existing simulations to a course lesson'),
  ('simulations:launch',      'simulations',  'launch',          'Launch a simulation session'),
  ('simulations:analytics',   'simulations',  'analytics',       'View simulation usage and score analytics'),
  ('messages:send',           'messages',     'send',            'Send and receive direct messages'),
  ('analytics:view',          'analytics',    'view',            'View dashboards and learning analytics'),
  ('reports:export',          'reports',      'export',          'Export analytics reports'),
  ('roles:manage',            'roles',        'manage',          'Assign and revoke roles'),
  ('audit_logs:view',         'audit_logs',   'view',            'View the platform audit log'),
  ('settings:manage',         'settings',     'manage',          'Configure institution-level settings')
ON CONFLICT (code) DO NOTHING;

-- -------------------------------------------------------------------------
-- Seed: role_permissions — §12 permission matrix
-- Row = role, Columns = permissions granted
-- Fine-grained scoping (e.g. "own courses only") is enforced in service layer
-- -------------------------------------------------------------------------

-- Super Admin: ALL permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'super_admin'
ON CONFLICT DO NOTHING;

-- Institution Admin
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'institution_admin'
  AND p.code IN (
    'users:manage_all','users:manage_dept','users:list',
    'courses:create','courses:publish','courses:delete',
    'modules:create','content:upload',
    'grades:view_all','grades:view_own','grades:override','grades:export',
    'simulations:add_to_course','simulations:launch','simulations:analytics',
    'messages:send','analytics:view','reports:export',
    'audit_logs:view','settings:manage'
  )
ON CONFLICT DO NOTHING;

-- Department Manager
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'dept_manager'
  AND p.code IN (
    'users:manage_dept','users:list',
    'courses:create','courses:publish',
    'grades:view_all','grades:view_own','grades:export',
    'simulations:launch','simulations:analytics',
    'messages:send','analytics:view','reports:export'
  )
ON CONFLICT DO NOTHING;

-- Instructor
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'instructor'
  AND p.code IN (
    'users:list',
    'courses:create','courses:publish','courses:delete',
    'modules:create','content:upload',
    'grades:view_all','grades:view_own','grades:override','grades:export',
    'simulations:add_to_course','simulations:launch','simulations:analytics',
    'messages:send','analytics:view','reports:export'
  )
ON CONFLICT DO NOTHING;

-- Teaching Assistant
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'teaching_assistant'
  AND p.code IN (
    'grades:view_all','grades:view_own',
    'simulations:launch',
    'messages:send'
  )
ON CONFLICT DO NOTHING;

-- Student
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'student'
  AND p.code IN (
    'grades:view_own',
    'simulations:launch',
    'messages:send',
    'analytics:view'
  )
ON CONFLICT DO NOTHING;

-- Content Creator
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'content_creator'
  AND p.code IN (
    'modules:create','content:upload',
    'simulations:launch',
    'messages:send'
  )
ON CONFLICT DO NOTHING;

-- Simulation Developer
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'simulation_developer'
  AND p.code IN (
    'simulations:create','simulations:add_to_course',
    'simulations:launch','simulations:analytics',
    'messages:send','analytics:view'
  )
ON CONFLICT DO NOTHING;

-- Guest: demo launch only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'guest'
  AND p.code IN ('simulations:launch')
ON CONFLICT DO NOTHING;
