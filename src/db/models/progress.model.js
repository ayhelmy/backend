/**
 * Progress model — lesson/module/course completion tracking.
 * SRS §4.9 PRG-01 – PRG-05; completion_pct drives dashboard widget.
 */
'use strict';

const { pool } = require('../../config/database');

const ProgressModel = {
  // ------------------------------------------------------------------
  // Lesson progress (PRG-01)
  // ------------------------------------------------------------------

  async getLessonProgress(userId, lessonId) {
    const { rows } = await pool.query(
      `SELECT * FROM lesson_progress WHERE user_id = $1 AND lesson_id = $2`,
      [userId, lessonId],
    );
    return rows[0] ?? null;
  },

  async upsertLessonProgress(userId, lessonId, { status, timeSpentSec, completedAt } = {}) {
    const { rows } = await pool.query(
      `INSERT INTO lesson_progress (user_id, lesson_id, status, time_spent_sec, completed_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, lesson_id) DO UPDATE
         SET status         = EXCLUDED.status,
             time_spent_sec = lesson_progress.time_spent_sec + EXCLUDED.time_spent_sec,
             completed_at   = COALESCE(EXCLUDED.completed_at, lesson_progress.completed_at),
             updated_at     = NOW()
       RETURNING *`,
      [userId, lessonId, status ?? 'in_progress', timeSpentSec ?? 0, completedAt ?? null],
    );
    return rows[0];
  },

  // ------------------------------------------------------------------
  // Module progress (aggregated; PRG-02)
  // ------------------------------------------------------------------

  async getModuleProgress(userId, moduleId) {
    const { rows } = await pool.query(
      `SELECT * FROM module_progress WHERE user_id = $1 AND module_id = $2`,
      [userId, moduleId],
    );
    return rows[0] ?? null;
  },

  /** Recomputes module progress from lesson_progress rows (call after any lesson completion). */
  async recalcModuleProgress(userId, moduleId) {
    const { rows } = await pool.query(
      `WITH counts AS (
         SELECT
           COUNT(*) FILTER (WHERE l.is_required)               AS total,
           COUNT(*) FILTER (WHERE lp.status = 'completed'
                               AND l.is_required)              AS completed
         FROM lessons l
         LEFT JOIN lesson_progress lp
           ON lp.lesson_id = l.id AND lp.user_id = $1
        WHERE l.module_id = $2
       )
       INSERT INTO module_progress (user_id, module_id, completed_lessons, total_lessons, status)
       SELECT $1, $2, c.completed, c.total,
         CASE
           WHEN c.total = 0 THEN 'not_started'
           WHEN c.completed = 0 THEN 'not_started'
           WHEN c.completed >= c.total THEN 'completed'
           ELSE 'in_progress'
         END
       FROM counts c
       ON CONFLICT (user_id, module_id) DO UPDATE
         SET completed_lessons = EXCLUDED.completed_lessons,
             total_lessons     = EXCLUDED.total_lessons,
             status            = EXCLUDED.status,
             updated_at        = NOW()
       RETURNING *`,
      [userId, moduleId],
    );
    return rows[0];
  },

  // ------------------------------------------------------------------
  // Course progress (PRG-03)
  // ------------------------------------------------------------------

  async getCourseProgress(userId, courseId) {
    const { rows } = await pool.query(
      `SELECT * FROM course_progress WHERE user_id = $1 AND course_id = $2`,
      [userId, courseId],
    );
    return rows[0] ?? null;
  },

  /** Recomputes course completion percentage from module_progress rows. */
  async recalcCourseProgress(userId, courseId, currentGrade = null) {
    const { rows } = await pool.query(
      `WITH counts AS (
         SELECT
           COUNT(*) FILTER (WHERE l.is_required)               AS total,
           COUNT(*) FILTER (WHERE lp.status = 'completed'
                               AND l.is_required)              AS completed
         FROM course_modules m
         JOIN lessons l ON l.module_id = m.id
         LEFT JOIN lesson_progress lp
           ON lp.lesson_id = l.id AND lp.user_id = $1
        WHERE m.course_id = $2
       )
       INSERT INTO course_progress (user_id, course_id, completion_pct, current_grade, status)
       SELECT $1, $2,
         CASE WHEN c.total > 0 THEN ROUND(c.completed::NUMERIC / c.total * 100, 2) ELSE 0 END,
         $3,
         CASE
           WHEN c.total = 0 THEN 'not_started'
           WHEN c.completed = 0 THEN 'not_started'
           WHEN c.completed >= c.total THEN 'completed'
           ELSE 'in_progress'
         END
       FROM counts c
       ON CONFLICT (user_id, course_id) DO UPDATE
         SET completion_pct = EXCLUDED.completion_pct,
             current_grade  = COALESCE($3, course_progress.current_grade),
             status         = EXCLUDED.status,
             completed_at   = CASE
               WHEN EXCLUDED.status = 'completed' AND course_progress.completed_at IS NULL
               THEN NOW() ELSE course_progress.completed_at END,
             updated_at     = NOW()
       RETURNING *`,
      [userId, courseId, currentGrade],
    );
    return rows[0];
  },

  /** Completed vs. pending required-lesson counts across a student's given courses. */
  async countLessonStatusForUser(userId, courseIds) {
    if (!courseIds?.length) return { completed: 0, pending: 0 };
    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE lp.status = 'completed')             AS completed,
         COUNT(*) FILTER (WHERE lp.status IS NULL OR lp.status != 'completed') AS pending
         FROM lessons l
         LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = $1
        WHERE l.course_id = ANY($2) AND l.is_required = true`,
      [userId, courseIds],
    );
    return {
      completed: parseInt(rows[0]?.completed ?? 0, 10),
      pending: parseInt(rows[0]?.pending ?? 0, 10),
    };
  },

  /** Snapshot of all progress for a student — used by dashboard PRG-05 widget. */
  async dashboardSnapshot(userId) {
    const { rows } = await pool.query(
      `SELECT cp.course_id, c.title, cp.completion_pct, cp.current_grade, cp.status
         FROM course_progress cp
         JOIN courses c ON c.id = cp.course_id
        WHERE cp.user_id = $1
        ORDER BY cp.updated_at DESC`,
      [userId],
    );
    return rows;
  },
};

module.exports = ProgressModel;
