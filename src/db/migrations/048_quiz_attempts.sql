-- =============================================================================
-- Migration 046 — Quiz Attempts & Responses
-- Phase 1: schema + CRUD scaffolding only. The actual attempt lifecycle
-- (start/submit/autograde) is implemented in Phase 3.
-- =============================================================================

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id           UUID         NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id           UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  institution_id    UUID         NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  department_id     UUID         REFERENCES departments(id) ON DELETE SET NULL,
  course_id         UUID         NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lesson_id         UUID         REFERENCES lessons(id) ON DELETE SET NULL,

  attempt_number    INTEGER      NOT NULL DEFAULT 1,

  status            VARCHAR(30)  NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN (
                      'in_progress','submitted','graded',
                      'pending_manual_grading','expired','abandoned'
                    )),

  started_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  submitted_at      TIMESTAMPTZ,
  graded_at         TIMESTAMPTZ,
  time_spent_seconds INTEGER     NOT NULL DEFAULT 0,

  auto_score        NUMERIC(8,2),
  manual_score      NUMERIC(8,2),
  final_score       NUMERIC(8,2),
  points_possible   NUMERIC(8,2),
  percentage        NUMERIC(5,2),
  passed            BOOLEAN,

  graded_by         UUID         REFERENCES users(id),

  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT quiz_attempts_quiz_user_number_unique UNIQUE (quiz_id, user_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz      ON quiz_attempts(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user      ON quiz_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz_user ON quiz_attempts(quiz_id, user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_course    ON quiz_attempts(course_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_status    ON quiz_attempts(status);
-- "At most one in_progress attempt per quiz+user" is a service-layer invariant
-- (Phase 3) -- Postgres can't express it as a UNIQUE/CHECK without an exclusion
-- constraint; this partial index just makes that lookup fast for Phase 3.
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_in_progress ON quiz_attempts(quiz_id, user_id) WHERE status = 'in_progress';

CREATE TABLE IF NOT EXISTS quiz_responses (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id        UUID         NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  question_id       UUID         NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,

  response_payload  JSONB        NOT NULL DEFAULT '{}',
  is_correct        BOOLEAN,
  auto_score        NUMERIC(8,2),
  manual_score      NUMERIC(8,2),
  final_score       NUMERIC(8,2),
  feedback          TEXT,

  answered_at       TIMESTAMPTZ,
  graded_by         UUID         REFERENCES users(id),
  graded_at         TIMESTAMPTZ,

  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT quiz_responses_attempt_question_unique UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_quiz_responses_attempt  ON quiz_responses(attempt_id);
CREATE INDEX IF NOT EXISTS idx_quiz_responses_question ON quiz_responses(question_id);
