'use strict';

const { pool } = require('../../config/database');

const SESSION_COLS = `
  session_id, learner_id, institution_id, project_id, project_version, assessment_version,
  status, started_at, ended_at, created_at, updated_at
`;

const LmsLearnerSessionModel = {
  async findById(sessionId) {
    const { rows } = await pool.query(
      `SELECT ${SESSION_COLS} FROM lms_learner_sessions WHERE session_id = $1`,
      [sessionId],
    );
    return rows[0] ?? null;
  },

  /**
   * Idempotent by session_id (the Unity-supplied UUID): a repeated
   * SessionStarted for the same session_id is a no-op that returns the
   * original row untouched.
   */
  async createIfAbsent({ sessionId, learnerId, institutionId, projectId, projectVersion, assessmentVersion, startedAt }, db = pool) {
    const { rows } = await db.query(
      `INSERT INTO lms_learner_sessions
         (session_id, learner_id, institution_id, project_id, project_version, assessment_version, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (session_id) DO NOTHING
       RETURNING ${SESSION_COLS}`,
      [sessionId, learnerId, institutionId ?? null, projectId, projectVersion, assessmentVersion, startedAt],
    );
    if (rows[0]) return rows[0];
    const { rows: existing } = await db.query(
      `SELECT ${SESSION_COLS} FROM lms_learner_sessions WHERE session_id = $1`,
      [sessionId],
    );
    return existing[0] ?? null;
  },

  /** SessionCompleted — only transitions an active session; already-completed is a no-op. */
  async markCompleted(sessionId, endedAt, db = pool) {
    const { rows } = await db.query(
      `UPDATE lms_learner_sessions
          SET status = 'completed', ended_at = $2, updated_at = NOW()
        WHERE session_id = $1 AND status = 'active'
        RETURNING ${SESSION_COLS}`,
      [sessionId, endedAt],
    );
    return rows[0] ?? null;
  },
};

module.exports = LmsLearnerSessionModel;
