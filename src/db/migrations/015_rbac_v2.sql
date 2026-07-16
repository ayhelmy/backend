-- =============================================================================
-- Migration 015 — RBAC v2: 7-role model with 78 granular permissions
--
-- Changes:
--   1. Deprecate content_creator and simulation_developer (soft, not deleted)
--   2. Add context columns to user_roles for scoped role assignments
--   3. Add user_departments, course_teaching_assistants tables
--   4. Add simulation_catalogs + institution_simulation_catalogs tables
--   5. Replace all old permissions (colon notation) with new dot notation (78 total)
--   6. Re-map permissions to 7 active roles
-- =============================================================================

-- ── 1. Deprecate removed roles (keep rows for audit trail, mark deprecated) ──

UPDATE roles
SET label       = '[DEPRECATED] ' || label,
    description = '[DEPRECATED — removed in RBAC v2] ' || COALESCE(description, ''),
    is_system   = FALSE
WHERE name IN ('content_creator', 'simulation_developer')
  AND label NOT LIKE '[DEPRECATED]%';

-- ── 2. Add context support to user_roles ─────────────────────────────────────
-- context_type: platform | institution | department | course
-- context_id:   UUID of the scoped entity (NULL for platform)

ALTER TABLE user_roles
  ADD COLUMN IF NOT EXISTS context_type VARCHAR(20) DEFAULT 'institution',
  ADD COLUMN IF NOT EXISTS context_id   UUID;

-- Backfill: copy institution_id → context_id for existing institution-scoped rows
UPDATE user_roles
SET context_type = 'institution',
    context_id   = institution_id
WHERE context_id IS NULL AND institution_id IS NOT NULL;

-- Platform-level assignments (super_admin with NULL institution_id)
UPDATE user_roles
SET context_type = 'platform',
    context_id   = NULL
WHERE context_id IS NULL AND institution_id IS NULL;

-- ── 3. New supporting tables ──────────────────────────────────────────────────

