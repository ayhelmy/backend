-- =============================================================================
-- Migration 005 — Course Modules and Lessons
-- SRS §4.6 MOD-01 – MOD-08
-- SRS §9: modules.prerequisite_module_id (self-ref), lessons.type + content JSONB
-- =============================================================================

CREATE TABLE IF NOT EXISTS course_modules (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id              UUID         NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  title                  VARCHAR(255) NOT NULL,
  description            TEXT,
  position               INTEGER      NOT NULL DEFAULT 0,      -- sort order within course
  is_published           BOOLEAN      NOT NULL DEFAULT FALSE,
  unlock_at              TIMESTAMPTZ,                          -- timed release (MOD-07)
  prerequisite_module_id UUID         REFERENCES course_modules (id) ON DELETE SET NULL, -- gate unlock on prior completion (MOD-06)
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_modules_course ON course_modules (course_id);

-- Lessons — content units within a module (MOD-03 to MOD-05)
-- content JSONB payload varies by type:
--   text       → { "body": "<html>" }
--   video      → { "url": "https://...", "duration_sec": 1200 }
--   file       → { "url": "https://...", "mime_type": "application/pdf" }
--   url        → { "url": "https://..." }
--   simulation → { "simulation_id": "<uuid>" }   (FK enforced at application layer)
CREATE TABLE IF NOT EXISTS lessons (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id         UUID         NOT NULL REFERENCES course_modules (id) ON DELETE CASCADE,
  title             VARCHAR(255) NOT NULL,
  type              VARCHAR(20)  NOT NULL DEFAULT 'text'       -- text | video | file | url | simulation
                     CHECK (type IN ('text','video','file','url','simulation')),
  content           JSONB        NOT NULL DEFAULT '{}',         -- type-specific payload (SRS §9)
  simulation_id     UUID,                                       -- denormalised from content for indexed lookups; FK added in 006
  position          INTEGER      NOT NULL DEFAULT 0,
  estimated_minutes INTEGER,                                    -- reading/viewing time (MOD-04)
  is_required       BOOLEAN      NOT NULL DEFAULT TRUE,         -- affects course completion calc (PRG-01)
  is_published      BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lessons_module     ON lessons (module_id);
CREATE INDEX IF NOT EXISTS idx_lessons_simulation ON lessons (simulation_id) WHERE simulation_id IS NOT NULL;
