-- =============================================================================
-- Migration 064 — FM103 LMS event-contract tracking (experiments module)
--
-- Implements the structured session/experiment/step/question event contract
-- from WEB-DEVELOPER-GUIDE.md (schemaVersion 2.1), plus a schema-1.0 legacy
-- compatibility path (see lms_assessment_definitions.legacy_step_map and
-- experiments/event-normalizer.service.js) since the currently shipped FM103
-- Bernoulli build still emits the older, pre-2.1 event shape.
--
-- Purely additive: does not touch simulation_activity_sessions,
-- simulation_click_events, simulation_click_regions or simulation_steps
-- (036-043), which remain the authoritative source for raw click/keydown
-- interaction heatmaps on any WebGL simulation. This module becomes the
-- authoritative source for step/question progress and completion only for
-- simulations that adopt the FM103 event contract.
--
-- session_id / experiment_attempt_id / event_id are Unity-supplied UUIDs
-- (never server-minted here) — they arrive as-is in the payload and are used
-- directly as primary keys, which is what makes event_id-based idempotency
-- (guide §6 step 4 / §10 checklist) possible.
-- =============================================================================

-- ── Registered release: approved (projectId, projectVersion) → manifest/build ──
CREATE TABLE IF NOT EXISTS lms_registered_releases (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          VARCHAR(50)  NOT NULL,
  project_version     VARCHAR(50)  NOT NULL,
  assessment_version  VARCHAR(50)  NOT NULL,
  manifest            JSONB,
  build_url           TEXT,
  approved_by         UUID         REFERENCES users(id),
  approved_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT lms_registered_releases_unique UNIQUE (project_id, project_version)
);

-- ── Assessment definition: immutable (projectId, assessmentVersion) → rules ────
CREATE TABLE IF NOT EXISTS lms_assessment_definitions (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          VARCHAR(50)  NOT NULL,
  assessment_version  VARCHAR(50)  NOT NULL,

  -- { "<experimentId>": { requiredSteps: [int], trackedSteps: [int],
  --                        requiredQuestions: [string], allQuestions: [string] } }
  required_items      JSONB        NOT NULL,

  -- { answerKeys: { <questionId>: <answer string> },
  --   questionTypes: { <questionId>: 'MultipleChoice'|'TrueFalse' } }
  -- Grade weights / pass thresholds intentionally NOT included yet — guide §7
  -- explicitly defers grading policy until agreed; only answer-key validation
  -- and per-question correctness live here for Phase 1.
  grading_rules       JSONB        NOT NULL DEFAULT '{}'::jsonb,

  -- Schema-1.0 legacy compatibility only: { "<internal stepId>": <stepNumber> }.
  -- Consulted solely by the event-normalizer when schemaVersion = "1.0".
  legacy_step_map     JSONB        NOT NULL DEFAULT '{}'::jsonb,

  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT lms_assessment_definitions_unique UNIQUE (project_id, assessment_version)
);

ALTER TABLE lms_registered_releases
  ADD CONSTRAINT lms_registered_releases_assessment_fk
  FOREIGN KEY (project_id, assessment_version)
  REFERENCES lms_assessment_definitions (project_id, assessment_version);

-- ── Learner session: one Unity reporter session ─────────────────────────────────
CREATE TABLE IF NOT EXISTS lms_learner_sessions (
  session_id          UUID         PRIMARY KEY,
  learner_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institution_id      UUID         REFERENCES institutions(id) ON DELETE SET NULL,
  project_id          VARCHAR(50)  NOT NULL,
  project_version     VARCHAR(50)  NOT NULL,
  assessment_version  VARCHAR(50)  NOT NULL,
  status              VARCHAR(20)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  started_at          TIMESTAMPTZ  NOT NULL,
  ended_at            TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lms_learner_sessions_learner ON lms_learner_sessions(learner_id);

-- ── Experiment attempt: one experiment run ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS lms_experiment_attempts (
  experiment_attempt_id  UUID         PRIMARY KEY,
  session_id              UUID         NOT NULL REFERENCES lms_learner_sessions(session_id) ON DELETE CASCADE,
  learner_id              UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id              VARCHAR(50)  NOT NULL,
  project_version         VARCHAR(50)  NOT NULL,
  assessment_version      VARCHAR(50)  NOT NULL,
  experiment_id           VARCHAR(20)  NOT NULL,
  status                  VARCHAR(20)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'aborted')),
  started_at              TIMESTAMPTZ  NOT NULL,
  ended_at                TIMESTAMPTZ,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lms_attempts_learner
  ON lms_experiment_attempts(learner_id, project_id, assessment_version, experiment_id);
