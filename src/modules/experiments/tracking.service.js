'use strict';

/**
 * Core ingestion orchestrator (WEB-DEVELOPER-GUIDE.md §6): resolve the
 * registered assessment, normalize (schema-1.0 compat), validate, then
 * insert the raw event and apply its derived-state transition inside one
 * transaction. A repeated identical eventId is a successful no-op — the
 * transaction still runs but applyTransition is skipped entirely, so a
 * retried batch can never double-count a step or duplicate a submission.
 *
 * learnerId is always actor.id (the authenticated caller) — a submitted
 * payload never selects a different learner (guide §6 step 1).
 */

const { pool } = require('../../config/database');
const {
  LmsAssessmentDefinitionModel, LmsRegisteredReleaseModel, LmsRawEventModel,
  LmsLearnerSessionModel, LmsExperimentAttemptModel, LmsStepStateModel,
  LmsAnswerSubmissionModel, LmsSavedResultModel,
} = require('../../db/models');
const { normalize, DEFAULT_LEGACY_VERSION } = require('./event-normalizer.service');
const { validate } = require('./event-validation.service');
const { computeStepProgress } = require('./progress.service');
const releaseRegistrationService = require('./release-registration.service');
const ApiError = require('../../utils/apiError');

async function processEvent(rawPayload, actor) {
  if (!actor) throw ApiError.unauthorized('Authentication required.');

  const schemaVersion = rawPayload?.schemaVersion;
  const projectId = rawPayload?.projectId;
  const eventType = rawPayload?.eventType;
  if (!projectId) throw ApiError.badRequest('Missing projectId.');

  // Schema 1.0 carries no assessmentVersion/projectVersion at all — the only
  // registered release for the legacy FM103 build is 1.0.0, so that's the
  // sole candidate.
  const assessmentVersionGuess = rawPayload.assessmentVersion ||
    (schemaVersion === '1.0' ? DEFAULT_LEGACY_VERSION : null);
  if (!assessmentVersionGuess) throw ApiError.badRequest('Missing assessmentVersion.');

  const projectVersionGuess = rawPayload.projectVersion ||
    (schemaVersion === '1.0' ? DEFAULT_LEGACY_VERSION : null);
  if (!projectVersionGuess) throw ApiError.badRequest('Missing projectVersion.');

  let assessmentDef = await LmsAssessmentDefinitionModel.findByProjectAndVersion(projectId, assessmentVersionGuess);
  let release = assessmentDef
    ? await LmsRegisteredReleaseModel.findByProjectAndVersion(projectId, projectVersionGuess)
    : null;

  if (!assessmentDef || !release) {
    // The event contract guarantees SessionStarted always fires first for a
    // given build, and it's the only event type that can carry a
    // self-describing projectManifest — any other event type arriving for an
    // unregistered project can never be trusted to auto-register from, so
    // the client is told exactly what to do instead of silently coerced.
    if (eventType !== 'SessionStarted') {
      throw ApiError.badRequest(
        `No registered release for ${projectId} / ${projectVersionGuess}. The client must send ` +
        'SessionStarted (with projectManifest, for a new build) before any other event type.',
      );
    }
    ({ assessmentDef, release } = await releaseRegistrationService.ensureRegistered({
      projectId,
      projectVersion: projectVersionGuess,
      assessmentVersion: assessmentVersionGuess,
      manifest: rawPayload.projectManifest || null,
      existingAssessmentDef: assessmentDef,
    }));
  }

  const normalized = normalize(rawPayload, { legacyStepMap: assessmentDef.legacy_step_map });
  validate(normalized, assessmentDef);

  // Guide §6 step 3: the release must map to the supplied assessment before
  // any of its events are trusted as authoritative.
  if (release.assessment_version !== normalized.assessmentVersion) {
    throw ApiError.badRequest('Registered release does not map to the supplied assessmentVersion.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const inserted = await LmsRawEventModel.insertIfAbsent({
      eventId: normalized.eventId,
      sessionId: normalized.sessionId,
      experimentAttemptId: normalized.experimentAttemptId || null,
      learnerId: actor.id,
      eventType: normalized.eventType,
      schemaVersion: normalized.schemaVersion,
      payload: rawPayload,
    }, client);

    if (!inserted) {
      await client.query('COMMIT');
      return { eventId: normalized.eventId, status: 'duplicate' };
    }

    await applyTransition(normalized, actor, client, assessmentDef);

    await client.query('COMMIT');
    return { eventId: normalized.eventId, status: 'stored' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function applyTransition(normalized, actor, client, assessmentDef) {
  const {
    eventType, sessionId, experimentAttemptId, projectId, projectVersion,
    assessmentVersion, experimentId, timestamp, stepNumber, questionId,
    questionType, answer, attempt, eventId,
  } = normalized;

  switch (eventType) {
    case 'SessionStarted':
      await LmsLearnerSessionModel.createIfAbsent({
        sessionId, learnerId: actor.id, institutionId: actor.institutionId ?? null,
        projectId, projectVersion, assessmentVersion, startedAt: timestamp,
      }, client);
      break;

    case 'SessionCompleted':
      await LmsLearnerSessionModel.markCompleted(sessionId, timestamp, client);
      break;

    case 'ExperimentStarted':
      await LmsExperimentAttemptModel.createIfAbsent({
        experimentAttemptId, sessionId, learnerId: actor.id, projectId,
        projectVersion, assessmentVersion, experimentId, startedAt: timestamp,
      }, client);
      break;

    case 'ExperimentAborted':
      // "Close run as aborted; preserve submitted work" — step/answer rows are
      // never deleted, so no further action is needed beyond the status flip.
      await LmsExperimentAttemptModel.markStatus(experimentAttemptId, 'aborted', timestamp, client);
      break;

    case 'ExperimentCompleted': {
      const attemptRow = await LmsExperimentAttemptModel.markStatus(experimentAttemptId, 'completed', timestamp, client);
      // Only the transition that actually closed the attempt saves a result —
      // a duplicate/retry ExperimentCompleted on an already-completed attempt
      // returns null here and is correctly skipped.
      if (attemptRow) await saveCompletionResult(attemptRow, assessmentDef, client);
      break;
    }

    case 'StepStarted':
      await LmsStepStateModel.markStarted(experimentAttemptId, stepNumber, eventId, client);
      break;

    case 'StepCompleted':
      await LmsStepStateModel.markCompleted(experimentAttemptId, stepNumber, eventId, client);
      break;

    case 'StepFailed':
      await LmsStepStateModel.markFailed(experimentAttemptId, stepNumber, eventId, client);
      break;

    case 'StepRetried':
      await LmsStepStateModel.markRetried(experimentAttemptId, stepNumber, eventId, client);
      break;

    case 'QuestionShown':
      // Recorded via the raw_events insert above only — guide §5: no points
      // awarded, no submission counted.
      break;

    case 'QuestionAnswered':
      await LmsAnswerSubmissionModel.upsertAnswered(experimentAttemptId, questionId, attempt, {
        questionType, answer, eventId,
      }, client);
      break;

    case 'QuestionCorrect':
      await LmsAnswerSubmissionModel.upsertResult(experimentAttemptId, questionId, attempt, {
        result: 'correct', eventId,
      }, client);
      break;

    case 'QuestionIncorrect':
      await LmsAnswerSubmissionModel.upsertResult(experimentAttemptId, questionId, attempt, {
        result: 'incorrect', eventId,
      }, client);
      break;

    default:
      // Unreachable — event-validation.service already rejects unknown eventTypes.
      break;
  }
}

/**
 * ExperimentCompleted is a distinct signal from the step-progress percentage
 * (guide §7) — this snapshots whatever step evidence exists at completion
 * time rather than assuming 100%. Grade stays unset until a grading policy
 * is agreed (later phase, not Phase 1). Never overwrites an existing saved
 * result for this (learner, project, assessmentVersion, experiment) — a
 * replay attempt's completion is preserved in lms_experiment_attempts/
 * lms_step_states for audit, but doesn't silently replace a prior result.
 */
async function saveCompletionResult(attemptRow, assessmentDef, client) {
  const experimentItems = assessmentDef.required_items[attemptRow.experiment_id];
  const stepStates = await LmsStepStateModel.findByAttempt(attemptRow.experiment_attempt_id, client);
  const { numerator, denominator } = computeStepProgress(stepStates, experimentItems?.requiredSteps ?? []);

  await LmsSavedResultModel.insertIfAbsent({
    learnerId: attemptRow.learner_id,
    projectId: attemptRow.project_id,
    assessmentVersion: attemptRow.assessment_version,
    experimentId: attemptRow.experiment_id,
    sourceAttemptId: attemptRow.experiment_attempt_id,
    sourceProjectVersion: attemptRow.project_version,
    stepNumerator: numerator,
    stepDenominator: denominator,
    completionStatus: 'completed',
  }, client);
}

module.exports = { processEvent };
