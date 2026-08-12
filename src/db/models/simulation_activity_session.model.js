'use strict';

/**
 * SimulationActivitySessionModel — query helpers for simulation_activity_sessions.
 * Migration 036: tracks per-lesson simulation entry/exit + duration.
 * Duration is always calculated server-side; never trust client-sent values.
 */

const { pool } = require('../../config/database');

const COLS = `
  id, institution_id, department_id, user_id, user_role,
  course_id, module_id, lesson_id, simulation_id,
  started_at, ended_at, duration_seconds, last_heartbeat_at,
  status, exit_reason, created_at, updated_at
`;

function mapRow(row) {
  if (!row) return null;
  return {
    id:               row.id,
    institutionId:    row.institution_id,
    departmentId:     row.department_id     ?? null,
    userId:           row.user_id,
    userRole:         row.user_role,
    courseId:         row.course_id,
    moduleId:         row.module_id,
    lessonId:         row.lesson_id,
    simulationId:     row.simulation_id,
    startedAt:        row.started_at,
    endedAt:          row.ended_at           ?? null,
    durationSeconds:  row.duration_seconds,
    lastHeartbeatAt:  row.last_heartbeat_at  ?? null,
    status:           row.status,
    exitReason:       row.exit_reason        ?? null,
    createdAt:        row.created_at,
    updatedAt:        row.updated_at,
  };
}

