-- =============================================================================
-- Migration 004 — Courses and Enrollments
-- SRS §4.5 CRS-01 – CRS-10
-- SRS §9: courses table with domain_id, enrollment_type, settings JSONB
-- =============================================================================

CREATE TABLE IF NOT EXISTS courses (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID         NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
  department_id   UUID         REFERENCES departments (id) ON DELETE SET NULL,
  term_id         UUID         REFERENCES academic_terms (id) ON DELETE SET NULL,
  domain_id       UUID,                                        -- FK to domains (added in 012 after table exists)
  instructor_id   UUID         NOT NULL REFERENCES users (id), -- primary instructor (CRS-01)
  code            VARCHAR(50),                                 -- e.g. "CS401" (unique per institution)
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  thumbnail_url   TEXT,                                        -- course cover image (CDN URL)
  status          VARCHAR(20)  NOT NULL DEFAULT 'draft'        -- draft | published | archived
                   CHECK (status IN ('draft','published','archived')),
  enrollment_type VARCHAR(20)  NOT NULL DEFAULT 'open'         -- open | approval | code | admin
                   CHECK (enrollment_type IN ('open','approval','code','admin')),
  enrollment_cap  INTEGER,                                     -- NULL = unlimited (CRS-04)
  start_date      DATE,
  end_date        DATE,
  passing_grade   NUMERIC(5,2) NOT NULL DEFAULT 60.00,         -- minimum grade for completion (CRS-08)
  settings        JSONB        NOT NULL DEFAULT '{}',           -- grade weights, late policy, etc.
  published_at    TIMESTAMPTZ,
  created_by      UUID         NOT NULL REFERENCES users (id), -- could differ from instructor_id
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,

  CONSTRAINT course_code_unique UNIQUE (institution_id, code)
);

CREATE INDEX IF NOT EXISTS idx_courses_institution ON courses (institution_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_courses_status      ON courses (status)         WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_courses_instructor  ON courses (instructor_id)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_courses_domain      ON courses (domain_id)      WHERE deleted_at IS NULL;

-- Enrollments (SRS §4.5 CRS-03; §9: final_grade populated on course completion)
CREATE TABLE IF NOT EXISTS enrollments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    UUID        NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role         VARCHAR(20) NOT NULL DEFAULT 'student'         -- student | instructor | ta
                CHECK (role IN ('student','instructor','ta')),
  status       VARCHAR(20) NOT NULL DEFAULT 'pending'         -- pending | active | dropped | completed
                CHECK (status IN ('pending','active','dropped','completed')),
  final_grade  NUMERIC(5,2),                                  -- calculated at completion (SRS §9)
  enrolled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  CONSTRAINT enrollments_user_course_unique UNIQUE (course_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_user   ON enrollments (user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments (course_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status ON enrollments (status);
