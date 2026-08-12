/**
 * Simulation session model — per-student attempt tracking + event log.
 * SRS §4.7 SIM-03; §4.8 GRD-01 auto-grading; §13.3 scoring engine.
 * scoring formula: step_score = step_max - (hints × penalty)
 *   session_score = SUM(step_scores) / SUM(step_max_scores) × simulation.max_score
 */
'use strict';

const { pool } = require('../../config/database');

const SESSION_COLS = `
  id, simulation_id, user_id, course_id, lesson_id,
  attempt_number, status, score, max_score, active_seconds,
  started_at, completed_at, scorm_suspend_data, scorm_lesson_location
`;

const SessionModel = {
  async findById(id) {
    const { rows } = await pool.query(
      `SELECT ${SESSION_COLS} FROM simulation_sessions WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  /** Next attempt number for the user on this simulation (in this course context). */
  async nextAttemptNumber(simulationId, userId, courseId = null) {
    const { rows } = await pool.query(
      `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next
         FROM simulation_sessions
        WHERE simulation_id = $1 AND user_id = $2
          AND (course_id = $3 OR ($3 IS NULL AND course_id IS NULL))`,
      [simulationId, userId, courseId],
    );
    return rows[0].next;
  },

  async create({ simulationId, userId, courseId, lessonId, attemptNumber, maxScore }) {
    const { rows } = await pool.query(
      `INSERT INTO simulation_sessions
         (simulation_id, user_id, course_id, lesson_id, attempt_number, max_score)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING ${SESSION_COLS}`,
      [simulationId, userId, courseId ?? null, lessonId ?? null,
       attemptNumber, maxScore ?? 100],
    );
    return rows[0];
  },

  /** Patch SCORM state during an in-progress session (PLR-03 resume). */
  async updateScormState(id, { suspendData, lessonLocation, activeSeconds }) {
    const { rows } = await pool.query(
      `UPDATE simulation_sessions
          SET scorm_suspend_data    = COALESCE($2, scorm_suspend_data),
              scorm_lesson_location = COALESCE($3, scorm_lesson_location),
              active_seconds        = COALESCE($4, active_seconds)
        WHERE id = $1 AND status = 'in_progress'
        RETURNING ${SESSION_COLS}`,
      [id, suspendData ?? null, lessonLocation ?? null, activeSeconds ?? null],
    );
    return rows[0] ?? null;
  },

  /** Complete a session — set score and status, clear SCORM temp data. */
  async complete(id, { score, activeSeconds }) {
    const { rows } = await pool.query(
      `UPDATE simulation_sessions
          SET status       = 'completed',
              score        = $2,
              active_seconds = COALESCE($3, active_seconds),
              completed_at = NOW()
        WHERE id = $1 AND status = 'in_progress'
        RETURNING ${SESSION_COLS}`,
      [id, score, activeSeconds ?? null],
    );
    return rows[0] ?? null;
  },

  async abandon(id) {
    const { rows } = await pool.query(
      `UPDATE simulation_sessions
          SET status = 'abandoned', completed_at = NOW()
        WHERE id = $1 AND status = 'in_progress'
        RETURNING id`,
      [id],
    );
    return rows[0] ?? null;
  },

  /** Best score across all completed attempts (for grade posting). */
  async bestScore(simulationId, userId, courseId = null) {
    const { rows } = await pool.query(
      `SELECT MAX(score) AS best_score
         FROM simulation_sessions
        WHERE simulation_id = $1 AND user_id = $2
          AND (course_id = $3 OR ($3 IS NULL AND course_id IS NULL))
          AND status = 'completed'`,
      [simulationId, userId, courseId],
    );
    return rows[0]?.best_score ?? null;
  },

  async listForUser(userId, { simulationId, courseId, limit = 20, offset = 0 } = {}) {
    const params = [userId, limit, offset];
    const filters = ['user_id = $1'];
    if (simulationId) filters.push(`simulation_id = $${params.push(simulationId)}`);
    if (courseId)     filters.push(`course_id = $${params.push(courseId)}`);
    const { rows } = await pool.query(
      `SELECT ${SESSION_COLS} FROM simulation_sessions
        WHERE ${filters.join(' AND ')}
        ORDER BY started_at DESC LIMIT $2 OFFSET $3`,
      params,
    );
    return rows;
  },

  // ------------------------------------------------------------------
  // Event log (insert-only — §13.2 step tracking)
  // ------------------------------------------------------------------

  async addEvent(sessionId, eventType, payload = null) {
    const { rows } = await pool.query(
      `INSERT INTO simulation_events (session_id, event_type, payload)
       VALUES ($1, $2, $3)
       RETURNING id, session_id, event_type, payload, occurred_at`,
      [sessionId, eventType, payload ? JSON.stringify(payload) : null],
    );
    return rows[0];
  },

  async listEvents(sessionId, { limit = 200, offset = 0 } = {}) {
    const { rows } = await pool.query(
      `SELECT id, event_type, payload, occurred_at
         FROM simulation_events
        WHERE session_id = $1
        ORDER BY occurred_at ASC LIMIT $2 OFFSET $3`,
      [sessionId, limit, offset],
    );
    return rows;
  },
};

module.exports = SessionModel;
