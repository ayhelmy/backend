'use strict';

/**
 * Mirrors the seed data in src/db/migrations/069_experiments_seed_fm103.sql
 * (project_id='FM103', assessment_version='1.0.0') for use in pure unit
 * tests that don't hit a real database. Keep in sync with that migration.
 */

const requiredItems = {
  EXP01: {
    requiredSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    trackedSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    catalogStepCount: 14,
    requiredQuestions: ['EXP01_Q01'],
    allQuestions: ['EXP01_Q01'],
  },
  EXP02: {
    requiredSteps: [1, 2, 3, 4, 11],
    trackedSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    catalogStepCount: 15,
    requiredQuestions: ['EXP02_Q02', 'EXP02_Q03'],
    allQuestions: ['EXP02_Q01', 'EXP02_Q02', 'EXP02_Q03'],
  },
  EXP03: {
    requiredSteps: [1, 2, 3, 4, 11, 12],
    trackedSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    catalogStepCount: 16,
    requiredQuestions: ['EXP03_Q02', 'EXP03_Q03'],
    allQuestions: ['EXP03_Q01', 'EXP03_Q02', 'EXP03_Q03'],
  },
  EXP04: {
    requiredSteps: [1, 2, 3, 11],
    trackedSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    catalogStepCount: 15,
    requiredQuestions: ['EXP04_Q02', 'EXP04_Q03'],
    allQuestions: ['EXP04_Q01', 'EXP04_Q02', 'EXP04_Q03'],
  },
};

const gradingRules = {
  answerKeys: {
    EXP01_Q01: '1',
    EXP02_Q01: '1', EXP02_Q02: 'false', EXP02_Q03: 'false',
    EXP03_Q01: '1', EXP03_Q02: 'false', EXP03_Q03: '1',
    EXP04_Q01: '1', EXP04_Q02: '0', EXP04_Q03: 'true',
  },
  questionTypes: {
    EXP01_Q01: 'MultipleChoice',
    EXP02_Q01: 'MultipleChoice', EXP02_Q02: 'TrueFalse', EXP02_Q03: 'TrueFalse',
    EXP03_Q01: 'MultipleChoice', EXP03_Q02: 'TrueFalse', EXP03_Q03: 'MultipleChoice',
    EXP04_Q01: 'MultipleChoice', EXP04_Q02: 'MultipleChoice', EXP04_Q03: 'TrueFalse',
  },
};

function buildLegacyStepMap() {
  const counts = { EXP01: 14, EXP02: 15, EXP03: 16, EXP04: 15 };
  const map = {};
  for (const [exp, count] of Object.entries(counts)) {
    for (let i = 1; i <= count; i++) {
      map[`${exp}_STEP_${String(i).padStart(2, '0')}`] = i;
    }
  }
  return map;
}

const fm103AssessmentDefinition = {
  project_id: 'FM103',
  assessment_version: '1.0.0',
  required_items: requiredItems,
  grading_rules: gradingRules,
  legacy_step_map: buildLegacyStepMap(),
};

module.exports = { fm103AssessmentDefinition };
