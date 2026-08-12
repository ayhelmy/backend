-- =============================================================================
-- Migration 049 — Grade Source Tracing
-- Adds nullable source-tracing columns to grades so a grade row can be
-- traced back to the quiz attempt or simulation score that produced it.
-- Existing grades rows are untouched (columns are nullable, no backfill,
-- no default value changes to existing columns).
--
-- grades_item_user_unique (from migration 008) is untouched and keeps
-- preventing duplicate active grade rows per student+item -- the
-- quiz/simulation auto-grade path (Phase 3) must UPSERT via that same key,
-- exactly like GradeModel's existing manual-grade path.
-- =============================================================================

ALTER TABLE grades
  ADD COLUMN IF NOT EXISTS quiz_attempt_id UUID REFERENCES quiz_attempts(id) ON DELETE SET NULL;

ALTER TABLE grades
  ADD COLUMN IF NOT EXISTS simulation_score_id UUID REFERENCES simulation_scores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_grades_quiz_attempt     ON grades(quiz_attempt_id)     WHERE quiz_attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grades_simulation_score ON grades(simulation_score_id) WHERE simulation_score_id IS NOT NULL;
