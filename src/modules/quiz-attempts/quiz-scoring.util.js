/**
 * Quiz auto-scoring engine — pure functions, no DB dependency.
 *
 * Contract (question_data on quiz_questions vs response_payload on quiz_responses),
 * one row per question_type. This is the single source of truth shared by the
 * question-authoring UI, the QTI importer (qti-mapping.util.js produces question_data
 * in this exact shape), and the attempt-taking UI.
 *
 *   single_choice / true_false
 *     question_data: {} (uses quiz_question_options.is_correct)
 *     response_payload: { selectedOptionId: string }
 *     rule: correct iff selected option's is_correct === true
 *
 *   multiple_choice
 *     question_data: {} (uses quiz_question_options)
 *     response_payload: { selectedOptionIds: string[] }
 *     rule: correct iff selected set === set of is_correct option ids exactly
 *
 *   short_text
 *     question_data: { acceptedAnswers: string[], caseSensitive: boolean }
 *     response_payload: { text: string }
 *     rule: trimmed (and case-folded unless caseSensitive) match against any acceptedAnswers entry
 *
 *   long_text
 *     question_data: {}
 *     response_payload: { text: string }
 *     rule: always requiresManualGrading
 *
 *   numeric
 *     question_data: { correctValue: number }
 *     response_payload: { value: number }
 *     rule: exact equality
 *
 *   numeric_tolerance
 *     question_data: { correctValue: number, tolerance: number, toleranceMode: 'absolute'|'relative' }
 *     response_payload: { value: number }
 *     rule: abs(value - correctValue) <= tolerance                (absolute)
 *           abs(value - correctValue) <= tolerance * correctValue  (relative)
 *
 *   matching
 *     question_data: { pairs: [{source:{id,text}, target:{id,text}}], sourceChoices, targetChoices }
 *     response_payload: { matches: [{sourceId: string, targetId: string}] }
 *     rule: partial credit = (# response pairs matching a question_data pair) / pairs.length
 *
 *   ordering
 *     question_data: { items: [{id,text}], correctOrder: string[] }
 *     response_payload: { order: string[] }
 *     rule: exact sequence match only (all-or-nothing) — order deep-equals correctOrder
 *
 *   fill_in_blank / multiple_fill_in_blank
 *     question_data: { blanks: [{gapId, acceptedAnswers: string[]}], wordBank: [{id,text}] }
 *     response_payload: { answers: { [gapId]: string } }
 *     rule: partial credit = (# blanks with a matching accepted answer) / blanks.length
 *
 *   hotspot / file_upload / formula
 *     always requiresManualGrading (not manually authorable — only reachable via QTI import)
 *
 * question.manual_grading === true forces manual grading regardless of type — checked
 * first, before the type dispatch, as a defensive override instructors can set on any
 * question.
 */
'use strict';

function normalizeText(text, caseSensitive) {
  const trimmed = String(text ?? '').trim();
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}

function fullOrZero(points, isCorrect) {
  return { isCorrect, autoScore: isCorrect ? points : 0, requiresManualGrading: false };
}

function scoreSingleChoice(points, options, payload) {
  const selected = payload?.selectedOptionId;
  const correctOption = options.find((o) => o.is_correct);
  const isCorrect = !!selected && !!correctOption && selected === correctOption.id;
  return fullOrZero(points, isCorrect);
}

function scoreMultipleChoice(points, options, payload) {
  const selected = new Set(Array.isArray(payload?.selectedOptionIds) ? payload.selectedOptionIds : []);
  const correctIds = new Set(options.filter((o) => o.is_correct).map((o) => o.id));
  const isCorrect = selected.size === correctIds.size && [...selected].every((id) => correctIds.has(id));
  return fullOrZero(points, isCorrect);
}

function scoreShortText(points, questionData, payload) {
  const caseSensitive = !!questionData?.caseSensitive;
  const answer = normalizeText(payload?.text, caseSensitive);
  const accepted = Array.isArray(questionData?.acceptedAnswers) ? questionData.acceptedAnswers : [];
  const isCorrect = accepted.some((a) => normalizeText(a, caseSensitive) === answer);
  return fullOrZero(points, isCorrect);
}

function scoreNumeric(points, questionData, payload) {
  const value = Number(payload?.value);
  const correctValue = Number(questionData?.correctValue);
  const isCorrect = Number.isFinite(value) && Number.isFinite(correctValue) && value === correctValue;
  return fullOrZero(points, isCorrect);
}