-- user_departments: records which department(s) a dept_manager manages
CREATE TABLE IF NOT EXISTS user_departments (
  user_id        UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  department_id  UUID NOT NULL REFERENCES departments (id) ON DELETE CASCADE,
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by    UUID REFERENCES users (id),
  PRIMARY KEY (user_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_user_departments_user ON user_departments (user_id);
CREATE INDEX IF NOT EXISTS idx_user_departments_dept ON user_departments (department_id);

-- course_teaching_assistants: TA-to-course assignments
CREATE TABLE IF NOT EXISTS course_teaching_assistants (
  course_id   UUID NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID REFERENCES users (id),
  PRIMARY KEY (course_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_course_ta_course ON course_teaching_assistants (course_id);
CREATE INDEX IF NOT EXISTS idx_course_ta_user   ON course_teaching_assistants (user_id);

-- simulation_catalogs: platform-level simulation catalog entries
CREATE TABLE IF NOT EXISTS simulation_catalogs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  is_global   BOOLEAN     NOT NULL DEFAULT TRUE,
  is_demo     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_by  UUID REFERENCES users (id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- institution_simulation_catalogs: which catalogs are assigned to an institution
CREATE TABLE IF NOT EXISTS institution_simulation_catalogs (
  institution_id        UUID NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
  simulation_catalog_id UUID NOT NULL REFERENCES simulation_catalogs (id) ON DELETE CASCADE,
  assigned_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by           UUID REFERENCES users (id),
  PRIMARY KEY (institution_id, simulation_catalog_id)
);

-- ── 4. Replace all permissions with new v2 dot-notation set ──────────────────

-- 4a. Remove all existing role_permissions for the 7 active system roles
--     (content_creator and simulation_developer role_permissions are also cleared)
DELETE FROM role_permissions;

-- 4b. Remove all old permission definitions
DELETE FROM permissions;

-- 4c. Insert 78 new permissions (dot notation)

-- Platform (4)
INSERT INTO permissions (code, resource, action, description) VALUES
  ('platform.manage',          'platform',  'manage',          'Full platform management: system config, feature flags'),
  ('platform.settings.manage', 'platform',  'settings_manage', 'Configure platform-level settings'),
  ('platform.audit.view',      'platform',  'audit_view',      'View all platform audit logs'),
  ('platform.reports.view',    'platform',  'reports_view',    'View all platform-wide reports')
ON CONFLICT (code) DO NOTHING;

-- Institutions (6)
INSERT INTO permissions (code, resource, action, description) VALUES
  ('institutions.create',       'institutions', 'create',       'Create new institutions'),
  ('institutions.view_all',     'institutions', 'view_all',     'List and view all institutions'),
  ('institutions.manage_all',   'institutions', 'manage_all',   'Update or delete any institution'),
  ('institutions.view_own',     'institutions', 'view_own',     'View own institution details'),
  ('institutions.manage_own',   'institutions', 'manage_own',   'Update own institution branding and settings'),
  ('institutions.assign_admin', 'institutions', 'assign_admin', 'Assign institution_admin role to a user')
ON CONFLICT (code) DO NOTHING;

-- Departments (4)
INSERT INTO permissions (code, resource, action, description) VALUES
  ('departments.create',         'departments', 'create',         'Create departments within an institution'),
  ('departments.view',           'departments', 'view',           'View department details and membership'),
  ('departments.manage',         'departments', 'manage',         'Update and delete departments'),
  ('departments.assign_manager', 'departments', 'assign_manager', 'Assign dept_manager role to a user')
ON CONFLICT (code) DO NOTHING;

-- Users (13)
INSERT INTO permissions (code, resource, action, description) VALUES
  ('users.create',             'users', 'create',             'Create new user accounts'),
  ('users.view_all',           'users', 'view_all',           'View all users platform-wide'),
  ('users.view_institution',   'users', 'view_institution',   'View users within own institution'),
  ('users.view_department',    'users', 'view_department',    'View users within own department'),
  ('users.view_course',        'users', 'view_course',        'View enrolled users within a course'),
  ('users.update_all',         'users', 'update_all',         'Update any user platform-wide'),
  ('users.update_institution', 'users', 'update_institution', 'Update users within own institution'),
  ('users.update_department',  'users', 'update_department',  'Update users within own department'),
  ('users.assign_roles',       'users', 'assign_roles',       'Assign roles to users'),
  ('users.assign_department',  'users', 'assign_department',  'Assign users to departments'),
  ('users.assign_course',      'users', 'assign_course',      'Enroll users into courses'),
  ('users.suspend',            'users', 'suspend',            'Suspend or reactivate user accounts'),
  ('users.delete',             'users', 'delete',             'Soft-delete user accounts')
ON CONFLICT (code) DO NOTHING;

-- Roles / Permissions (2)
INSERT INTO permissions (code, resource, action, description) VALUES
  ('roles.manage',       'roles',       'manage', 'Create, update, and assign roles'),
  ('permissions.manage', 'permissions', 'manage', 'Assign or remove individual permissions from roles')
ON CONFLICT (code) DO NOTHING;

-- Courses (13)
INSERT INTO permissions (code, resource, action, description) VALUES
  ('courses.create',            'courses', 'create',            'Create new courses'),
  ('courses.view_all',          'courses', 'view_all',          'View all courses platform-wide'),
  ('courses.view_institution',  'courses', 'view_institution',  'View all courses within own institution'),
  ('courses.view_department',   'courses', 'view_department',   'View courses within own department'),
  ('courses.view_own',          'courses', 'view_own',          'View own or enrolled/assigned courses'),
  ('courses.update_all',        'courses', 'update_all',        'Update any course within institution'),
  ('courses.update_department', 'courses', 'update_department', 'Update courses within own department'),
  ('courses.update_own',        'courses', 'update_own',        'Update own created courses'),
  ('courses.publish',           'courses', 'publish',           'Publish a course'),
  ('courses.archive',           'courses', 'archive',           'Archive a course'),
  ('courses.assign_instructor', 'courses', 'assign_instructor', 'Assign an instructor to a course'),
  ('courses.assign_ta',         'courses', 'assign_ta',         'Assign a teaching assistant to a course'),
  ('courses.manage_enrollments','courses', 'manage_enrollments','Approve, reject, or manage course enrollments')
ON CONFLICT (code) DO NOTHING;

-- Lessons & Content (5)
INSERT INTO permissions (code, resource, action, description) VALUES
  ('lessons.create', 'lessons', 'create', 'Create modules and lessons within own courses'),
  ('lessons.update', 'lessons', 'update', 'Edit modules and lessons'),
  ('lessons.delete', 'lessons', 'delete', 'Delete modules and lessons'),
  ('lessons.view',   'lessons', 'view',   'View course modules and lesson content'),
  ('media.upload',   'media',   'upload', 'Upload media files, SCORM packages, and attachments')
ON CONFLICT (code) DO NOTHING;

-- Simulation Catalogs (12)
INSERT INTO permissions (code, resource, action, description) VALUES
  ('simulation_catalogs.manage_global',        'simulation_catalogs', 'manage_global',        'Create and manage global simulation catalog'),
  ('simulation_catalogs.assign_to_institution','simulation_catalogs', 'assign_to_institution','Assign catalog items to institutions'),
  ('simulation_catalogs.view_assigned',        'simulation_catalogs', 'view_assigned',        'View simulation catalog assigned to own institution'),
  ('simulations.view_catalog',                 'simulations',         'view_catalog',         'Browse the full simulation catalog'),
  ('simulations.view_demo',                    'simulations',         'view_demo',            'View publicly available demo simulations'),
  ('simulations.add_to_course',                'simulations',         'add_to_course',        'Embed a simulation into a course lesson'),
  ('simulations.launch',                       'simulations',         'launch',               'Launch a simulation session'),
  ('simulations.launch_demo',                  'simulations',         'launch_demo',          'Launch a public demo simulation without auth'),
  ('simulation_sessions.view_own',             'simulation_sessions', 'view_own',             'View own simulation session results'),
  ('simulation_sessions.view_course',          'simulation_sessions', 'view_course',          'View simulation sessions for a whole course'),
  ('simulation_sessions.view_department',      'simulation_sessions', 'view_department',      'View simulation sessions across a department'),
  ('simulation_sessions.manage',               'simulation_sessions', 'manage',               'Reset or manage simulation sessions')
ON CONFLICT (code) DO NOTHING;

-- Grades & Progress (8)
INSERT INTO permissions (code, resource, action, description) VALUES
  ('grades.view_own',         'grades',   'view_own',         'View own grade records'),
  ('grades.view_course',      'grades',   'view_course',      'View grade records for all students in a course'),
  ('grades.view_department',  'grades',   'view_department',  'View aggregated grades across a department'),
  ('grades.edit_course',      'grades',   'edit_course',      'Create and update grade items for a course'),
  ('grades.override',         'grades',   'override',         'Override a calculated grade'),
  ('progress.view_own',       'progress', 'view_own',         'View own learning progress'),
  ('progress.view_course',    'progress', 'view_course',      'View progress for all students in a course'),
  ('progress.view_department','progress', 'view_department',  'View progress across a department')
ON CONFLICT (code) DO NOTHING;

-- Reports (4)
INSERT INTO permissions (code, resource, action, description) VALUES
  ('reports.view_platform',    'reports', 'view_platform',    'View platform-wide analytics reports'),
  ('reports.view_institution', 'reports', 'view_institution', 'View institution-level analytics reports'),
  ('reports.view_department',  'reports', 'view_department',  'View department-level reports'),
  ('reports.view_course',      'reports', 'view_course',      'View course-level engagement reports')
ON CONFLICT (code) DO NOTHING;

-- Messages & Notifications (4)
INSERT INTO permissions (code, resource, action, description) VALUES
  ('messages.send',             'messages',      'send',        'Send direct messages'),
  ('messages.view',             'messages',      'view',        'View received messages'),
  ('notifications.view',        'notifications', 'view',        'View system and course notifications'),
  ('notifications.manage_own',  'notifications', 'manage_own',  'Manage own notification preferences')
ON CONFLICT (code) DO NOTHING;

-- Audit (3)
INSERT INTO permissions (code, resource, action, description) VALUES
  ('audit.view_platform',    'audit', 'view_platform',    'View all platform-level audit events'),
  ('audit.view_institution', 'audit', 'view_institution', 'View audit events within own institution'),
  ('audit.view_department',  'audit', 'view_department',  'View audit events within own department')
ON CONFLICT (code) DO NOTHING;

-- ── 5. Map permissions to roles ───────────────────────────────────────────────

-- super_admin: ALL permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'super_admin'
ON CONFLICT DO NOTHING;

-- institution_admin (31 permissions)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'institution_admin'
  AND p.code IN (
    'institutions.view_own', 'institutions.manage_own',
    'departments.create', 'departments.view', 'departments.manage', 'departments.assign_manager',
    'users.create', 'users.view_institution', 'users.update_institution',
    'users.assign_roles', 'users.assign_department', 'users.suspend', 'users.delete',
    'courses.view_institution', 'courses.update_all', 'courses.assign_instructor',
    'courses.assign_ta', 'courses.manage_enrollments', 'courses.archive', 'courses.update_own',
    'simulation_catalogs.view_assigned', 'simulations.view_catalog',
    'grades.view_course', 'grades.view_department',
    'reports.view_institution',
    'messages.send', 'messages.view', 'notifications.view', 'notifications.manage_own',
    'audit.view_institution', 'platform.settings.manage'
  )
ON CONFLICT DO NOTHING;

-- dept_manager (22 permissions)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'dept_manager'
  AND p.code IN (
    'departments.view',
    'users.view_department', 'users.update_department', 'users.assign_department',
    'courses.view_department', 'courses.update_department',
    'courses.assign_instructor', 'courses.assign_ta', 'courses.manage_enrollments',
    'grades.view_department', 'grades.view_course',
    'progress.view_department', 'progress.view_course',
    'reports.view_department',
    'messages.send', 'messages.view', 'notifications.view', 'notifications.manage_own',
    'audit.view_department',
    'simulation_sessions.view_department',
    'simulation_catalogs.view_assigned', 'simulations.view_catalog'
  )
ON CONFLICT DO NOTHING;

-- instructor (28 permissions)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'instructor'
  AND p.code IN (
    'courses.create', 'courses.view_own', 'courses.update_own', 'courses.view_institution',
    'courses.publish', 'courses.archive', 'courses.assign_ta', 'courses.manage_enrollments',
    'lessons.create', 'lessons.update', 'lessons.delete', 'lessons.view',
    'media.upload',
    'simulation_catalogs.view_assigned', 'simulations.view_catalog',
    'simulations.add_to_course', 'simulations.launch',
    'simulation_sessions.view_course', 'simulation_sessions.manage',
    'grades.view_course', 'grades.edit_course', 'grades.override',
    'progress.view_course',
    'reports.view_course',
    'messages.send', 'messages.view', 'notifications.view', 'notifications.manage_own'
  )
ON CONFLICT DO NOTHING;

-- teaching_assistant (10 permissions)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'teaching_assistant'
  AND p.code IN (
    'courses.view_own', 'lessons.view',
    'simulations.launch', 'simulation_sessions.view_course',
    'grades.view_course', 'progress.view_course',
    'messages.send', 'messages.view', 'notifications.view', 'notifications.manage_own'
  )
ON CONFLICT DO NOTHING;

-- student (10 permissions)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'student'
  AND p.code IN (
    'courses.view_own', 'lessons.view',
    'simulations.launch', 'simulation_sessions.view_own',
    'grades.view_own', 'progress.view_own',
    'messages.send', 'messages.view', 'notifications.view', 'notifications.manage_own'
  )
ON CONFLICT DO NOTHING;

-- guest (2 permissions)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'guest'
  AND p.code IN ('simulations.view_demo', 'simulations.launch_demo')
ON CONFLICT DO NOTHING;

-- ── 6. Ensure 7 active roles exist (idempotent) ───────────────────────────────
INSERT INTO roles (name, label, description, is_system) VALUES
  ('super_admin',        'Super Admin',          'Full platform management; creates institutions and assigns admins', TRUE),
  ('institution_admin',  'Institution Admin',    'Manages all users, departments, and courses within own institution', TRUE),
  ('dept_manager',       'Department Manager',   'Oversees courses and users within an assigned department', TRUE),
  ('instructor',         'Instructor',           'Creates and delivers courses; manages enrollments and grades', TRUE),
  ('teaching_assistant', 'Teaching Assistant',   'Assists instructor with grading and student support', TRUE),
  ('student',            'Student',              'Enrolled learner; accesses assigned courses and simulations', TRUE),
  ('guest',              'Guest',                'Unauthenticated demo access to public simulations', TRUE)
ON CONFLICT (name) DO UPDATE SET
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  is_system   = TRUE;

-- ── NOTE: After running this migration, flush Redis permission caches ─────────
-- Run in Redis CLI: FLUSHDB
-- Or selectively: SCAN 0 MATCH user_perms:* COUNT 1000 then DEL each key
