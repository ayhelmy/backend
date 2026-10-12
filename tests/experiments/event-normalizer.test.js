'use strict';

const fs = require('fs');
const path = require('path');
const { normalize, DEFAULT_LEGACY_VERSION } = require('../../src/modules/experiments/event-normalizer.service');
const { fm103AssessmentDefinition } = require('./fixtures/fm103-assessment-definition');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'fm103-events-2026-09-08.jsonl');

function loadFixtureEvents() {
  return fs.readFileSync(FIXTURE_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('event-normalizer.service — schema 1.0 legacy compatibility', () => {
  const legacyStepMap = fm103AssessmentDefinition.legacy_step_map;

  test('maps a schema 1.0 StepStarted stepId to the correct numeric stepNumber', () => {
    const raw = {
      schemaVersion: '1.0', eventType: 'StepStarted', stepId: 'EXP01_STEP_01',
      projectId: 'FM103', experimentId: 'EXP01',
    };
    const normalized = normalize(raw, { legacyStepMap });
    expect(normalized.stepNumber).toBe(1);
    expect(normalized._legacyStepUnmapped).toBe(false);
  });

  test('defaults projectVersion/assessmentVersion to 1.0.0 when absent (schema 1.0 never carries them)', () => {
    const raw = { schemaVersion: '1.0', eventType: 'SessionStarted', projectId: 'FM103' };
    const normalized = normalize(raw, { legacyStepMap });
    expect(normalized.projectVersion).toBe(DEFAULT_LEGACY_VERSION);
    expect(normalized.assessmentVersion).toBe(DEFAULT_LEGACY_VERSION);
  });

  test('flags an unmapped legacy stepId rather than silently defaulting to step 0', () => {
    const raw = { schemaVersion: '1.0', eventType: 'StepStarted', stepId: 'EXP99_STEP_01', projectId: 'FM103' };
    const normalized = normalize(raw, { legacyStepMap });
    expect(normalized.stepNumber).toBe(0);
    expect(normalized._legacyStepUnmapped).toBe(true);
  });

  test('schema 2.1 events pass through, coercing stepNumber to a number', () => {
    const raw = {
      schemaVersion: '2.1', eventType: 'StepStarted', stepNumber: '3',
      projectId: 'FM103', projectVersion: '1.0.10', assessmentVersion: '1.0.0',
    };
    const normalized = normalize(raw, { legacyStepMap });
    expect(normalized.stepNumber).toBe(3);
    expect(normalized.projectVersion).toBe('1.0.10'); // never overwritten by the legacy default
  });

  test('unsupported schemaVersion returns null so the caller rejects it', () => {
    expect(normalize({ schemaVersion: '3.0' }, { legacyStepMap })).toBeNull();
    expect(normalize({ schemaVersion: '2.0' }, { legacyStepMap })).toBeNull();
  });

  describe('against the real captured event log (48 events, live Build 005 sessions)', () => {
    const events = loadFixtureEvents();

    test('fixture actually contains 48 schema 1.0 events', () => {
      expect(events).toHaveLength(48);
      expect(events.every((e) => e.schemaVersion === '1.0')).toBe(true);
    });

    test('every event normalizes without throwing and gets a numeric stepNumber', () => {
      for (const raw of events) {
        const normalized = normalize(raw, { legacyStepMap });
        expect(normalized).not.toBeNull();
        expect(Number.isInteger(normalized.stepNumber)).toBe(true);
        expect(normalized.projectVersion).toBe(DEFAULT_LEGACY_VERSION);
        expect(normalized.assessmentVersion).toBe(DEFAULT_LEGACY_VERSION);
      }
    });

    test('the wrong-then-correct EXP01_Q01 retry sequence normalizes with matching attempt numbers', () => {
      const answered1 = events.find((e) => e.eventId === '7b107f19-f122-4ff1-8c9e-796b594bcf9f');
      const incorrect1 = events.find((e) => e.eventId === 'ab549add-8d17-43ab-849d-3e0b3ed65372');
      const answered2 = events.find((e) => e.eventId === 'e98e62e0-dcef-4609-b1ce-5e62f76da425');
      const correct2 = events.find((e) => e.eventId === '509154cd-f58c-4f75-8074-7f08987451f2');

      expect(normalize(answered1, { legacyStepMap }).attempt).toBe(1);
      expect(normalize(incorrect1, { legacyStepMap }).attempt).toBe(1);
      expect(normalize(answered2, { legacyStepMap }).attempt).toBe(2);
      expect(normalize(correct2, { legacyStepMap }).attempt).toBe(2);
      expect(normalize(correct2, { legacyStepMap }).answer).toBe('1');
    });

    test('navigation-flagged EXP01 steps 11-14 still map to real stepNumbers (build has not adopted the tracked/navigation split yet)', () => {
      const step11 = events.find((e) => e.stepId === 'EXP01_STEP_11');
      const step14 = events.find((e) => e.stepId === 'EXP01_STEP_14');
      expect(normalize(step11, { legacyStepMap }).stepNumber).toBe(11);
      expect(normalize(step14, { legacyStepMap }).stepNumber).toBe(14);
    });
  });
});
