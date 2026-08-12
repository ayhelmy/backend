-- =============================================================================
-- Migration 006 — Simulations Catalog
-- SRS §4.7 SIM-01 – SIM-10; §13 Simulation Learning Features
-- SRS §9: type ENUM(scorm,lti,internal), launch_url, scoring_config JSONB,
--         learning_objectives TEXT[], difficulty, max_attempts, pass_score
-- =============================================================================

CREATE TABLE IF NOT EXISTS simulations (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id       UUID         REFERENCES institutions (id) ON DELETE CASCADE, -- NULL = global/shared catalog
  domain_id            UUID,                                    -- FK to domains (added in 012)
  title                VARCHAR(255) NOT NULL,
  description          TEXT,
  type                 VARCHAR(20)  NOT NULL DEFAULT 'scorm'    -- scorm | lti | internal
                        CHECK (type IN ('scorm','lti','internal')),
  launch_url           TEXT         NOT NULL,                   -- Entry point URI / S3 package URL (SIM-05)
  thumbnail_url        TEXT,
  estimated_minutes    INTEGER,
  difficulty           VARCHAR(20)  NOT NULL DEFAULT 'intermediate'
                        CHECK (difficulty IN ('beginner','intermediate','advanced')),
  max_score            NUMERIC(5,2) NOT NULL DEFAULT 100.00,
  pass_score           NUMERIC(5,2) NOT NULL DEFAULT 70.00,     -- minimum to "pass" attempt (SIM-03)
  max_attempts         INTEGER      NOT NULL DEFAULT 3,          -- 0 = unlimited (SIM-03)
  scoring_config       JSONB        NOT NULL DEFAULT '{}',       -- step weights, hint_penalty_per_hint (SRS §13.3)
  learning_objectives  TEXT[]       NOT NULL DEFAULT '{}',       -- array of objective strings (SIM-02)
  status               VARCHAR(20)  NOT NULL DEFAULT 'draft'     -- draft | active | deprecated
                        CHECK (status IN ('draft','active','deprecated')),
  version              VARCHAR(50)  NOT NULL DEFAULT '1.0.0',
  created_by           UUID         REFERENCES users (id),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ
);

-- Back-fill the FK from lessons.simulation_id (column declared in 005, table now exists)
ALTER TABLE lessons
  ADD CONSTRAINT fk_lessons_simulation
  FOREIGN KEY (simulation_id) REFERENCES simulations (id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS simulation_tags (
  simulation_id UUID        NOT NULL REFERENCES simulations (id) ON DELETE CASCADE,
  tag           VARCHAR(100) NOT NULL,
  PRIMARY KEY (simulation_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_simulations_institution ON simulations (institution_id)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_simulations_status      ON simulations (status)           WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_simulations_domain      ON simulations (domain_id)        WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_simulation_tags         ON simulation_tags (tag);