CREATE INDEX IF NOT EXISTS idx_lms_attempts_session ON lms_experiment_attempts(session_id);

-- ── Raw event log: immutable append-only audit trail ────────────────────────────
CREATE TABLE IF NOT EXISTS lms_raw_events (
  event_id                UUID         PRIMARY KEY,
  session_id              UUID         NOT NULL,
  experiment_attempt_id   UUID,
  learner_id              UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type              VARCHAR(30)  NOT NULL,
  schema_version          VARCHAR(10)  NOT NULL,
  payload                 JSONB        NOT NULL,
  received_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lms_raw_events_session ON lms_raw_events(session_id);
CREATE INDEX IF NOT EXISTS idx_lms_raw_events_attempt
  ON lms_raw_events(experiment_attempt_id) WHERE experiment_attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lms_raw_events_learner ON lms_raw_events(learner_id);

-- ── Step state: started/completed/failed/retried per step per attempt ──────────
CREATE TABLE IF NOT EXISTS lms_step_states (
  experiment_attempt_id  UUID         NOT NULL REFERENCES lms_experiment_attempts(experiment_attempt_id) ON DELETE CASCADE,
  step_number             INTEGER      NOT NULL,
  status                  VARCHAR(20)  NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'retried')),
  started_event_id        UUID,
  completed_event_id      UUID,
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  PRIMARY KEY (experiment_attempt_id, step_number)
);

-- ── Answer submissions: one row per (attempt, question, attempt#) ──────────────
CREATE TABLE IF NOT EXISTS lms_answer_submissions (
  experiment_attempt_id  UUID         NOT NULL REFERENCES lms_experiment_attempts(experiment_attempt_id) ON DELETE CASCADE,
  question_id             VARCHAR(30)  NOT NULL,
  attempt                 INTEGER      NOT NULL,
  question_type           VARCHAR(20),
  answer                  TEXT,
  result                  VARCHAR(20)  NOT NULL DEFAULT 'pending' CHECK (result IN ('pending', 'correct', 'incorrect')),
  answered_event_id       UUID,
  result_event_id         UUID,
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  PRIMARY KEY (experiment_attempt_id, question_id, attempt)
);

-- ── Saved results: version-preserved completion per learner/assessment/experiment
CREATE TABLE IF NOT EXISTS lms_saved_results (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id              UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id              VARCHAR(50)  NOT NULL,
  assessment_version      VARCHAR(50)  NOT NULL,
  experiment_id           VARCHAR(20)  NOT NULL,
  source_attempt_id       UUID         NOT NULL REFERENCES lms_experiment_attempts(experiment_attempt_id),
  source_project_version  VARCHAR(50)  NOT NULL,
  step_numerator          INTEGER      NOT NULL DEFAULT 0,
  step_denominator        INTEGER,
  -- Grade intentionally nullable/unset until a grading policy is agreed and
  -- versioned (guide §7). Populating this is later-phase work.
  grade                   NUMERIC(5,2),
  completion_status       VARCHAR(20)  NOT NULL DEFAULT 'incomplete' CHECK (completion_status IN ('incomplete', 'completed')),
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT lms_saved_results_unique UNIQUE (learner_id, project_id, assessment_version, experiment_id)
);
