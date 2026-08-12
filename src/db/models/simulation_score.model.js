/**
 * Simulation score model — bridges simulation_activity_sessions to the
 * gradebook. Migration 047. Phase 1: CRUD + manual instructor entry. The
 * Unity postMessage bridge hook into activity.service.js end() is Phase 3.
 */
'use strict';

const { pool } = require('../../config/database');

const SCORE_COLS = `
  id, simulation_activity_session_id, simulation_id, user_id,
  institution_id, department_id, course_id, module_id, lesson_id,
  attempt_number, score_source, raw_score, points_possible, percentage, passed,
  status, external_score_payload, submitted_at, graded_at, graded_by, override_reason,
  lti_resource_link_id, ags_sync_status, ags_last_sync_at, ags_last_error, ags_retry_count,
  created_at, updated_at
`;

const SimulationScoreModel = {
  async findById(id) {
    const { rows } = await pool.query(
      `SELECT ${SCORE_COLS} FROM simulation_scores WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async listByCourse(courseId) {
    const { rows } = await pool.query(
      `SELECT ${SCORE_COLS} FROM simulation_scores WHERE course_id = $1 ORDER BY created_at DESC`,
      [courseId],
    );
    return rows;
  },

  /**
   * Pending manual-score count for dashboards. Phase 1 (`createManualScore`) always
   * writes `status: 'graded'` immediately — there is no code path that creates a
   * `pending` row yet (Phase 3, Unity postMessage bridge). This always returns 0
   * today; kept as a real query so the KPI activates automatically once Phase 3 lands.
   */
  async countPendingByCourse({ courseId, institutionId, departmentId, instructorId } = {}) {
    const params = [];
    const filters = [`ss.status = 'pending'`];
    const joins = [];
    if (courseId)      filters.push(`ss.course_id = $${params.push(courseId)}`);
    if (institutionId) filters.push(`ss.institution_id = $${params.push(institutionId)}`);
    if (departmentId)  filters.push(`ss.department_id = $${params.push(departmentId)}`);
    if (instructorId) {
      joins.push('JOIN courses c ON c.id = ss.course_id');
      filters.push(`c.instructor_id = $${params.push(instructorId)}`);
    }
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM simulation_scores ss ${joins.join(' ')} WHERE ${filters.join(' AND ')}`,
      params,
    );
    return parseInt(rows[0].total, 10);
  },

  async listByUser(userId, { courseId } = {}) {
    const params = [userId];
    let where = 'user_id = $1';
    if (courseId) { params.push(courseId); where += ` AND course_id = $${params.length}`; }
    const { rows } = await pool.query(
      `SELECT ${SCORE_COLS} FROM simulation_scores WHERE ${where} ORDER BY created_at DESC`,
      params,
    );
    return rows;
  },

  async create({
    simulationActivitySessionId, simulationId, userId,
    institutionId, departmentId, courseId, moduleId, lessonId,
    attemptNumber, scoreSource, rawScore, pointsPossible, percentage, passed,
    status, externalScorePayload, submittedAt, gradedAt, gradedBy, overrideReason,
  }) {
    const { rows } = await pool.query(
      `INSERT INTO simulation_scores
         (simulation_activity_session_id, simulation_id, user_id,
          institution_id, department_id, course_id, module_id, lesson_id,
          attempt_number, score_source, raw_score, points_possible, percentage, passed,
          status, external_score_payload, submitted_at, graded_at, graded_by, override_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING ${SCORE_COLS}`,
      [
        simulationActivitySessionId ?? null, simulationId, userId,
        institutionId, departmentId ?? null, courseId, moduleId ?? null, lessonId ?? null,
        attemptNumber ?? 1, scoreSource ?? 'instructor', rawScore ?? null, pointsPossible ?? null,
        percentage ?? null, passed ?? null,
        status ?? 'pending', externalScorePayload ? JSON.stringify(externalScorePayload) : null,
        submittedAt ?? null, gradedAt ?? null, gradedBy ?? null, overrideReason ?? null,
      ],
    );
    return rows[0];
  },

  /** All attempts for a user at a given course+lesson — used by ags.service.js to apply the grade policy (best/last/first/average). */
  async listAttemptsForUserLesson(courseId, lessonId, userId) {
    const { rows } = await pool.query(
      `SELECT ${SCORE_COLS} FROM simulation_scores
        WHERE course_id = $1 AND lesson_id = $2 AND user_id = $3
        ORDER BY attempt_number ASC`,
      [courseId, lessonId, userId],
    );
    return rows;
  },

  async update(id, fields) {
    const allowed = [
      'raw_score', 'points_possible', 'percentage', 'passed', 'status',
      'external_score_payload', 'submitted_at', 'graded_at', 'graded_by', 'override_reason',
      'lti_resource_link_id', 'ags_sync_status', 'ags_last_sync_at', 'ags_last_error', 'ags_retry_count',
    ];
    const jsonFields = new Set(['external_score_payload']);
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        const val = jsonFields.has(key) && fields[key] != null ? JSON.stringify(fields[key]) : fields[key];
        params.push(val);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (sets.length === 0) return this.findById(id);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE simulation_scores SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} RETURNING ${SCORE_COLS}`,
      params,
    );
    return rows[0] ?? null;
  },
};

module.exports = SimulationScoreModel;
