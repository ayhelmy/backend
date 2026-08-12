'use strict';

/**
 * Analytics service — SRS §4.14 ANL-01 to ANL-07.
 * All queries are institution-scoped. Super admins may query any institution.
 * Returns aggregated stats only — no raw PII in responses.
 */

const { pool } = require('../../config/database');
const ApiError = require('../../utils/apiError');

function assertInstAccess(instId, actor) {
  if (actor.roles?.includes('super_admin')) return;
  if (instId !== actor.institutionId) throw ApiError.forbidden('Access denied.');
}

// ── institution — ANL-01 ──────────────────────────────────────────────────────

exports.institution = async (instId, q) => {
  if (!instId) throw ApiError.badRequest('Institution ID required.');

  const [users, courses, enrollments, completions, depts, simSessions] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS total FROM users WHERE institution_id=$1 AND deleted_at IS NULL`, [instId]),
    pool.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE status='published') AS published,
              COUNT(*) FILTER (WHERE status='draft')     AS draft,
              COUNT(*) FILTER (WHERE status='archived')  AS archived
         FROM courses WHERE institution_id=$1 AND deleted_at IS NULL`, [instId]),
    pool.query(
      `SELECT COUNT(*) AS total FROM enrollments e
         JOIN courses c ON c.id=e.course_id
        WHERE c.institution_id=$1 AND e.status='active'`, [instId]),
    pool.query(
      `SELECT COUNT(*) AS total FROM course_progress cp
         JOIN courses c ON c.id=cp.course_id
        WHERE c.institution_id=$1 AND cp.status='completed'`, [instId]),
    pool.query(`SELECT COUNT(*) AS total FROM departments WHERE institution_id=$1`, [instId]),
    pool.query(`SELECT COUNT(*) AS total FROM simulation_sessions WHERE institution_id=$1`, [instId]),
  ]);

  return {
    institutionId:     instId,
    totalUsers:        parseInt(users.rows[0].total, 10),
    totalCourses:      parseInt(courses.rows[0].total, 10),
    publishedCourses:  parseInt(courses.rows[0].published, 10),
    draftCourses:      parseInt(courses.rows[0].draft, 10),
    archivedCourses:   parseInt(courses.rows[0].archived, 10),
    activeEnrollments: parseInt(enrollments.rows[0].total, 10),
    completedCourses:  parseInt(completions.rows[0].total, 10),
    totalDepartments:  parseInt(depts.rows[0].total, 10),
    totalSimSessions:  parseInt(simSessions.rows[0].total, 10),
  };
};

// ── course — ANL-02 / ANL-03 ──────────────────────────────────────────────────

exports.course = async (courseId, q, actor) => {
  const { rows: [course] } = await pool.query(
    `SELECT id, institution_id, title, passing_grade
       FROM courses WHERE id=$1 AND deleted_at IS NULL`, [courseId],
  );
  if (!course) throw ApiError.notFound('Course not found.');
  assertInstAccess(course.institution_id, actor);

  const [er, pr, gr] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status='active')    AS active,
         COUNT(*) FILTER (WHERE status='completed') AS completed,
         COUNT(*) FILTER (WHERE status='dropped')   AS dropped,
         COUNT(*) FILTER (WHERE status='pending')   AS pending
       FROM enrollments WHERE course_id=$1`, [courseId]),
    pool.query(
      `SELECT
         ROUND(AVG(completion_pct),2)                              AS avg_completion,
         COUNT(*) FILTER (WHERE status='completed')                AS completed,
         COUNT(*) FILTER (WHERE status='in_progress')              AS in_progress,
         COUNT(*) FILTER (WHERE status='not_started')              AS not_started
       FROM course_progress WHERE course_id=$1`, [courseId]),
    pool.query(
      `SELECT
         ROUND(AVG(g.score/NULLIF(gi.max_points,0)*100),2)  AS avg_pct,
         ROUND(MIN(g.score/NULLIF(gi.max_points,0)*100),2)  AS min_pct,
         ROUND(MAX(g.score/NULLIF(gi.max_points,0)*100),2)  AS max_pct
       FROM grades g JOIN grade_items gi ON gi.id=g.grade_item_id
       WHERE gi.course_id=$1`, [courseId]),
  ]);

  return {
    courseId,
    title:        course.title,
    passingGrade: Number(course.passing_grade),
    enrollments: {
      total:     parseInt(er.rows[0].total, 10),
      active:    parseInt(er.rows[0].active, 10),
      completed: parseInt(er.rows[0].completed, 10),
      dropped:   parseInt(er.rows[0].dropped, 10),
      pending:   parseInt(er.rows[0].pending, 10),
    },
    progress: {
      avgCompletion: pr.rows[0].avg_completion != null ? parseFloat(pr.rows[0].avg_completion) : null,
      completed:     parseInt(pr.rows[0].completed, 10),
      inProgress:    parseInt(pr.rows[0].in_progress, 10),
      notStarted:    parseInt(pr.rows[0].not_started, 10),
    },
    grades: {
      avgPct: gr.rows[0].avg_pct != null ? parseFloat(gr.rows[0].avg_pct) : null,
      minPct: gr.rows[0].min_pct != null ? parseFloat(gr.rows[0].min_pct) : null,
      maxPct: gr.rows[0].max_pct != null ? parseFloat(gr.rows[0].max_pct) : null,
    },
  };
};

// ── simulation — ANL-04 ───────────────────────────────────────────────────────

exports.simulation = async (simId, q, actor) => {
  const { rows: [sim] } = await pool.query(
    `SELECT id, institution_id, title, pass_score, max_score
       FROM simulations WHERE id=$1`, [simId],
  );
  if (!sim) throw ApiError.notFound('Simulation not found.');

  if (!actor.roles?.includes('super_admin') && sim.institution_id &&
      sim.institution_id !== actor.institutionId) {
    throw ApiError.notFound('Simulation not found.');
  }

  const scoped   = !actor.roles?.includes('super_admin');
  const instClause = scoped ? 'AND institution_id=$2' : '';
  const baseParams = scoped ? [simId, actor.institutionId] : [simId];

  const [stats, passResult] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) AS total_sessions,
         COUNT(*) FILTER (WHERE status='completed')   AS completed,
         COUNT(*) FILTER (WHERE status='in_progress') AS in_progress,
         COUNT(*) FILTER (WHERE status='abandoned')   AS abandoned,
         ROUND(AVG(score) FILTER (WHERE status='completed'),2) AS avg_score,
         COUNT(DISTINCT user_id) AS unique_users
       FROM simulation_sessions WHERE simulation_id=$1 ${instClause}`,
      baseParams,
    ),
    pool.query(
      `SELECT COUNT(*) AS passed FROM simulation_sessions
        WHERE simulation_id=$1 AND status='completed' AND score>=$2 ${instClause}`,
      scoped ? [simId, Number(sim.pass_score), actor.institutionId] : [simId, Number(sim.pass_score)],
    ),
  ]);

  const r         = stats.rows[0];
  const completed = parseInt(r.completed, 10);
  const passed    = parseInt(passResult.rows[0].passed, 10);

  return {
    simulationId:  simId,
    title:         sim.title,
    passScore:     Number(sim.pass_score),
    maxScore:      Number(sim.max_score),
    totalSessions: parseInt(r.total_sessions, 10),
    completed,
    inProgress:    parseInt(r.in_progress, 10),
    abandoned:     parseInt(r.abandoned, 10),
    avgScore:      r.avg_score != null ? parseFloat(r.avg_score) : null,
    passRate:      completed > 0 ? parseFloat((passed / completed * 100).toFixed(2)) : null,
    uniqueUsers:   parseInt(r.unique_users, 10),
  };
};

