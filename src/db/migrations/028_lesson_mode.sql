-- =============================================================================
-- Migration 028 — Lesson Mode & Course Tree Support
-- Adds lesson_mode, content_type, catalog_id, and denormalized course/institution/
-- department columns to lessons table. Backfills existing rows from old type column.
-- Creates lesson_completions table for completion tracking (SRS §4.8 PRG-01).
-- SRS §4.6 MOD-03 to MOD-05; §4.15 CMS-01 to CMS-04.
-- =============================================================================

-- ── Relax old type CHECK to include scorm (was missing) ──────────────────────
DO $$
BEGIN
  BEGIN
    ALTER TABLE lessons DROP CONSTRAINT lessons_type_check;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  ALTER TABLE lessons
    ADD CONSTRAINT lessons_type_check
      CHECK (type IN ('text','video','file','url','simulation','scorm'));
END $$;

-- ── New columns on lessons ────────────────────────────────────────────────────

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS lesson_mode VARCHAR(30)
    CHECK (lesson_mode IN ('content', 'simulation', 'content_and_simulation'));

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS content_type VARCHAR(20)
    CHECK (content_type IN ('rich_text', 'video', 'file', 'url', 'scorm'));

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS catalog_id UUID;

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS course_id UUID;

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS institution_id UUID;

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS department_id UUID;

-- ── Backfill lesson_mode / content_type from old type column ──────────────────

UPDATE lessons
SET
  lesson_mode  = CASE type
    WHEN 'simulation' THEN 'simulation'
    ELSE 'content'
  END,
  content_type = CASE type
    WHEN 'text'  THEN 'rich_text'
    WHEN 'video' THEN 'video'
    WHEN 'file'  THEN 'file'
    WHEN 'url'   THEN 'url'
    WHEN 'scorm' THEN 'scorm'
    ELSE NULL
  END
WHERE lesson_mode IS NULL;

-- ── Backfill denormalized course / institution / department ───────────────────

UPDATE lessons l
SET
  course_id      = c.id,
  institution_id = c.institution_id,
  department_id  = c.department_id
FROM course_modules cm
JOIN courses c ON c.id = cm.course_id
WHERE l.module_id = cm.id
  AND l.course_id IS NULL;

-- ── FK constraints on the new columns ────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_lessons_catalog' AND table_name = 'lessons'
  ) THEN
    ALTER TABLE lessons
      ADD CONSTRAINT fk_lessons_catalog
        FOREIGN KEY (catalog_id) REFERENCES simulation_catalogs(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_lessons_course' AND table_name = 'lessons'
  ) THEN
    ALTER TABLE lessons
      ADD CONSTRAINT fk_lessons_course
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_lessons_institution' AND table_name = 'lessons'
  ) THEN
    ALTER TABLE lessons
      ADD CONSTRAINT fk_lessons_institution
        FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_lessons_department' AND table_name = 'lessons'
  ) THEN
    ALTER TABLE lessons
      ADD CONSTRAINT fk_lessons_department
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Make lesson_mode NOT NULL after backfill ──────────────────────────────────

ALTER TABLE lessons
  ALTER COLUMN lesson_mode SET NOT NULL;

-- ── Lesson completions table ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lesson_completions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id    UUID        NOT NULL REFERENCES lessons(id)  ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  course_id    UUID        NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lesson_id, user_id)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_lessons_course_id   ON lessons(course_id);
CREATE INDEX IF NOT EXISTS idx_lessons_lesson_mode ON lessons(lesson_mode);
CREATE INDEX IF NOT EXISTS idx_lessons_catalog_id  ON lessons(catalog_id) WHERE catalog_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lesson_comp_user    ON lesson_completions(user_id, course_id);
CREATE INDEX IF NOT EXISTS idx_lesson_comp_lesson  ON lesson_completions(lesson_id);
