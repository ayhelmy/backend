-- =============================================================================
-- Migration 007 — Simulation Sessions and Event Log
-- SRS §4.7 SIM-03 (attempt tracking), §4.8 GRD-01 (auto-grading)
-- SRS §9: active_seconds excludes idle time; insert-only events table
-- §13.3 Scoring engine: step_score = step_max - (hints × penalty)
-- =============================================================================

CREATE TABLE IF NOT EXISTS simulation_sessions (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id         UUID         NOT NULL REFERENCES simulations (id) ON DELETE CASCADE,
  user_id               UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course_id             UUID         REFERENCES courses (id) ON DELETE SET NULL,
  lesson_id             UUID         REFERENCES lessons (id) ON DELETE SET NULL,
  attempt_number        INTEGER      NOT NULL DEFAULT 1,
  status                VARCHAR(20)  NOT NULL DEFAULT 'in_progress'  -- in_progress | completed | abandoned
                         CHECK (status IN ('in_progress','completed','abandoned')),
  score                 NUMERIC(5,2),                               -- computed from scoring_config (§13.3)
  max_score             NUMERIC(5,2) NOT NULL DEFAULT 100.00,
  active_seconds        INTEGER      NOT NULL DEFAULT 0,            -- time-on-task excluding idle (SRS §9)
  started_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  -- SCORM 2004 persistence (SIM-05; required for PLR-03 resume)
  scorm_suspend_data    TEXT,
  scorm_lesson_location VARCHAR(255)
);

-- Immutable step-level event log (SRS §13.2 step tracking; insert-only)
-- event_type examples: step_entered, step_completed, hint_used, step_failed, sim_paused
CREATE TABLE IF NOT EXISTS simulation_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID        NOT NULL REFERENCES simulation_sessions (id) ON DELETE CASCADE,
  event_type  VARCHAR(50) NOT NULL,
  payload     JSONB,                                               -- step_id, hint_id, score_delta, etc.
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user       ON simulation_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_simulation ON simulation_sessions (simulation_id);
CREATE INDEX IF NOT EXISTS idx_sessions_course     ON simulation_sessions (course_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status     ON simulation_sessions (status);
CREATE INDEX IF NOT EXISTS idx_events_session      ON simulation_events (session_id);
CREATE INDEX IF NOT EXISTS idx_events_occurred     ON simulation_events (occurred_at DESC);
