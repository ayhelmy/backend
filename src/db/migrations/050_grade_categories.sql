-- =============================================================================
-- Migration 048 — Grade Categories (weighted gradebook grouping)
--
-- New table, not courses.settings JSONB. Weight-sum-to-100% validation is
-- enforced in the service layer (grade-categories.service.js), NOT via CHECK
-- constraint -- Postgres cannot validate a cross-row SUM(weight) = 100
-- constraint declaratively without a trigger, and a trigger would fire
-- mid-transaction while categories are being edited one at a time.
--
-- item_type_filter is optional UI metadata/default-suggestion only -- the
-- authoritative membership of a grade item in a category is
-- grade_items.category_id, settable independent of item_type.
--
-- No backfill/default categories are created by this migration -- courses
-- without categories keep working exactly as before; default category setup
-- happens lazily in the service the first time an instructor opens the
-- categories UI (Phase 4), never forced by a migration.
-- =============================================================================

CREATE TABLE IF NOT EXISTS grade_categories (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id        UUID         NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  weight           NUMERIC(5,4) NOT NULL DEFAULT 0.0000,
  item_type_filter VARCHAR(30)
                   CHECK (item_type_filter IN ('simulation','assignment','quiz','participation')),
  position         INTEGER      NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT grade_categories_course_name_unique UNIQUE (course_id, name)
);

CREATE INDEX IF NOT EXISTS idx_grade_categories_course ON grade_categories(course_id);

-- Extend grade_items: category_id + quiz_id (parallel to existing simulation_id)

ALTER TABLE grade_items
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES grade_categories(id) ON DELETE SET NULL;

ALTER TABLE grade_items
  ADD COLUMN IF NOT EXISTS quiz_id UUID REFERENCES quizzes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_grade_items_category ON grade_items(category_id) WHERE category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grade_items_quiz      ON grade_items(quiz_id)     WHERE quiz_id IS NOT NULL;
