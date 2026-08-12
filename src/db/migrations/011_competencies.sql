-- =============================================================================
-- Migration 011 — Competency Framework
-- SRS §4.10 COMP-01 – COMP-05; §13.4 Competency Proficiency Tracking
-- Proficiency levels (SRS §13.4): not_yet (<40%), developing (40–69%),
--   proficient (70–89%), mastered (≥90%)
-- =============================================================================

-- Competency definitions — hierarchical (COMP-02)
-- institution_id NULL = global competency shared across all institutions
CREATE TABLE IF NOT EXISTS competencies (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID         REFERENCES institutions (id) ON DELETE CASCADE,
  code           VARCHAR(50)  NOT NULL,
  title          VARCHAR(255) NOT NULL,
  description    TEXT,
  parent_id      UUID         REFERENCES competencies (id) ON DELETE SET NULL, -- hierarchical (COMP-02)
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT competency_code_unique UNIQUE (institution_id, code)
);

CREATE INDEX IF NOT EXISTS idx_competencies_institution ON competencies (institution_id);

-- Simulations develop specific competencies (COMP-03)
-- level: introduces | develops | masters (depth of competency coverage in the simulation)
CREATE TABLE IF NOT EXISTS simulation_competencies (
  simulation_id UUID        NOT NULL REFERENCES simulations (id) ON DELETE CASCADE,
  competency_id UUID        NOT NULL REFERENCES competencies (id) ON DELETE CASCADE,
  level         VARCHAR(20) NOT NULL DEFAULT 'develops'
                 CHECK (level IN ('introduces','develops','masters')),
  PRIMARY KEY (simulation_id, competency_id)
);

-- Per-student competency achievement (COMP-04; proficiency computed from simulation_sessions)
-- Proficiency thresholds per SRS §13.4:
--   not_yet    : score < 40%
--   developing : 40% ≤ score < 70%
--   proficient : 70% ≤ score < 90%
--   mastered   : score ≥ 90%
CREATE TABLE IF NOT EXISTS student_competencies (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  competency_id   UUID        NOT NULL REFERENCES competencies (id) ON DELETE CASCADE,
  proficiency     VARCHAR(20) NOT NULL DEFAULT 'not_yet'
                   CHECK (proficiency IN ('not_yet','developing','proficient','mastered')),
  score_pct       NUMERIC(5,2),                               -- latest score percentage driving proficiency
  evidence_type   VARCHAR(30),                                -- simulation_session | grade | manual
  evidence_id     UUID,
  achieved_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT student_competency_unique UNIQUE (user_id, competency_id)
);

CREATE INDEX IF NOT EXISTS idx_student_competencies_user      ON student_competencies (user_id);
CREATE INDEX IF NOT EXISTS idx_student_competencies_competency ON student_competencies (competency_id);
