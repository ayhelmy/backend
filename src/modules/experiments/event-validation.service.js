'use strict';

/**
 * Validates one normalized FM103 event against the guide's contract and the
 * registered assessment definition (WEB-DEVELOPER-GUIDE.md §6 step 2).
 * Throws ApiError.badRequest on any violation — nothing here silently
 * coerces or repairs bad data.
 */

const ApiError = require('../../utils/apiError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUPPORTED_SCHEMA_VERSIONS = new Set(['2.1', '1.0']);

const SESSION_ONLY_EVENT_TYPES = new Set(['SessionStarted', 'SessionCompleted']);
const STEP_EVENT_TYPES = new Set(['StepStarted', 'StepCompleted', 'StepFailed', 'StepRetried']);
const QUESTION_EVENT_TYPES = new Set(['QuestionShown', 'QuestionAnswered', 'QuestionCorrect', 'QuestionIncorrect']);
const ANSWER_EVENT_TYPES = new Set(['QuestionAnswered', 'QuestionCorrect', 'QuestionIncorrect']);

const KNOWN_EVENT_TYPES = new Set([
  ...SESSION_ONLY_EVENT_TYPES,
  'ExperimentStarted', 'ExperimentCompleted', 'ExperimentAborted',
  ...STEP_EVENT_TYPES,
  ...QUESTION_EVENT_TYPES,
]);

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

/**
 * @param {object} normalized  Output of event-normalizer.service.normalize()
 * @param {object} assessmentDef  Row from lms_assessment_definitions
 *   (required_items, grading_rules — already scoped to the event's projectId/assessmentVersion)
 */
function validate(normalized, assessmentDef) {
  if (!normalized || !SUPPORTED_SCHEMA_VERSIONS.has(normalized.schemaVersion)) {
    throw ApiError.badRequest(`Unsupported or missing schemaVersion: ${normalized?.schemaVersion ?? 'none'}`);
  }
  if (!isUuid(normalized.eventId)) throw ApiError.badRequest('Invalid or missing eventId.');
  if (!isUuid(normalized.sessionId)) throw ApiError.badRequest('Invalid or missing sessionId.');
  if (!normalized.eventType || !KNOWN_EVENT_TYPES.has(normalized.eventType)) {
    throw ApiError.badRequest(`Unknown eventType: ${normalized.eventType}`);
  }
  if (!normalized.projectId || normalized.projectId !== assessmentDef.project_id) {
    throw ApiError.badRequest('projectId does not match the registered assessment.');
  }
  if (normalized.assessmentVersion !== assessmentDef.assessment_version) {
    throw ApiError.badRequest('assessmentVersion does not match the registered assessment.');
  }

  if (!SESSION_ONLY_EVENT_TYPES.has(normalized.eventType) && !isUuid(normalized.experimentAttemptId)) {
    throw ApiError.badRequest('Invalid or missing experimentAttemptId.');
  }

  const requiredItems = assessmentDef.required_items || {};
  const experimentItems = normalized.experimentId ? requiredItems[normalized.experimentId] : null;

  if (!SESSION_ONLY_EVENT_TYPES.has(normalized.eventType) && !experimentItems) {
    throw ApiError.badRequest(`Unknown or unregistered experimentId: ${normalized.experimentId}`);
  }

  if (STEP_EVENT_TYPES.has(normalized.eventType)) {
    const stepNumber = normalized.stepNumber;
    if (!Number.isInteger(stepNumber) || stepNumber < 1) {
      const hint = normalized._legacyStepUnmapped ? ` (unmapped legacy stepId "${normalized._legacyStepId}")` : '';
      throw ApiError.badRequest(`stepNumber must be a positive integer for step events${hint}.`);
    }
    // Accept any stepNumber within the experiment's full catalog, not just
    // trackedSteps — the currently shipped build still emits step events for
    // Navigation-flagged steps the 2.1 contract says shouldn't emit at all
    // (confirmed from a real captured event log). A real, benign event
    // should never be rejected; progress.service.js only ever counts
    // requiredSteps, so these extra events don't affect required progress.
    const catalogStepCount = experimentItems.catalogStepCount ?? experimentItems.trackedSteps.length;
    if (stepNumber > catalogStepCount) {
      throw ApiError.badRequest(`stepNumber ${stepNumber} is outside the catalog for ${normalized.experimentId}.`);
    }
  }

  if (QUESTION_EVENT_TYPES.has(normalized.eventType)) {
    const questionId = normalized.questionId;
    if (!questionId || !experimentItems.allQuestions.includes(questionId)) {
      throw ApiError.badRequest(`questionId "${questionId}" is not registered for ${normalized.experimentId}.`);
    }

    const expectedType = assessmentDef.grading_rules?.questionTypes?.[questionId] ?? null;
    if (normalized.questionType && expectedType && normalized.questionType !== expectedType) {
      throw ApiError.badRequest(`questionType mismatch for ${questionId}: expected ${expectedType}.`);
    }

    if (ANSWER_EVENT_TYPES.has(normalized.eventType)) {
      if (!Number.isInteger(normalized.attempt) || normalized.attempt < 1) {
        throw ApiError.badRequest('attempt must be a positive integer for answer/result events.');
      }
      const type = expectedType || normalized.questionType;
      const answer = normalized.answer;
      if (type === 'TrueFalse' && !['true', 'false'].includes(answer)) {
        throw ApiError.badRequest(`Invalid TrueFalse answer for ${questionId}: "${answer}".`);
      }
      if (type === 'MultipleChoice' && !/^\d+$/.test(answer ?? '')) {
        throw ApiError.badRequest(`Invalid MultipleChoice answer for ${questionId}: "${answer}".`);
      }
    }
  }
}

module.exports = {
  validate,
  SESSION_ONLY_EVENT_TYPES,
  STEP_EVENT_TYPES,
  QUESTION_EVENT_TYPES,
  ANSWER_EVENT_TYPES,
};
