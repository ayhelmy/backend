'use strict';

/**
 * Required-step progress + per-question rollup (WEB-DEVELOPER-GUIDE.md §7):
 *   100 × distinct completed required tracked steps / required tracked steps
 * A zero denominator yields a null percentage, never a division by zero.
 * StepRetried already clears a step's completed marker (lms_step_state.model.js
 * markRetried), so "distinct completed" here only ever counts a step once per
 * its most recent started/completed cycle in this attempt.
 */

const {
  LmsAssessmentDefinitionModel, LmsExperimentAttemptModel,
  LmsStepStateModel, LmsAnswerSubmissionModel,
} = require('../../db/models');
const ApiError = require('../../utils/apiError');

/** Pure — usable both for the read API and inside tracking.service's ExperimentCompleted transaction. */
function computeStepProgress(stepStates, requiredSteps) {
  const denominator = requiredSteps.length;
  if (denominator === 0) return { numerator: 0, denominator: 0, percentage: null };

  const completed = new Set(
    stepStates
      .filter((s) => s.status === 'completed' && requiredSteps.includes(s.step_number))
      .map((s) => s.step_number),
  );

  const numerator = completed.size;
  return {
    numerator,
    denominator,
    percentage: Math.round((numerator / denominator) * 1000) / 10,
  };
}

/**
 * Full per-step status list for one attempt — the union of required steps
 * and whatever was actually reported (same "never silently drop a real
 * event" principle event-validation.service.js already follows for
 * off-catalog step numbers), each tagged with duration when both a
 * started/completed timestamp are available. `stepStates` rows come from
 * LmsStepStateModel.findByAttempts, which already carries
 * started_received_at/completed_received_at alongside status.
 */
function buildStepRows(stepStates, requiredSteps) {
  const byNumber = new Map(stepStates.map((s) => [s.step_number, s]));
  const allNumbers = new Set([...requiredSteps, ...byNumber.keys()]);
  return [...allNumbers].sort((a, b) => a - b).map((stepNumber) => {
    const s = byNumber.get(stepNumber);
    let durationSeconds = null;
    if (s?.started_received_at && s?.completed_received_at) {
      const diff = (new Date(s.completed_received_at) - new Date(s.started_received_at)) / 1000;
      if (diff >= 0) durationSeconds = diff;
    }
    return {
      stepNumber,
      required: requiredSteps.includes(stepNumber),
      status: s?.status ?? 'pending',
      durationSeconds,
    };
  });
}

/** Latest submission per question, tagged with whether it's part of the required set. */
function computeQuestionResults(submissions, requiredQuestions) {
  const latestByQuestion = new Map();
  for (const s of submissions) {
    const prior = latestByQuestion.get(s.question_id);
    if (!prior || s.attempt > prior.attempt) latestByQuestion.set(s.question_id, s);
  }
  return [...latestByQuestion.values()].map((s) => ({
    questionId: s.question_id,
    required: requiredQuestions.includes(s.question_id),
    latestAttempt: s.attempt,
    answer: s.answer,
    result: s.result,
  }));
}

async function getProgress({ learnerId, projectId, assessmentVersion, experimentId, experimentAttemptId }) {
  const assessmentDef = await LmsAssessmentDefinitionModel.findByProjectAndVersion(projectId, assessmentVersion);
  if (!assessmentDef) throw ApiError.notFound('No registered assessment for that projectId/assessmentVersion.');

  const experimentItems = assessmentDef.required_items[experimentId];
  if (!experimentItems) throw ApiError.badRequest(`Unknown experimentId: ${experimentId}`);

  let attempt;
  if (experimentAttemptId) {
    attempt = await LmsExperimentAttemptModel.findById(experimentAttemptId);
    if (!attempt || attempt.learner_id !== learnerId) throw ApiError.notFound('Experiment attempt not found.');
  } else {
    attempt = await LmsExperimentAttemptModel.findLatestForLearnerExperiment(
      learnerId, projectId, assessmentVersion, experimentId,
    );
    if (!attempt) {
      return {
        experimentAttemptId: null,
        attemptStatus: null,
        stepNumerator: 0,
        stepDenominator: experimentItems.requiredSteps.length,
        stepPercentage: null,
        questionResults: [],
      };
    }
  }

  const [stepStates, submissions] = await Promise.all([
    LmsStepStateModel.findByAttempt(attempt.experiment_attempt_id),
    LmsAnswerSubmissionModel.findByAttempt(attempt.experiment_attempt_id),
  ]);

  const stepProgress = computeStepProgress(stepStates, experimentItems.requiredSteps);
  const questionResults = computeQuestionResults(submissions, experimentItems.requiredQuestions);

  return {
    experimentAttemptId: attempt.experiment_attempt_id,
    attemptStatus: attempt.status,
    stepNumerator: stepProgress.numerator,
    stepDenominator: stepProgress.denominator,
    stepPercentage: stepProgress.percentage,
    questionResults,
  };
}

module.exports = { getProgress, computeStepProgress, computeQuestionResults, buildStepRows };