function scoreNumericTolerance(points, questionData, payload) {
  const value = Number(payload?.value);
  const correctValue = Number(questionData?.correctValue);
  const tolerance = Number(questionData?.tolerance ?? 0);
  const toleranceMode = questionData?.toleranceMode === 'relative' ? 'relative' : 'absolute';
  if (!Number.isFinite(value) || !Number.isFinite(correctValue)) return fullOrZero(points, false);
  const allowed = toleranceMode === 'relative' ? tolerance * Math.abs(correctValue) : tolerance;
  const isCorrect = Math.abs(value - correctValue) <= allowed;
  return fullOrZero(points, isCorrect);
}

function scoreMatching(points, questionData, payload) {
  const pairs = Array.isArray(questionData?.pairs) ? questionData.pairs : [];
  const matches = Array.isArray(payload?.matches) ? payload.matches : [];
  if (!pairs.length) return { isCorrect: false, autoScore: 0, requiresManualGrading: false };
  const correctSet = new Set(pairs.map((p) => `${p.source?.id}::${p.target?.id}`));
  const correctCount = matches.filter((m) => correctSet.has(`${m.sourceId}::${m.targetId}`)).length;
  const fraction = correctCount / pairs.length;
  return {
    isCorrect: fraction === 1,
    autoScore: Math.round(points * fraction * 100) / 100,
    requiresManualGrading: false,
  };
}

function scoreOrdering(points, questionData, payload) {
  const correctOrder = Array.isArray(questionData?.correctOrder) ? questionData.correctOrder : [];
  const order = Array.isArray(payload?.order) ? payload.order : [];
  const isCorrect = correctOrder.length > 0
    && order.length === correctOrder.length
    && order.every((id, idx) => id === correctOrder[idx]);
  return fullOrZero(points, isCorrect);
}

function scoreFillInBlank(points, questionData, payload) {
  const blanks = Array.isArray(questionData?.blanks) ? questionData.blanks : [];
  const answers = payload?.answers && typeof payload.answers === 'object' ? payload.answers : {};
  if (!blanks.length) return { isCorrect: false, autoScore: 0, requiresManualGrading: false };
  const correctCount = blanks.filter((b) => {
    const given = normalizeText(answers[b.gapId], false);
    const accepted = Array.isArray(b.acceptedAnswers) ? b.acceptedAnswers : [];
    return accepted.some((a) => normalizeText(a, false) === given);
  }).length;
  const fraction = correctCount / blanks.length;
  return {
    isCorrect: fraction === 1,
    autoScore: Math.round(points * fraction * 100) / 100,
    requiresManualGrading: false,
  };
}

const ALWAYS_MANUAL_TYPES = new Set(['long_text', 'hotspot', 'file_upload', 'formula']);

/**
 * @param {object} question - quiz_questions row (snake_case, as returned by QuizQuestionModel)
 * @param {object[]} options - quiz_question_options rows for this question (empty array if N/A)
 * @param {object} responsePayload - parsed JSON from quiz_responses.response_payload
 * @returns {{isCorrect: boolean|null, autoScore: number|null, requiresManualGrading: boolean}}
 */
function scoreResponse(question, options, responsePayload) {
  if (question.manual_grading || ALWAYS_MANUAL_TYPES.has(question.question_type)) {
    return { isCorrect: null, autoScore: null, requiresManualGrading: true };
  }

  const points = Number(question.points);
  const data = question.question_data ?? {};
  const payload = responsePayload ?? {};

  switch (question.question_type) {
    case 'single_choice':
    case 'true_false':
      return scoreSingleChoice(points, options, payload);
    case 'multiple_choice':
      return scoreMultipleChoice(points, options, payload);
    case 'short_text':
      return scoreShortText(points, data, payload);
    case 'numeric':
      return scoreNumeric(points, data, payload);
    case 'numeric_tolerance':
      return scoreNumericTolerance(points, data, payload);
    case 'matching':
      return scoreMatching(points, data, payload);
    case 'ordering':
      return scoreOrdering(points, data, payload);
    case 'fill_in_blank':
    case 'multiple_fill_in_blank':
      return scoreFillInBlank(points, data, payload);
    default:
      return { isCorrect: null, autoScore: null, requiresManualGrading: true };
  }
}

module.exports = {
  scoreResponse,
  scoreSingleChoice,
  scoreMultipleChoice,
  scoreShortText,
  scoreNumeric,
  scoreNumericTolerance,
  scoreMatching,
  scoreOrdering,
  scoreFillInBlank,
};