// ── student — ANL-05 / ANL-06 / ANL-07 ───────────────────────────────────────

exports.student = async (studentId, actor) => {
  const isSelf = actor.id === studentId;

  if (!isSelf && !actor.roles?.includes('super_admin')) {
    const { rows: [student] } = await pool.query(
      `SELECT institution_id FROM users WHERE id=$1 AND deleted_at IS NULL`, [studentId],
    );
    if (!student || student.institution_id !== actor.institutionId) {
      throw ApiError.notFound('Student not found.');
    }
    const canView = actor.permissions?.includes('grades.view_course') ||
                    actor.roles?.includes('institution_admin') ||
                    actor.roles?.includes('dept_manager');
    if (!canView) throw ApiError.forbidden('Access denied.');
  }

  const [progress, grades, sessions] = await Promise.all([
    pool.query(
      `SELECT cp.course_id, c.title, cp.completion_pct, cp.current_grade, cp.status, cp.completed_at
         FROM course_progress cp JOIN courses c ON c.id=cp.course_id
        WHERE cp.user_id=$1 ORDER BY cp.updated_at DESC`, [studentId]),
    pool.query(
      `SELECT gi.title AS item_title, gi.item_type, g.score, gi.max_points
         FROM grades g JOIN grade_items gi ON gi.id=g.grade_item_id
        WHERE g.user_id=$1 ORDER BY g.graded_at DESC LIMIT 20`, [studentId]),
    pool.query(
      `SELECT ss.simulation_id, s.title, ss.score, ss.max_score, ss.status,
              ss.attempt_number, ss.started_at, ss.completed_at
         FROM simulation_sessions ss JOIN simulations s ON s.id=ss.simulation_id
        WHERE ss.user_id=$1 ORDER BY ss.started_at DESC LIMIT 20`, [studentId]),
  ]);

  return {
    studentId,
    courseProgress: progress.rows.map((r) => ({
      courseId:      r.course_id,
      title:         r.title,
      completionPct: Number(r.completion_pct),
      currentGrade:  r.current_grade != null ? Number(r.current_grade) : null,
      status:        r.status,
      completedAt:   r.completed_at ?? null,
    })),
    recentGrades: grades.rows.map((r) => ({
      itemTitle: r.item_title,
      itemType:  r.item_type,
      score:     r.score != null ? Number(r.score) : null,
      maxPoints: Number(r.max_points),
      pct:       r.score != null
        ? parseFloat((Number(r.score) / Number(r.max_points) * 100).toFixed(1)) : null,
    })),
    simulationHistory: sessions.rows.map((r) => ({
      simulationId:  r.simulation_id,
      title:         r.title,
      score:         r.score    != null ? Number(r.score)    : null,
      maxScore:      Number(r.max_score),
      status:        r.status,
      attemptNumber: r.attempt_number,
      startedAt:     r.started_at,
      completedAt:   r.completed_at ?? null,
    })),
  };
};
