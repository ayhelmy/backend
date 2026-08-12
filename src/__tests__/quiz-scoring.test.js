'use strict';

/**
 * Quiz scoring engine — pure-function unit tests (no DB dependency).
 * Run: npx jest src/__tests__/quiz-scoring.test.js
 */

const { scoreResponse } = require('../modules/quiz-attempts/quiz-scoring.util');

function q(overrides) {
  return { points: 1, manual_grading: false, question_data: {}, ...overrides };
}

describe('scoreResponse — choice types', () => {
  const options = [
    { id: 'o1', is_correct: false },
    { id: 'o2', is_correct: true },
  ];

  test('single_choice correct selection', () => {
    const r = scoreResponse(q({ question_type: 'single_choice', points: 2 }), options, { selectedOptionId: 'o2' });
    expect(r).toEqual({ isCorrect: true, autoScore: 2, requiresManualGrading: false });
  });

  test('single_choice wrong selection', () => {
    const r = scoreResponse(q({ question_type: 'single_choice', points: 2 }), options, { selectedOptionId: 'o1' });
    expect(r).toEqual({ isCorrect: false, autoScore: 0, requiresManualGrading: false });
  });

  test('true_false reuses single_choice logic', () => {
    const r = scoreResponse(q({ question_type: 'true_false', points: 1 }), options, { selectedOptionId: 'o2' });
    expect(r.isCorrect).toBe(true);
  });

  test('multiple_choice exact set match required', () => {
    const opts = [
      { id: 'a', is_correct: true }, { id: 'b', is_correct: false }, { id: 'c', is_correct: true },
    ];
    const question = q({ question_type: 'multiple_choice', points: 4 });
    expect(scoreResponse(question, opts, { selectedOptionIds: ['a', 'c'] }).isCorrect).toBe(true);
    expect(scoreResponse(question, opts, { selectedOptionIds: ['a'] }).isCorrect).toBe(false);
    expect(scoreResponse(question, opts, { selectedOptionIds: ['a', 'b', 'c'] }).isCorrect).toBe(false);
  });
});

describe('scoreResponse — short_text', () => {
  test('case-insensitive match by default', () => {
    const question = q({ question_type: 'short_text', points: 1, question_data: { acceptedAnswers: ['Paris'], caseSensitive: false } });
    expect(scoreResponse(question, [], { text: 'paris' }).isCorrect).toBe(true);
  });

  test('case-sensitive rejects mismatched case', () => {
    const question = q({ question_type: 'short_text', points: 1, question_data: { acceptedAnswers: ['Paris'], caseSensitive: true } });
    expect(scoreResponse(question, [], { text: 'paris' }).isCorrect).toBe(false);
  });
});

describe('scoreResponse — numeric / numeric_tolerance', () => {
  test('numeric requires exact match', () => {
    const question = q({ question_type: 'numeric', points: 1, question_data: { correctValue: 42 } });
    expect(scoreResponse(question, [], { value: 42 }).isCorrect).toBe(true);
    expect(scoreResponse(question, [], { value: 42.001 }).isCorrect).toBe(false);
  });

  test('numeric_tolerance absolute window', () => {
    const question = q({ question_type: 'numeric_tolerance', points: 3, question_data: { correctValue: 3.14, tolerance: 0.02, toleranceMode: 'absolute' } });
    expect(scoreResponse(question, [], { value: 3.145 }).isCorrect).toBe(true);
    expect(scoreResponse(question, [], { value: 3.2 }).isCorrect).toBe(false);
  });

  test('numeric_tolerance relative window', () => {
    const question = q({ question_type: 'numeric_tolerance', points: 3, question_data: { correctValue: 100, tolerance: 0.1, toleranceMode: 'relative' } });
    expect(scoreResponse(question, [], { value: 105 }).isCorrect).toBe(true); // within 10% of 100
    expect(scoreResponse(question, [], { value: 120 }).isCorrect).toBe(false);
  });
});

describe('scoreResponse — matching (partial credit)', () => {
  const question = q({
    question_type: 'matching', points: 4,
    question_data: { pairs: [{ source: { id: 's1' }, target: { id: 't1' } }, { source: { id: 's2' }, target: { id: 't2' } }] },
  });

  test('all pairs correct -> full points', () => {
    const r = scoreResponse(question, [], { matches: [{ sourceId: 's1', targetId: 't1' }, { sourceId: 's2', targetId: 't2' }] });
    expect(r).toEqual({ isCorrect: true, autoScore: 4, requiresManualGrading: false });
  });

  test('1 of 2 pairs correct -> half points, not marked fully correct', () => {
    const r = scoreResponse(question, [], { matches: [{ sourceId: 's1', targetId: 't1' }] });
    expect(r.isCorrect).toBe(false);
    expect(r.autoScore).toBe(2);
  });
});

describe('scoreResponse — ordering (all-or-nothing)', () => {
  const question = q({ question_type: 'ordering', points: 3, question_data: { correctOrder: ['a', 'b', 'c'] } });

  test('exact order match', () => {
    expect(scoreResponse(question, [], { order: ['a', 'b', 'c'] })).toEqual({ isCorrect: true, autoScore: 3, requiresManualGrading: false });
  });

  test('any deviation scores zero (no partial credit)', () => {
    expect(scoreResponse(question, [], { order: ['a', 'c', 'b'] }).autoScore).toBe(0);
  });
});

describe('scoreResponse — fill_in_blank (partial credit)', () => {
  const question = q({
    question_type: 'multiple_fill_in_blank', points: 2,
    question_data: { blanks: [{ gapId: 'g1', acceptedAnswers: ['cat'] }, { gapId: 'g2', acceptedAnswers: ['dog'] }] },
  });

  test('both blanks correct', () => {
    expect(scoreResponse(question, [], { answers: { g1: 'cat', g2: 'dog' } }).autoScore).toBe(2);
  });

  test('one of two blanks correct -> partial credit', () => {
    const r = scoreResponse(question, [], { answers: { g1: 'cat', g2: 'wrong' } });
    expect(r.isCorrect).toBe(false);
    expect(r.autoScore).toBe(1);
  });
});

describe('scoreResponse — always-manual types', () => {
  test.each(['long_text', 'hotspot', 'file_upload', 'formula'])('%s always requires manual grading', (type) => {
    const r = scoreResponse(q({ question_type: type }), [], {});
    expect(r).toEqual({ isCorrect: null, autoScore: null, requiresManualGrading: true });
  });

  test('manual_grading=true overrides an otherwise auto-gradable type', () => {
    const question = q({ question_type: 'single_choice', manual_grading: true });
    const r = scoreResponse(question, [{ id: 'o1', is_correct: true }], { selectedOptionId: 'o1' });
    expect(r.requiresManualGrading).toBe(true);
    expect(r.autoScore).toBeNull();
  });
});
