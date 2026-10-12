'use strict';

const { pool } = require('../../config/database');

const RESULT_COLS = `
  id, learner_id, project_id, assessment_version, experiment_id, source_attempt_id,
  source_project_version, step_numerator, step_denominator, grade, completion_status,
  created_at, updated_at
`;

const LmsSavedResultModel = {
  /** Guide §8 lookup key: (learnerId, projectId, assessmentVersion, experimentId) — version-preserved across builds. */
  async findOne(learnerId, projectId, assessmentVersion, experimentId) {
    const { rows } = await pool.query(
      `SELECT ${RESULT_COLS} FROM lms_saved_results
        WHERE learner_id = $1 AND project_id = $2 AND assessment_version = $3 AND experiment_id = $4`,
      [learnerId, projectId, assessmentVersion, experimentId],
    );
    return rows[0] ?? null;
  },

  /**
   * Records a completion only if none exists yet for this key. A replay
   * attempt starts a new attempt row (lms_experiment_attempts) without
   * automatically erasing a prior completion — guide §8: "never combine raw
   * step events from separate attempts" and never silently overwrite a
   * saved result. Reconciling an existing result to a better one is an
   * explicit, later-phase action, not an automatic upsert.
   */
  async insertIfAbsent({
    learnerId, projectId, assessmentVersion, experimentId, sourceAttemptId,
    sourceProjectVersion, stepNumerator, stepDenominator, completionStatus,
  }, db = pool) {
    const { rows } = await db.query(
      `INSERT INTO lms_saved_results
         (learner_id, project_id, assessment_version, experiment_id, source_attempt_id,
          source_project_version, step_numerator, step_denominator, completion_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (learner_id, project_id, assessment_version, experiment_id) DO NOTHING
       RETURNING ${RESULT_COLS}`,
      [
        learnerId, projectId, assessmentVersion, experimentId, sourceAttemptId,
        sourceProjectVersion, stepNumerator, stepDenominator ?? null, completionStatus,
      ],
    );
    return rows[0] ?? null;
  },
};

module.exports = LmsSavedResultModel;
