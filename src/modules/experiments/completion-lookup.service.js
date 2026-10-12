'use strict';

/**
 * Guide §8: look up an existing saved completion by
 * (learnerId, projectId, assessmentVersion, experimentId) before showing a
 * new required assignment — and to preserve scores across build versions
 * that share the same assessmentVersion.
 */

const { LmsSavedResultModel } = require('../../db/models');

async function getCompletion({ learnerId, projectId, assessmentVersion, experimentId }) {
  const result = await LmsSavedResultModel.findOne(learnerId, projectId, assessmentVersion, experimentId);
  if (!result) return null;

  return {
    experimentId: result.experiment_id,
    completionStatus: result.completion_status,
    stepNumerator: result.step_numerator,
    stepDenominator: result.step_denominator,
    grade: result.grade,
    sourceAttemptId: result.source_attempt_id,
    sourceProjectVersion: result.source_project_version,
    completedAt: result.updated_at,
  };
}

module.exports = { getCompletion };
