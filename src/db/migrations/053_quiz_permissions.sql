-- =============================================================================
-- Migration 051 — Quiz, Quiz-Attempt, Simulation-Score, Grade-Category permissions
-- Additive to RBAC v2 (015). Does not edit 015. Idempotent.
-- =============================================================================

INSERT INTO permissions (code, resource, action, description) VALUES
  ('quizzes.create',      'quizzes', 'create',      'Author a new quiz within a course'),
  ('quizzes.view_course', 'quizzes', 'view_course', 'View quizzes and questions within a course'),
  ('quizzes.update',      'quizzes', 'update',      'Edit quiz settings and questions'),
  ('quizzes.delete',      'quizzes', 'delete',      'Soft-delete a quiz'),
  ('quizzes.publish',     'quizzes', 'publish',     'Publish a quiz, making it available to students'),
  ('quizzes.view_own',    'quizzes', 'view_own',    'View quizzes within own enrolled/assigned courses'),

  ('quiz_attempts.view_own',    'quiz_attempts', 'view_own',    'View own quiz attempts and responses'),
  ('quiz_attempts.view_course', 'quiz_attempts', 'view_course', 'View all quiz attempts for students in a course'),
  ('quiz_attempts.manage',      'quiz_attempts', 'manage',      'Manually grade quiz attempts'),

  ('simulation_scores.view_own',    'simulation_scores', 'view_own',    'View own simulation scores'),
  ('simulation_scores.view_course', 'simulation_scores', 'view_course', 'View simulation scores for students in a course'),
  ('simulation_scores.manage',      'simulation_scores', 'manage',      'Manually enter or override simulation scores'),

  ('grade_categories.view',   'grade_categories', 'view',   'View grade category structure for a course'),
  ('grade_categories.manage', 'grade_categories', 'manage', 'Create, edit, and delete grade categories')
ON CONFLICT (code) DO NOTHING;

-- instructor: full authoring + grading control within own courses
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'instructor'
  AND p.code IN (
    'quizzes.create', 'quizzes.view_course', 'quizzes.update', 'quizzes.delete', 'quizzes.publish',
    'quiz_attempts.view_course', 'quiz_attempts.manage',
    'simulation_scores.view_course', 'simulation_scores.manage',
    'grade_categories.view', 'grade_categories.manage'
  )
ON CONFLICT DO NOTHING;

-- teaching_assistant: view + grade (per-question grading only -- final-grade
-- override stays gated behind the existing 'grades.override' permission,
-- which TAs do not have), no authoring/category management
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'teaching_assistant'
  AND p.code IN (
    'quizzes.view_course',
    'quiz_attempts.view_course', 'quiz_attempts.manage',
    'simulation_scores.view_course', 'simulation_scores.manage',
    'grade_categories.view'
  )
ON CONFLICT DO NOTHING;

-- student: own view only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'student'
  AND p.code IN (
    'quizzes.view_own',
    'quiz_attempts.view_own',
    'simulation_scores.view_own'
  )
ON CONFLICT DO NOTHING;

-- dept_manager / institution_admin: read-only oversight (mirrors
-- grades.view_department / grades.view_course grants to those roles)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('dept_manager', 'institution_admin')
  AND p.code IN (
    'quizzes.view_course', 'quiz_attempts.view_course',
    'simulation_scores.view_course', 'grade_categories.view'
  )
ON CONFLICT DO NOTHING;

-- super_admin already has ALL permissions via migration 015's cross join.
