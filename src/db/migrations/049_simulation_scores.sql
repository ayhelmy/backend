-- =============================================================================
-- Migration 047 — Simulation Scores
--
-- Bridges simulation_activity_sessions (which never carries a score column --
-- Unity is a deliberate black box, only clicks/keys cross the postMessage
-- bridge today) to the gradebook. A row here represents one graded/gradeable
-- attempt at a simulation, sourced either from the Unity postMessage bridge
-- (Phase 3 adds a sim_score message type), an instructor manual entry, a
-- completion-rule auto-grade (e.g. steps_status='passed'), or an
-- imported/external score.
--
-- The unique constraint is scoped by course_id/lesson_id (not simulation_id
-- alone) because simulations are reusable catalog items -- the same simulation
-- can be attached to lessons in multiple different courses, and a
-- per-simulation_id-only constraint would wrongly block a student from having
-- independent scores in each course. A separate partial unique index on
-- simulation_activity_session_id gives us actual duplicate-submission
-- prevention (one score row per ended session).
-- =============================================================================

CREATE TABLE IF NOT EXISTS simulation_scores (
  id                              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_activity_session_id  UUID         REFERENCES simulation_activity_sessions(id) ON DELETE SET NULL,
  simulation_id                   UUID         NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  user_id                         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  institution_id                  UUID         NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  department_id                   UUID         REFERENCES departments(id) ON DELETE SET NULL,
  course_id                       UUID         NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  module_id                       UUID         REFERENCES course_modules(id) ON DELETE SET NULL,
  lesson_id                       UUID         REFERENCES lessons(id) ON DELETE SET NULL,

  attempt_number                  INTEGER      NOT NULL DEFAULT 1,

  score_source                    VARCHAR(20)  NOT NULL DEFAULT 'simulation'
                                  CHECK (score_source IN ('simulation','instructor','completion_rule','imported')),

  raw_score                       NUMERIC(8,2),
  points_possible                 NUMERIC(8,2),
  percentage                      NUMERIC(5,2),
  passed                          BOOLEAN,

  status                          VARCHAR(20)  NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','received','graded','overridden')),

  external_score_payload          JSONB,

  submitted_at                    TIMESTAMPTZ,
  graded_at                       TIMESTAMPTZ,
  graded_by                       UUID         REFERENCES users(id),
  override_reason                 TEXT,

  created_at                      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Scoped by course+lesson (not simulation_id alone) since simulations are
  -- reused across courses.
  CONSTRAINT simulation_scores_scope_attempt_unique
    UNIQUE (simulation_id, course_id, lesson_id, user_id, attempt_number)
);

-- Prevents duplicate score rows from double-submitting the same ended session.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sim_scores_session_unique
  ON simulation_scores(simulation_activity_session_id) WHERE simulation_activity_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sim_scores_simulation ON simulation_scores(simulation_id);
CREATE INDEX IF NOT EXISTS idx_sim_scores_user       ON simulation_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_sim_scores_course     ON simulation_scores(course_id);
CREATE INDEX IF NOT EXISTS idx_sim_scores_lesson     ON simulation_scores(lesson_id) WHERE lesson_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sim_scores_status     ON simulation_scores(status);
