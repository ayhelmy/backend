-- Migration 043: Track step-completion result per session.
-- NULL  = simulation has no steps defined (or session still active)
-- passed = student performed every step in the correct sequence
-- failed = session ended before all steps were completed in order

ALTER TABLE simulation_activity_sessions
  ADD COLUMN IF NOT EXISTS steps_status TEXT
    CHECK (steps_status IN ('passed', 'failed'));
