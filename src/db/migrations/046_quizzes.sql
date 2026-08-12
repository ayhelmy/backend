-- =============================================================================
-- Migration 044 — Quizzes (instructor-authored, QTI-based)
-- Phase 1: schema only. QTI import/authoring UI is Phase 2. Attempt/scoring
-- engine is Phase 3.
-- =============================================================================

CREATE TABLE IF NOT EXISTS quizzes (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id         UUID         NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  department_id          UUID         REFERENCES departments(id) ON DELETE SET NULL,
  course_id              UUID         NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  module_id              UUID         REFERENCES course_modules(id) ON DELETE SET NULL,
  lesson_id              UUID         REFERENCES lessons(id) ON DELETE SET NULL,

  title                  VARCHAR(255) NOT NULL,
  description            TEXT,
  instructions           TEXT,

  qti_identifier         VARCHAR(255),
  qti_version            VARCHAR(20),

  points_possible        NUMERIC(8,2) NOT NULL DEFAULT 100.00,
  passing_score          NUMERIC(8,2),
  passing_percentage     NUMERIC(5,2),

  max_attempts           INTEGER      NOT NULL DEFAULT 1,
  attempt_scoring_mode   VARCHAR(20)  NOT NULL DEFAULT 'latest'
                         CHECK (attempt_scoring_mode IN ('latest','highest','first','average')),

  time_limit_seconds     INTEGER,

  shuffle_questions      BOOLEAN      NOT NULL DEFAULT FALSE,
  shuffle_answers        BOOLEAN      NOT NULL DEFAULT FALSE,
  one_question_at_a_time BOOLEAN      NOT NULL DEFAULT FALSE,
  allow_back_navigation  BOOLEAN      NOT NULL DEFAULT TRUE,

  show_score_policy      VARCHAR(30)  NOT NULL DEFAULT 'immediately'
                         CHECK (show_score_policy IN ('immediately','after_due_date','after_final_attempt','never')),
  show_answers_policy    VARCHAR(30)  NOT NULL DEFAULT 'after_final_attempt'
                         CHECK (show_answers_policy IN ('immediately','after_due_date','after_final_attempt','never')),
  grade_release_mode     VARCHAR(20)  NOT NULL DEFAULT 'automatic'
                         CHECK (grade_release_mode IN ('automatic','instructor_approval')),

  available_from         TIMESTAMPTZ,
  due_at                 TIMESTAMPTZ,
  available_until        TIMESTAMPTZ,

  status                 VARCHAR(20)  NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','published','archived')),

  created_by             UUID         NOT NULL REFERENCES users(id),
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at             TIMESTAMPTZ
);

-- A quiz belongs to at most one lesson (unlike simulations, which are reusable
-- catalog items referenced from many lessons). This partial unique index is the
-- authoritative constraint; lessons.quiz_id (migration 050) is a denormalized
-- read-optimization the service layer keeps in sync with this side.
CREATE UNIQUE INDEX IF NOT EXISTS idx_quizzes_lesson_unique ON quizzes(lesson_id) WHERE lesson_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quizzes_course      ON quizzes(course_id)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_quizzes_module      ON quizzes(module_id)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_quizzes_institution  ON quizzes(institution_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_quizzes_status       ON quizzes(status)         WHERE deleted_at IS NULL;
