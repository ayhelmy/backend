-- =============================================================================
-- Migration 036 — Simulation Activity Sessions
-- Tracks when authenticated users (students, instructors) enter and exit
-- simulations from course lessons. Records duration, status, and exit reason.
-- Source of truth for time-on-simulation reporting for instructors/admins.
-- =============================================================================

CREATE TABLE IF NOT EXISTS simulation_activity_sessions (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id    UUID         NOT NULL REFERENCES institutions(id)    ON DELETE CASCADE,
  department_id     UUID         REFERENCES departments(id)              ON DELETE SET NULL,
  user_id           UUID         NOT NULL REFERENCES users(id)           ON DELETE CASCADE,
  user_role         VARCHAR(50)  NOT NULL,
  course_id         UUID         NOT NULL REFERENCES courses(id)         ON DELETE CASCADE,
  module_id         UUID         NOT NULL REFERENCES course_modules(id)  ON DELETE CASCADE,
  lesson_id         UUID         NOT NULL REFERENCES lessons(id)         ON DELETE CASCADE,
  simulation_id     UUID         NOT NULL REFERENCES simulations(id)     ON DELETE CASCADE,
  started_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  duration_seconds  INTEGER      NOT NULL DEFAULT 0,
  last_heartbeat_at TIMESTAMPTZ,
  status            VARCHAR(20)  NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'ended', 'abandoned', 'expired')),
  exit_reason       VARCHAR(30)
                    CHECK (exit_reason IN ('user_exit', 'navigation', 'browser_close', 'timeout', 'error')),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Core lookup indexes
CREATE INDEX IF NOT EXISTS idx_sim_act_user_id
  ON simulation_activity_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sim_act_course_id
  ON simulation_activity_sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_sim_act_lesson_id
  ON simulation_activity_sessions(lesson_id);
CREATE INDEX IF NOT EXISTS idx_sim_act_simulation_id
  ON simulation_activity_sessions(simulation_id);
CREATE INDEX IF NOT EXISTS idx_sim_act_institution_id
  ON simulation_activity_sessions(institution_id);
CREATE INDEX IF NOT EXISTS idx_sim_act_department_id
  ON simulation_activity_sessions(department_id) WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sim_act_status
  ON simulation_activity_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sim_act_started_at
  ON simulation_activity_sessions(started_at DESC);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_sim_act_course_user
  ON simulation_activity_sessions(course_id, user_id);
CREATE INDEX IF NOT EXISTS idx_sim_act_lesson_user
  ON simulation_activity_sessions(lesson_id, user_id);

-- Partial index used by the heartbeat cleanup job
CREATE INDEX IF NOT EXISTS idx_sim_act_active_heartbeat
  ON simulation_activity_sessions(last_heartbeat_at)
  WHERE status = 'active';
