-- =============================================================================
-- Migration 045 — Quiz Questions & Options
--
-- Question-type split:
--   NORMALIZED OPTIONS TABLE (quiz_question_options) used for:
--     single_choice, multiple_choice, true_false
--   JSONB-ONLY (question_data) used for:
--     short_text, long_text, numeric, numeric_tolerance, matching, ordering,
--     fill_in_blank, multiple_fill_in_blank, hotspot, file_upload, formula
--   Rationale: matching/ordering/fill-blank have structurally different shapes
--   (pairs, sequences, multiple blanks) that do not fit a flat "one row per
--   selectable option" table. single/multiple-choice and true/false map 1:1
--   onto discrete, gradable options and read naturally from a normalized table
--   (enables per-option feedback rows without JSONB surgery).
-- =============================================================================

CREATE TABLE IF NOT EXISTS quiz_questions (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id                UUID         NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,

  qti_identifier         VARCHAR(255),

  question_type          VARCHAR(30)  NOT NULL
                         CHECK (question_type IN (
                           'single_choice','multiple_choice','true_false',
                           'short_text','long_text',
                           'numeric','numeric_tolerance',
                           'matching','ordering',
                           'fill_in_blank','multiple_fill_in_blank',
                           'hotspot','file_upload','formula'
                         )),

  title                  VARCHAR(255),
  prompt                 TEXT         NOT NULL,

  response_identifier    VARCHAR(255),

  points                 NUMERIC(8,2) NOT NULL DEFAULT 1.00,
  position               INTEGER      NOT NULL DEFAULT 0,
  required               BOOLEAN      NOT NULL DEFAULT TRUE,
  manual_grading         BOOLEAN      NOT NULL DEFAULT FALSE,
  shuffle_options        BOOLEAN      NOT NULL DEFAULT FALSE,

  question_data          JSONB        NOT NULL DEFAULT '{}',
  response_declaration   JSONB        NOT NULL DEFAULT '{}',
  scoring_config         JSONB        NOT NULL DEFAULT '{}',
  feedback_config        JSONB        NOT NULL DEFAULT '{}',

  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz     ON quiz_questions(quiz_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_quiz_questions_position ON quiz_questions(quiz_id, position);

CREATE TABLE IF NOT EXISTS quiz_question_options (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id        UUID         NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  option_identifier  VARCHAR(255) NOT NULL,
  content            TEXT         NOT NULL,
  is_correct         BOOLEAN      NOT NULL DEFAULT FALSE,
  position           INTEGER      NOT NULL DEFAULT 0,
  feedback           TEXT,

  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT quiz_question_options_unique UNIQUE (question_id, option_identifier)
);

CREATE INDEX IF NOT EXISTS idx_quiz_question_options_question ON quiz_question_options(question_id);
CREATE INDEX IF NOT EXISTS idx_quiz_question_options_position ON quiz_question_options(question_id, position);
