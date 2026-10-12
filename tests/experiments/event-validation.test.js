'use strict';

const { normalize } = require('../../src/modules/experiments/event-normalizer.service');
const { validate } = require('../../src/modules/experiments/event-validation.service');
const { fm103AssessmentDefinition } = require('./fixtures/fm103-assessment-definition');

const legacyStepMap = fm103AssessmentDefinition.legacy_step_map;
const UUID_A = '509154cd-f58c-4f75-8074-7f08987451f2';
const UUID_B = 'd508b28e-4c7d-43a1-880a-d32442447a4d';
const UUID_C = 'f5c4fce7-7356-4b83-81b5-d8ed15d83e12';

function n(raw) {
  return normalize(raw, { legacyStepMap: fm103AssessmentDefinition.legacy_step_map });
}

describe('event-validation.service', () => {
  test('accepts a well-formed schema 2.1 StepStarted event', () => {
    const evt = n({
      schemaVersion: '2.1', eventId: UUID_A, sessionId: UUID_B, experimentAttemptId: UUID_C,
      projectId: 'FM103', projectVersion: '1.0.0', assessmentVersion: '1.0.0',
      experimentId: 'EXP01', eventType: 'StepStarted', stepNumber: 1,
    });
    expect(() => validate(evt, fm103AssessmentDefinition)).not.toThrow();
  });

  test('rejects an unsupported schemaVersion', () => {
    expect(() => validate(n({ schemaVersion: '3.0' }), fm103AssessmentDefinition)).toThrow();
  });

  test('rejects a non-UUID eventId', () => {
    const evt = n({
      schemaVersion: '2.1', eventId: 'not-a-uuid', sessionId: UUID_B,
      projectId: 'FM103', assessmentVersion: '1.0.0', eventType: 'SessionStarted',
    });
    expect(() => validate(evt, fm103AssessmentDefinition)).toThrow(/eventId/);
  });

  test('rejects a mismatched assessmentVersion', () => {
    const evt = n({
      schemaVersion: '2.1', eventId: UUID_A, sessionId: UUID_B,
      projectId: 'FM103', assessmentVersion: '9.9.9', eventType: 'SessionStarted',
    });
    expect(() => validate(evt, fm103AssessmentDefinition)).toThrow(/assessmentVersion/);
  });

  test('accepts a Navigation-flagged stepNumber within the catalog (build still emits these)', () => {
    const evt = n({
      schemaVersion: '1.0', eventId: UUID_A, sessionId: UUID_B, experimentAttemptId: UUID_C,
      projectId: 'FM103', experimentId: 'EXP01', eventType: 'StepStarted', stepId: 'EXP01_STEP_11',
    });
    expect(() => validate(evt, fm103AssessmentDefinition)).not.toThrow();
  });

  test('rejects a stepNumber beyond the experiment catalog', () => {
    const evt = n({
      schemaVersion: '2.1', eventId: UUID_A, sessionId: UUID_B, experimentAttemptId: UUID_C,
      projectId: 'FM103', projectVersion: '1.0.0', assessmentVersion: '1.0.0',
      experimentId: 'EXP01', eventType: 'StepStarted', stepNumber: 99,
    });
    expect(() => validate(evt, fm103AssessmentDefinition)).toThrow(/outside the catalog/);
  });

  test('rejects an unregistered questionId', () => {
    const evt = n({
      schemaVersion: '2.1', eventId: UUID_A, sessionId: UUID_B, experimentAttemptId: UUID_C,
      projectId: 'FM103', projectVersion: '1.0.0', assessmentVersion: '1.0.0',
      experimentId: 'EXP01', eventType: 'QuestionShown', questionId: 'EXP01_Q99', questionType: 'MultipleChoice',
    });
    expect(() => validate(evt, fm103AssessmentDefinition)).toThrow(/not registered/);
  });

  test('accepts a valid TrueFalse answer ("false" is a legitimate answer, not falsy)', () => {
    const evt = n({
      schemaVersion: '2.1', eventId: UUID_A, sessionId: UUID_B, experimentAttemptId: UUID_C,
      projectId: 'FM103', projectVersion: '1.0.0', assessmentVersion: '1.0.0',
      experimentId: 'EXP02', eventType: 'QuestionAnswered', questionId: 'EXP02_Q02',
      questionType: 'TrueFalse', answer: 'false', attempt: 1,
    });
    expect(() => validate(evt, fm103AssessmentDefinition)).not.toThrow();
  });

  test('rejects an invalid TrueFalse answer string', () => {
    const evt = n({
      schemaVersion: '2.1', eventId: UUID_A, sessionId: UUID_B, experimentAttemptId: UUID_C,
      projectId: 'FM103', projectVersion: '1.0.0', assessmentVersion: '1.0.0',
      experimentId: 'EXP02', eventType: 'QuestionAnswered', questionId: 'EXP02_Q02',
      questionType: 'TrueFalse', answer: 'maybe', attempt: 1,
    });
    expect(() => validate(evt, fm103AssessmentDefinition)).toThrow(/Invalid TrueFalse answer/);
  });

  test('MC answer "1" (second choice, zero-based) is valid; a non-numeric answer is not', () => {
    const valid = n({
      schemaVersion: '2.1', eventId: UUID_A, sessionId: UUID_B, experimentAttemptId: UUID_C,
      projectId: 'FM103', projectVersion: '1.0.0', assessmentVersion: '1.0.0',
      experimentId: 'EXP01', eventType: 'QuestionCorrect', questionId: 'EXP01_Q01',
      questionType: 'MultipleChoice', answer: '1', attempt: 2,
    });
    expect(() => validate(valid, fm103AssessmentDefinition)).not.toThrow();

    const invalid = { ...valid, answer: 'B' };
    expect(() => validate(invalid, fm103AssessmentDefinition)).toThrow(/Invalid MultipleChoice answer/);
  });

  test('rejects a non-positive attempt number on an answer event', () => {
    const evt = n({
      schemaVersion: '2.1', eventId: UUID_A, sessionId: UUID_B, experimentAttemptId: UUID_C,
      projectId: 'FM103', projectVersion: '1.0.0', assessmentVersion: '1.0.0',
      experimentId: 'EXP01', eventType: 'QuestionAnswered', questionId: 'EXP01_Q01',
      questionType: 'MultipleChoice', answer: '1', attempt: 0,
    });
    expect(() => validate(evt, fm103AssessmentDefinition)).toThrow(/attempt must be/);
  });

  test('session-level events do not require experimentAttemptId', () => {
    const evt = n({
      schemaVersion: '2.1', eventId: UUID_A, sessionId: UUID_B,
      projectId: 'FM103', assessmentVersion: '1.0.0', eventType: 'SessionStarted',
    });
    expect(() => validate(evt, fm103AssessmentDefinition)).not.toThrow();
  });

  test('non-session events require a valid experimentAttemptId', () => {
    const evt = n({
      schemaVersion: '2.1', eventId: UUID_A, sessionId: UUID_B,
      projectId: 'FM103', projectVersion: '1.0.0', assessmentVersion: '1.0.0',
      experimentId: 'EXP01', eventType: 'ExperimentStarted',
    });
    expect(() => validate(evt, fm103AssessmentDefinition)).toThrow(/experimentAttemptId/);
  });
});
