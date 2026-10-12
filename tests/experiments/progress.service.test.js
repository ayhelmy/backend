'use strict';

const { computeStepProgress, computeQuestionResults, buildStepRows } = require('../../src/modules/experiments/progress.service');

describe('progress.service — computeStepProgress (guide §7 formula)', () => {
  test('EXP02 example from the guide: 3 of 5 required steps completed = 60%', () => {
    const requiredSteps = [1, 2, 3, 4, 11];
    const stepStates = [
      { step_number: 1, status: 'completed' },
      { step_number: 2, status: 'completed' },
      { step_number: 3, status: 'completed' },
      { step_number: 12, status: 'completed' }, // non-required — must not count
    ];
    const result = computeStepProgress(stepStates, requiredSteps);
    expect(result).toEqual({ numerator: 3, denominator: 5, percentage: 60 });
  });

  test('a zero denominator yields a null percentage, never division by zero', () => {
    const result = computeStepProgress([{ step_number: 1, status: 'completed' }], []);
    expect(result).toEqual({ numerator: 0, denominator: 0, percentage: null });
  });

  test('a retried step (status back to "retried") does not count as completed', () => {
    const requiredSteps = [1, 2];
    const stepStates = [
      { step_number: 1, status: 'retried' }, // was completed, then retried — contribution removed
      { step_number: 2, status: 'completed' },
    ];
    const result = computeStepProgress(stepStates, requiredSteps);
    expect(result).toEqual({ numerator: 1, denominator: 2, percentage: 50 });
  });

  test('all four experiment denominators from the guide/catalog', () => {
    expect(computeStepProgress([], [1,2,3,4,5,6,7,8,9,10]).denominator).toBe(10); // EXP01
    expect(computeStepProgress([], [1,2,3,4,11]).denominator).toBe(5);            // EXP02
    expect(computeStepProgress([], [1,2,3,4,11,12]).denominator).toBe(6);         // EXP03
    expect(computeStepProgress([], [1,2,3,11]).denominator).toBe(4);              // EXP04
  });
});

describe('progress.service — computeQuestionResults', () => {
  test('keeps only the latest attempt per question and flags required vs not', () => {
    const submissions = [
      { question_id: 'EXP01_Q01', attempt: 1, answer: '0', result: 'incorrect' },
      { question_id: 'EXP01_Q01', attempt: 2, answer: '1', result: 'correct' },
      { question_id: 'EXP01_Q02', attempt: 1, answer: 'true', result: 'pending' },
    ];
    const results = computeQuestionResults(submissions, ['EXP01_Q01']);
    const q01 = results.find((r) => r.questionId === 'EXP01_Q01');
    const q02 = results.find((r) => r.questionId === 'EXP01_Q02');

    expect(q01).toEqual({ questionId: 'EXP01_Q01', required: true, latestAttempt: 2, answer: '1', result: 'correct' });
    expect(q02.required).toBe(false);
  });
});

describe('progress.service — buildStepRows (instructor dashboard step-strip)', () => {
  test('unions required steps with whatever was actually reported, tagging each with status and duration', () => {
    const stepStates = [
      { step_number: 1, status: 'completed', started_received_at: '2026-01-01T00:00:00Z', completed_received_at: '2026-01-01T00:00:05Z' },
      { step_number: 2, status: 'started', started_received_at: '2026-01-01T00:00:10Z', completed_received_at: null },
      // Off-catalog step (e.g. a Navigation-flagged step the build still emits) — never silently dropped.
      { step_number: 11, status: 'completed', started_received_at: '2026-01-01T00:01:00Z', completed_received_at: '2026-01-01T00:01:02Z' },
    ];
    const rows = buildStepRows(stepStates, [1, 2, 3]);

    expect(rows.map((r) => r.stepNumber)).toEqual([1, 2, 3, 11]);
    expect(rows[0]).toEqual({ stepNumber: 1, required: true, status: 'completed', durationSeconds: 5 });
    expect(rows[1]).toEqual({ stepNumber: 2, required: true, status: 'started', durationSeconds: null });
    expect(rows[2]).toEqual({ stepNumber: 3, required: true, status: 'pending', durationSeconds: null });
    expect(rows[3]).toEqual({ stepNumber: 11, required: false, status: 'completed', durationSeconds: 2 });
  });

  test('never reports a negative duration (clock skew / out-of-order receipt)', () => {
    const stepStates = [
      { step_number: 1, status: 'completed', started_received_at: '2026-01-01T00:00:05Z', completed_received_at: '2026-01-01T00:00:00Z' },
    ];
    expect(buildStepRows(stepStates, [1])[0].durationSeconds).toBeNull();
  });
});
