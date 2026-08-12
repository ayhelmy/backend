-- =============================================================================
-- Migration 008 — Grades and Student Progress
-- SRS §4.8 GRD-01 – GRD-07; §4.9 PRG-01 – PRG-05
-- SRS §9: grades use polymorphic grade_item_type + grade_item_id;
--         is_override + override_note for manual adjustments (GRD-05)
-- =============================================================================

-- Grade items define the gradebook structure (GRD-01 gradebook grid)
-- Each gradeable activity (simulation, assignment, quiz) has one grade_item row per course
CREATE TABLE IF NOT EXISTS grade_items (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     UUID        NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  title         VARCHAR(255) NOT NULL,
  item_type     VARCHAR(30) NOT NULL DEFAULT 'simulation'      -- simulation | assignment | quiz | participation
                 CHECK (item_type IN ('simulation','assignment','quiz','participation')),
  lesson_id     UUID        REFERENCES lessons (id) ON DELETE SET NULL,
  simulation_id UUID        REFERENCES simulations (id) ON DELETE SET NULL,
  max_points    NUMERIC(8,2) NOT NULL DEFAULT 100.00,
  weight        NUMERIC(5,4) NOT NULL DEFAULT 1.0000,          -- contribution to weighted course grade
  due_date      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grade_items_course ON grade_items (course_id);

-- Individual student grades (SRS §9)
CREATE TABLE IF NOT EXISTS grades (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  grade_item_id   UUID        NOT NULL REFERENCES grade_items (id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  score           NUMERIC(8,2),                                -- actual score earned
  points_possible NUMERIC(8,2),                               -- snapshot of max_points at grading time
  is_override     BOOLEAN     NOT NULL DEFAULT FALSE,          -- TRUE when instructor manually set (GRD-05)
  override_note   TEXT,                                        -- reason for manual override
  graded_by       UUID        REFERENCES users (id),           -- NULL = auto-graded by scoring engine
  graded_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT grades_item_user_unique UNIQUE (grade_item_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_grades_user ON grades (user_id);
CREATE INDEX IF NOT EXISTS idx_grades_item ON grades (grade_item_id);

-- -------------------------------------------------------------------------
-- Progress tracking (SRS §4.9 PRG-01 – PRG-05)
-- -------------------------------------------------------------------------

-- Lesson-level completion (PRG-01)
CREATE TABLE IF NOT EXISTS lesson_progress (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lesson_id       UUID        NOT NULL REFERENCES lessons (id) ON DELETE CASCADE,
  status          VARCHAR(20) NOT NULL DEFAULT 'not_started'   -- not_started | in_progress | completed
                   CHECK (status IN ('not_started','in_progress','completed')),
  completed_at    TIMESTAMPTZ,
  time_spent_sec  INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT lesson_progress_unique UNIQUE (user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_progress_user   ON lesson_progress (user_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_lesson ON lesson_progress (lesson_id);

-- Module-level progress (aggregated; PRG-02)
CREATE TABLE IF NOT EXISTS module_progress (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  module_id         UUID        NOT NULL REFERENCES course_modules (id) ON DELETE CASCADE,
  completed_lessons INTEGER     NOT NULL DEFAULT 0,
  total_lessons     INTEGER     NOT NULL DEFAULT 0,
  status            VARCHAR(20) NOT NULL DEFAULT 'not_started'
                     CHECK (status IN ('not_started','in_progress','completed')),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT module_progress_unique UNIQUE (user_id, module_id)
);

-- Course-level progress (PRG-03; completion_pct drives dashboard widget PRG-05)
CREATE TABLE IF NOT EXISTS course_progress (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course_id       UUID         NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  completion_pct  NUMERIC(5,2) NOT NULL DEFAULT 0.00,          -- 0.00–100.00
  current_grade   NUMERIC(5,2),                                -- running weighted average
  status          VARCHAR(20)  NOT NULL DEFAULT 'in_progress'
                   CHECK (status IN ('not_started','in_progress','completed')),
  completed_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT course_progress_unique UNIQUE (user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_course_progress_user   ON course_progress (user_id);
CREATE INDEX IF NOT EXISTS idx_course_progress_course ON course_progress (course_id);
