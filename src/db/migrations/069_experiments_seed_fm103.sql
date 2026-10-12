-- =============================================================================
-- Migration 065 — Seed FM103 assessment definition + registered release (1.0.0)
--
-- required_items / grading_rules are transcribed directly from
-- FM103-STEPS-AND-QUESTIONS.md (verified 2026-09-08, schemaVersion 2.1). This
-- is exactly the "register the question answer keys and your agreed grading
-- rules for that assessment" step from WEB-DEVELOPER-GUIDE.md §2 — grade
-- weights/pass thresholds are deliberately absent (guide §7 defers those to a
-- later, explicitly-agreed grading policy).
--
-- legacy_step_map is the full 60-row stepId→stepNumber table from the same
-- catalog file, used only by the schema-1.0 compatibility normalizer
-- (event-normalizer.service.js) for events from the currently shipped
-- Bernoulli build, which has not yet been rebuilt against schema 2.1.
--
-- catalogStepCount (per experiment) exists because the real captured event
-- log shows the shipped build still emits StepStarted/StepCompleted for
-- Navigation-flagged steps (e.g. EXP01_STEP_11..14 — "Open Experiments",
-- "Click On Start") even though the catalog marks them tracked:false. The
-- 2.1 contract expects navigation steps not to emit at all; this build
-- hasn't caught up. event-validation.service.js accepts any stepNumber up
-- to catalogStepCount rather than rejecting non-required ones outright — a
-- real, benign event should never be rejected — while progress.service.js's
-- computeStepProgress still only ever counts requiredSteps, so these extra
-- events have zero effect on required-step progress.
--
-- build_url is intentionally left NULL: binding an actual approved build URL
-- to this release is a deliberate admin action (guide §2 step 4 — "Do not
-- accept arbitrary runtime catalogs as authoritative"), not something a
-- migration should assert on its own. An admin registration UI to set/update
-- this is later-phase work per the approved plan.
-- =============================================================================

INSERT INTO lms_assessment_definitions (project_id, assessment_version, required_items, grading_rules, legacy_step_map)
VALUES (
  'FM103',
  '1.0.0',
  '{
    "EXP01": {
      "requiredSteps": [1,2,3,4,5,6,7,8,9,10],
      "trackedSteps":  [1,2,3,4,5,6,7,8,9,10],
      "catalogStepCount": 14,
      "requiredQuestions": ["EXP01_Q01"],
      "allQuestions":      ["EXP01_Q01"]
    },
    "EXP02": {
      "requiredSteps": [1,2,3,4,11],
      "trackedSteps":  [1,2,3,4,5,6,7,8,9,10,11],
      "catalogStepCount": 15,
      "requiredQuestions": ["EXP02_Q02","EXP02_Q03"],
      "allQuestions":      ["EXP02_Q01","EXP02_Q02","EXP02_Q03"]
    },
    "EXP03": {
      "requiredSteps": [1,2,3,4,11,12],
      "trackedSteps":  [1,2,3,4,5,6,7,8,9,10,11,12],
      "catalogStepCount": 16,
      "requiredQuestions": ["EXP03_Q02","EXP03_Q03"],
      "allQuestions":      ["EXP03_Q01","EXP03_Q02","EXP03_Q03"]
    },
    "EXP04": {
      "requiredSteps": [1,2,3,11],
      "trackedSteps":  [1,2,3,4,5,6,7,8,9,10,11],
      "catalogStepCount": 15,
      "requiredQuestions": ["EXP04_Q02","EXP04_Q03"],
      "allQuestions":      ["EXP04_Q01","EXP04_Q02","EXP04_Q03"]
    }
  }'::jsonb,
  '{
    "answerKeys": {
      "EXP01_Q01": "1",
      "EXP02_Q01": "1", "EXP02_Q02": "false", "EXP02_Q03": "false",
      "EXP03_Q01": "1", "EXP03_Q02": "false", "EXP03_Q03": "1",
      "EXP04_Q01": "1", "EXP04_Q02": "0",     "EXP04_Q03": "true"
    },
    "questionTypes": {
      "EXP01_Q01": "MultipleChoice",
      "EXP02_Q01": "MultipleChoice", "EXP02_Q02": "TrueFalse",     "EXP02_Q03": "TrueFalse",
      "EXP03_Q01": "MultipleChoice", "EXP03_Q02": "TrueFalse",     "EXP03_Q03": "MultipleChoice",
      "EXP04_Q01": "MultipleChoice", "EXP04_Q02": "MultipleChoice","EXP04_Q03": "TrueFalse"
    }
  }'::jsonb,
  '{
    "EXP01_STEP_01":1,"EXP01_STEP_02":2,"EXP01_STEP_03":3,"EXP01_STEP_04":4,"EXP01_STEP_05":5,
    "EXP01_STEP_06":6,"EXP01_STEP_07":7,"EXP01_STEP_08":8,"EXP01_STEP_09":9,"EXP01_STEP_10":10,
    "EXP01_STEP_11":11,"EXP01_STEP_12":12,"EXP01_STEP_13":13,"EXP01_STEP_14":14,

    "EXP02_STEP_01":1,"EXP02_STEP_02":2,"EXP02_STEP_03":3,"EXP02_STEP_04":4,"EXP02_STEP_05":5,
    "EXP02_STEP_06":6,"EXP02_STEP_07":7,"EXP02_STEP_08":8,"EXP02_STEP_09":9,"EXP02_STEP_10":10,
    "EXP02_STEP_11":11,"EXP02_STEP_12":12,"EXP02_STEP_13":13,"EXP02_STEP_14":14,"EXP02_STEP_15":15,

    "EXP03_STEP_01":1,"EXP03_STEP_02":2,"EXP03_STEP_03":3,"EXP03_STEP_04":4,"EXP03_STEP_05":5,
    "EXP03_STEP_06":6,"EXP03_STEP_07":7,"EXP03_STEP_08":8,"EXP03_STEP_09":9,"EXP03_STEP_10":10,
    "EXP03_STEP_11":11,"EXP03_STEP_12":12,"EXP03_STEP_13":13,"EXP03_STEP_14":14,"EXP03_STEP_15":15,"EXP03_STEP_16":16,

    "EXP04_STEP_01":1,"EXP04_STEP_02":2,"EXP04_STEP_03":3,"EXP04_STEP_04":4,"EXP04_STEP_05":5,
    "EXP04_STEP_06":6,"EXP04_STEP_07":7,"EXP04_STEP_08":8,"EXP04_STEP_09":9,"EXP04_STEP_10":10,
    "EXP04_STEP_11":11,"EXP04_STEP_12":12,"EXP04_STEP_13":13,"EXP04_STEP_14":14,"EXP04_STEP_15":15
  }'::jsonb
)
ON CONFLICT (project_id, assessment_version) DO NOTHING;

INSERT INTO lms_registered_releases (project_id, project_version, assessment_version, manifest, build_url)
VALUES ('FM103', '1.0.0', '1.0.0', NULL, NULL)
ON CONFLICT (project_id, project_version) DO NOTHING;
