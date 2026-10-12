'use strict';

const { pool } = require('../../config/database');

const ATTEMPT_COLS = `
  experiment_attempt_id, session_id, learner_id, project_id, project_version, assessment_version,
  experiment_id, status, started_at, ended_at, created_at, updated_at
`;

const LmsExperimentAttemptModel = {
  async findById(experimentAttemptId) {
    const { rows } = await pool.query(
      `SELECT ${ATTEMPT_COLS} FROM lms_experiment_attempts WHERE experiment_attempt_id = $1`,
      [experimentAttemptId],
    );
    return rows[0] ?? null;
  },

  /** Idempotent by experiment_attempt_id — a repeated ExperimentStarted is a no-op. */
  async createIfAbsent({
    experimentAttemptId, sessionId, learnerId, projectId, projectVersion,
    assessmentVersion, experimentId, startedAt,
  }, db = pool) {
    const { rows } = await db.query(
      `INSERT INTO lms_experiment_attempts
         (experiment_attempt_id, session_id, learner_id, project_id, project_version,
          assessment_version, experiment_id, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (experiment_attempt_id) DO NOTHING
       RETURNING ${ATTEMPT_COLS}`,
      [experimentAttemptId, sessionId, learnerId, projectId, projectVersion, assessmentVersion, experimentId, startedAt],
    );
    if (rows[0]) return rows[0];
    const { rows: existing } = await db.query(
      `SELECT ${ATTEMPT_COLS} FROM lms_experiment_attempts WHERE experiment_attempt_id = $1`,
      [experimentAttemptId],
    );
    return existing[0] ?? null;
  },

  /** ExperimentCompleted / ExperimentAborted — only transitions an active attempt. */
  async markStatus(experimentAttemptId, status, endedAt, db = pool) {
    const { rows } = await db.query(
      `UPDATE lms_experiment_attempts
          SET status = $2, ended_at = $3, updated_at = NOW()
        WHERE experiment_attempt_id = $1 AND status = 'active'
        RETURNING ${ATTEMPT_COLS}`,
      [experimentAttemptId, status, endedAt],
    );
    return rows[0] ?? null;
  },

  /** Most recent attempt for a learner's (project, assessmentVersion, experiment) — used when the caller omits experimentAttemptId. */
  async findLatestForLearnerExperiment(learnerId, projectId, assessmentVersion, experimentId) {
    const { rows } = await pool.query(
      `SELECT ${ATTEMPT_COLS} FROM lms_experiment_attempts
        WHERE learner_id = $1 AND project_id = $2 AND assessment_version = $3 AND experiment_id = $4
        ORDER BY started_at DESC LIMIT 1`,
      [learnerId, projectId, assessmentVersion, experimentId],
    );
    return rows[0] ?? null;
  },

  /** All attempts for a learner across a project — "my history" view. */
  async listByLearner(learnerId, projectId) {
    const { rows } = await pool.query(
      `SELECT ${ATTEMPT_COLS} FROM lms_experiment_attempts
        WHERE learner_id = $1 AND project_id = $2
        ORDER BY started_at DESC`,
      [learnerId, projectId],
    );
    return rows;
  },

  /**
   * Instructor dashboard: every attempt (not just the latest) a page of
   * students made on one experiment, newest first per student. Single
   * batched query, no per-student N+1.
   */
  async listForExperiment(projectId, experimentId, learnerIds) {
    if (learnerIds.length === 0) return [];
    const { rows } = await pool.query(
      `SELECT ${ATTEMPT_COLS} FROM lms_experiment_attempts
        WHERE project_id = $1 AND experiment_id = $2 AND learner_id = ANY($3::uuid[])
        ORDER BY learner_id, started_at DESC`,
      [projectId, experimentId, learnerIds],
    );
    return rows;
  },

  /**
   * Course-wide overview tiles for the instructor dashboard: attempt/
   * completion/student counts and median run time (completed attempts
   * only), for one experiment across a page of enrolled students.
   */
  async aggregateForExperiment(projectId, experimentId, learnerIds) {
    if (learnerIds.length === 0) {
      return { attemptCount: 0, completedCount: 0, studentCount: 0, medianDurationSeconds: null };
    }
    const { rows: [row] } = await pool.query(
      `SELECT
          COUNT(*) AS attempt_count,
          COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
          COUNT(DISTINCT learner_id) AS student_count,
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (ended_at - started_at))
          ) FILTER (WHERE status = 'completed') AS median_duration_seconds
        FROM lms_experiment_attempts
       WHERE project_id = $1 AND experiment_id = $2 AND learner_id = ANY($3::uuid[])`,
      [projectId, experimentId, learnerIds],
    );
    return {
      attemptCount: Number(row.attempt_count),
      completedCount: Number(row.completed_count),
      studentCount: Number(row.student_count),
      medianDurationSeconds: row.median_duration_seconds != null ? Number(row.median_duration_seconds) : null,
    };
  },
};

module.exports = LmsExperimentAttemptModel;
