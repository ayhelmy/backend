-- =============================================================================
-- Migration 050 — Lesson Quiz Mode
-- Extends lesson_mode enum with 4 new quiz combinations and adds a
-- denormalized quiz_id column mirroring the existing simulation_id column.
-- Existing lessons are unaffected: lesson_mode values are additive, quiz_id
-- defaults to NULL, no rows are touched.
--
-- Sync invariant (service-layer, not DB-enforced beyond the two unique
-- indexes on lessons.quiz_id / quizzes.lesson_id): whenever a quiz is
-- attached to or detached from a lesson, modules-lessons and quizzes services
-- must update both lessons.quiz_id and quizzes.lesson_id together, the same
-- way simulation_id attachment is already handled for simulations today.
-- =============================================================================

-- Relax lesson_mode CHECK to add 4 new combinations. Verified against the dev
-- DB that migration 028's inline "ADD COLUMN ... CHECK (...)" auto-named this
-- constraint 'lessons_lesson_mode_check' (Postgres default <table>_<column>_check).
DO $$
BEGIN
  BEGIN
    ALTER TABLE lessons DROP CONSTRAINT lessons_lesson_mode_check;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  ALTER TABLE lessons ADD CONSTRAINT lessons_lesson_mode_check
    CHECK (lesson_mode IN (
      'content', 'simulation', 'content_and_simulation',
      'quiz', 'content_and_quiz', 'simulation_and_quiz', 'content_simulation_and_quiz'
    ));
END $$;

ALTER TABLE lessons ADD COLUMN IF NOT EXISTS quiz_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_lessons_quiz' AND table_name = 'lessons'
  ) THEN
    ALTER TABLE lessons ADD CONSTRAINT fk_lessons_quiz FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lessons_quiz_id ON lessons(quiz_id) WHERE quiz_id IS NOT NULL;