const SimulationActivitySessionModel = {

  async findById(id) {
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM simulation_activity_sessions WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async create({ institutionId, departmentId, userId, userRole, courseId, moduleId, lessonId, simulationId }) {
    const { rows } = await pool.query(
      `INSERT INTO simulation_activity_sessions
         (institution_id, department_id, user_id, user_role,
          course_id, module_id, lesson_id, simulation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING ${COLS}`,
      [institutionId, departmentId ?? null, userId, userRole,
       courseId, moduleId, lessonId, simulationId],
    );
    return rows[0];
  },

  /** Stamp last_heartbeat_at = NOW(). Only updates if session is still active. */
  async updateHeartbeat(id) {
    const { rows } = await pool.query(
      `UPDATE simulation_activity_sessions
         SET last_heartbeat_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'active'
       RETURNING ${COLS}`,
      [id],
    );
    return rows[0] ?? null;
  },

  /** End session: set ended_at = NOW(), calculate duration, update status. */
  async end(id, exitReason) {
    const { rows } = await pool.query(
      `UPDATE simulation_activity_sessions
         SET ended_at         = NOW(),
             status           = 'ended',
             exit_reason      = $2,
             duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER),
             updated_at       = NOW()
       WHERE id = $1 AND status = 'active'
       RETURNING ${COLS}`,
      [id, exitReason ?? null],
    );
    return rows[0] ?? null;
  },

  /**
   * End any existing active sessions for the same user+lesson+simulation combo.
   * Called before creating a new session to prevent duplicates.
   * Uses last_heartbeat_at as end time when available.
   */
  async endStaleActive(userId, lessonId, simulationId) {
    await pool.query(
      `UPDATE simulation_activity_sessions
         SET status           = 'ended',
             exit_reason      = 'navigation',
             ended_at         = COALESCE(last_heartbeat_at, started_at),
             duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM
               (COALESCE(last_heartbeat_at, started_at) - started_at))::INTEGER),
             updated_at       = NOW()
       WHERE user_id = $1 AND lesson_id = $2 AND simulation_id = $3 AND status = 'active'`,
      [userId, lessonId, simulationId],
    );
  },

  /**
   * Cleanup job: mark sessions abandoned when last heartbeat is older than cutoff.
   * Duration = last_heartbeat_at - started_at.
   */
  async markAbandonedByHeartbeat(heartbeatCutoff) {
    const { rows } = await pool.query(
      `UPDATE simulation_activity_sessions
         SET status           = 'abandoned',
             exit_reason      = 'timeout',
             ended_at         = last_heartbeat_at,
             duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM
               (last_heartbeat_at - started_at))::INTEGER),
             updated_at       = NOW()
       WHERE status = 'active'
         AND last_heartbeat_at IS NOT NULL
         AND last_heartbeat_at < $1
       RETURNING id`,
      [heartbeatCutoff],
    );
    return rows.length;
  },

  /**
   * Cleanup job: mark sessions expired that never received a heartbeat and
   * started before the cutoff. Duration = 0.
   */
  async markExpiredNoHeartbeat(startedAtCutoff) {
    const { rows } = await pool.query(
      `UPDATE simulation_activity_sessions
         SET status           = 'expired',
             exit_reason      = 'timeout',
             ended_at         = started_at,
             duration_seconds = 0,
             updated_at       = NOW()
       WHERE status = 'active'
         AND last_heartbeat_at IS NULL
         AND started_at < $1
       RETURNING id`,
      [startedAtCutoff],
    );
    return rows.length;
  },

  /** Latest completed/ended session for a student on a specific lesson+simulation. */
  async getLatestByLessonUser(lessonId, userId, simulationId) {
    const { rows } = await pool.query(
      `SELECT id, started_at, ended_at, duration_seconds, status
         FROM simulation_activity_sessions
        WHERE lesson_id = $1 AND user_id = $2 AND simulation_id = $3
          AND status != 'active'
        ORDER BY started_at DESC
        LIMIT 1`,
      [lessonId, userId, simulationId],
    );
    return rows[0] ?? null;
  },

  /** Paginated activity list for a single student. */
  async listByUser(userId, filters, { limit, offset }) {
    const conds  = ['s.user_id = $1'];
    const params = [userId];

    if (filters.courseId)     conds.push(`s.course_id = $${params.push(filters.courseId)}`);
    if (filters.lessonId)     conds.push(`s.lesson_id = $${params.push(filters.lessonId)}`);
    if (filters.simulationId) conds.push(`s.simulation_id = $${params.push(filters.simulationId)}`);
    if (filters.status)       conds.push(`s.status = $${params.push(filters.status)}`);
    if (filters.dateFrom)     conds.push(`s.started_at >= $${params.push(filters.dateFrom)}`);
    if (filters.dateTo)       conds.push(`s.started_at <= $${params.push(filters.dateTo)}`);

    const where    = `WHERE ${conds.join(' AND ')}`;
    const nextIdx  = params.length + 1;
    const dataParams = [...params, limit, offset];

    const [countRes, dataRes] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM simulation_activity_sessions s ${where}`,
        params,
      ),
      pool.query(
        `SELECT s.id, s.user_id, s.user_role, s.course_id, s.module_id,
                s.lesson_id, s.simulation_id,
                s.started_at, s.ended_at, s.duration_seconds,
                s.last_heartbeat_at, s.status, s.exit_reason,
                c.title   AS course_title,
                cm.title  AS module_title,
                l.title   AS lesson_title,
                sim.title AS simulation_title
           FROM simulation_activity_sessions s
           LEFT JOIN courses        c   ON c.id   = s.course_id
           LEFT JOIN course_modules cm  ON cm.id  = s.module_id
           LEFT JOIN lessons        l   ON l.id   = s.lesson_id
           LEFT JOIN simulations    sim ON sim.id = s.simulation_id
          ${where}
          ORDER BY s.started_at DESC
          LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
        dataParams,
      ),
    ]);

    return { rows: dataRes.rows.map(mapRow), total: parseInt(countRes.rows[0].count, 10) };
  },

  /** Paginated activity list for a course (instructor/admin view). */
  async listByCourse(courseId, filters, { limit, offset }) {
    const conds  = ['s.course_id = $1'];
    const params = [courseId];

    if (filters.userId)       conds.push(`s.user_id = $${params.push(filters.userId)}`);
    if (filters.lessonId)     conds.push(`s.lesson_id = $${params.push(filters.lessonId)}`);
    if (filters.simulationId) conds.push(`s.simulation_id = $${params.push(filters.simulationId)}`);
    if (filters.status)       conds.push(`s.status = $${params.push(filters.status)}`);
    if (filters.dateFrom)     conds.push(`s.started_at >= $${params.push(filters.dateFrom)}`);
    if (filters.dateTo)       conds.push(`s.started_at <= $${params.push(filters.dateTo)}`);

    const where    = `WHERE ${conds.join(' AND ')}`;
    const nextIdx  = params.length + 1;
    const dataParams = [...params, limit, offset];

    const [countRes, dataRes] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM simulation_activity_sessions s ${where}`,
        params,
      ),
      pool.query(
        `SELECT s.id, s.user_id, s.user_role, s.course_id, s.module_id,
                s.lesson_id, s.simulation_id,
                s.started_at, s.ended_at, s.duration_seconds,
                s.last_heartbeat_at, s.status, s.exit_reason, s.steps_status,
                u.first_name, u.last_name, u.email AS user_email,
                cm.title  AS module_title,
                l.title   AS lesson_title,
                sim.title AS simulation_title
           FROM simulation_activity_sessions s
           LEFT JOIN users          u   ON u.id   = s.user_id
           LEFT JOIN course_modules cm  ON cm.id  = s.module_id
           LEFT JOIN lessons        l   ON l.id   = s.lesson_id
           LEFT JOIN simulations    sim ON sim.id = s.simulation_id
          ${where}
          ORDER BY s.started_at DESC
          LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
        dataParams,
      ),
    ]);

    return { rows: dataRes.rows, total: parseInt(countRes.rows[0].count, 10) };
  },

  /** Store the step-completion result after a session ends. */
  async updateStepsStatus(id, stepsStatus) {
    await pool.query(
      `UPDATE simulation_activity_sessions
          SET steps_status = $2, updated_at = NOW()
        WHERE id = $1`,
      [id, stepsStatus],
    );
  },

  /** Count of currently-active sessions, scoped — dashboard KPI. */
  async countActive({ institutionId, departmentId, courseIds } = {}) {
    const params = [];
    const filters = [`status = 'active'`];
    if (institutionId) filters.push(`institution_id = $${params.push(institutionId)}`);
    if (departmentId)  filters.push(`department_id = $${params.push(departmentId)}`);
    if (courseIds?.length) filters.push(`course_id = ANY($${params.push(courseIds)})`);
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM simulation_activity_sessions WHERE ${filters.join(' AND ')}`,
      params,
    );
    return parseInt(rows[0].total, 10);
  },

  /** Aggregate summary stats, scoped by institution/department/student — dashboard KPI. */
  async getScopedSummary({ institutionId, departmentId, userId } = {}) {
    const params = [];
    const filters = ['1=1'];
    if (institutionId) filters.push(`institution_id = $${params.push(institutionId)}`);
    if (departmentId)  filters.push(`department_id = $${params.push(departmentId)}`);
    if (userId)        filters.push(`user_id = $${params.push(userId)}`);
    const { rows } = await pool.query(
      `SELECT
         COUNT(*)::INTEGER                                       AS total_launches,
         COUNT(DISTINCT user_id)::INTEGER                        AS unique_students,
         COUNT(DISTINCT simulation_id)::INTEGER                  AS distinct_simulations,
         COALESCE(SUM(duration_seconds), 0)::INTEGER             AS total_duration_seconds,
         COALESCE(ROUND(AVG(duration_seconds)::NUMERIC, 0), 0)::INTEGER
                                                                 AS avg_duration_seconds
         FROM simulation_activity_sessions WHERE ${filters.join(' AND ')}`,
      params,
    );
    return rows[0] ?? { total_launches: 0, unique_students: 0, distinct_simulations: 0, total_duration_seconds: 0, avg_duration_seconds: 0 };
  },

  /** Active students in a course with zero simulation_activity_sessions rows — instructor follow-up. */
  async countStudentsWithoutActivity(courseId) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM enrollments e
        WHERE e.course_id = $1 AND e.role = 'student' AND e.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM simulation_activity_sessions s WHERE s.course_id = $1 AND s.user_id = e.user_id)`,
      [courseId],
    );
    return parseInt(rows[0].total, 10);
  },

  /** Most recent sessions, scoped — feeds the recent-activity merge. */
  async listRecent({ institutionId, departmentId, courseId, courseIds, studentId, limit = 10 } = {}) {
    const params = [];
    const filters = ['1=1'];
    if (institutionId) filters.push(`s.institution_id = $${params.push(institutionId)}`);
    if (departmentId)  filters.push(`s.department_id = $${params.push(departmentId)}`);
    if (courseId)      filters.push(`s.course_id = $${params.push(courseId)}`);
    if (courseIds?.length) filters.push(`s.course_id = ANY($${params.push(courseIds)})`);
    if (studentId)      filters.push(`s.user_id = $${params.push(studentId)}`);
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT s.id, s.user_id, s.course_id, s.simulation_id, s.status,
              s.started_at, s.ended_at, s.duration_seconds,
              u.first_name, u.last_name, sim.title AS simulation_title
         FROM simulation_activity_sessions s
         LEFT JOIN users u ON u.id = s.user_id
         LEFT JOIN simulations sim ON sim.id = s.simulation_id
        WHERE ${filters.join(' AND ')}
        ORDER BY s.started_at DESC LIMIT $${params.length}`,
      params,
    );
    return rows;
  },

  /** Aggregate summary stats for the instructor course header card. */
  async getCourseSummary(courseId) {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*)::INTEGER                                       AS total_launches,
         COUNT(DISTINCT user_id)::INTEGER                        AS unique_students,
         COALESCE(SUM(duration_seconds), 0)::INTEGER             AS total_duration_seconds,
         COALESCE(ROUND(AVG(duration_seconds)::NUMERIC, 0), 0)::INTEGER
                                                                 AS avg_duration_seconds
         FROM simulation_activity_sessions
        WHERE course_id = $1`,
      [courseId],
    );
    return rows[0] ?? { total_launches: 0, unique_students: 0, total_duration_seconds: 0, avg_duration_seconds: 0 };
  },
};

module.exports = SimulationActivitySessionModel;
