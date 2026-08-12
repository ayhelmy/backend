/**
 * Grade model — gradebook query helpers.
 * SRS §4.8 GRD-01 – GRD-07; §9 grade_items + grades schema.
 * is_override + override_note support manual grade adjustments (GRD-05).
 */
'use strict';

const { pool } = require('../../config/database');

const GradeModel = {
  // ------------------------------------------------------------------
  // Grade items (gradebook column definitions per course)
  // ------------------------------------------------------------------

  async findGradeItemById(id) {
    const { rows } = await pool.query(
      `SELECT id, course_id, title, item_type, lesson_id, simulation_id, quiz_id, category_id,
              max_points, weight, due_date, created_at
         FROM grade_items WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async listGradeItems(courseId) {
    const { rows } = await pool.query(
      `SELECT id, course_id, title, item_type, lesson_id, simulation_id, quiz_id, category_id,
              max_points, weight, due_date, created_at
         FROM grade_items WHERE course_id = $1 ORDER BY created_at`,
      [courseId],
    );
    return rows;
  },

  async createGradeItem({
    courseId, title, itemType, lessonId, simulationId, quizId, categoryId, maxPoints, weight, dueDate,
  }) {
    const { rows } = await pool.query(
      `INSERT INTO grade_items
         (course_id, title, item_type, lesson_id, simulation_id, quiz_id, category_id,
          max_points, weight, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [courseId, title, itemType ?? 'simulation', lessonId ?? null,
       simulationId ?? null, quizId ?? null, categoryId ?? null,
       maxPoints ?? 100, weight ?? 1, dueDate ?? null],
    );
    return rows[0];
  },

  // ------------------------------------------------------------------
  // Individual grades
  // ------------------------------------------------------------------

  async findGrade(gradeItemId, userId) {
    const { rows } = await pool.query(
      `SELECT * FROM grades WHERE grade_item_id = $1 AND user_id = $2`,
      [gradeItemId, userId],
    );
    return rows[0] ?? null;
  },

  async upsertGrade({
    gradeItemId, userId, score, pointsPossible, isOverride, overrideNote, gradedBy,
    quizAttemptId, simulationScoreId,
  }) {
    const { rows } = await pool.query(
      `INSERT INTO grades
         (grade_item_id, user_id, score, points_possible, is_override, override_note, graded_by,
          quiz_attempt_id, simulation_score_id, graded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (grade_item_id, user_id) DO UPDATE
         SET score               = EXCLUDED.score,
             points_possible     = EXCLUDED.points_possible,
             is_override         = EXCLUDED.is_override,
             override_note       = EXCLUDED.override_note,
             graded_by           = EXCLUDED.graded_by,
             -- Preserve existing source-tracing link when the caller doesn't pass one
             -- (e.g. a plain manual override shouldn't wipe out which quiz attempt or
             -- simulation score originally produced this grade).
             quiz_attempt_id     = COALESCE(EXCLUDED.quiz_attempt_id, grades.quiz_attempt_id),
             simulation_score_id = COALESCE(EXCLUDED.simulation_score_id, grades.simulation_score_id),
             graded_at           = NOW(),
             updated_at          = NOW()
       RETURNING *`,
      [gradeItemId, userId, score, pointsPossible ?? null,
       isOverride ?? false, overrideNote ?? null, gradedBy ?? null,
       quizAttemptId ?? null, simulationScoreId ?? null],
    );
    return rows[0];
  },

  /** Full gradebook grid: items × students, one row per (item, student). */
  async gradebookGrid(courseId) {
    const { rows } = await pool.query(
      `SELECT
           gi.id AS grade_item_id, gi.title AS item_title, gi.item_type,
           gi.quiz_id, gi.simulation_id,
           gi.max_points, gi.weight, gi.due_date,
           u.id AS user_id, u.first_name, u.last_name, u.email,
           g.id AS grade_id, g.score, g.points_possible, g.is_override, g.graded_at,
           g.quiz_attempt_id, g.simulation_score_id
         FROM grade_items gi
         CROSS JOIN (
           SELECT u.* FROM users u
           JOIN enrollments e ON e.user_id = u.id
           WHERE e.course_id = $1 AND e.role = 'student' AND e.status = 'active'
         ) u
         LEFT JOIN grades g ON g.grade_item_id = gi.id AND g.user_id = u.id
        WHERE gi.course_id = $1
        ORDER BY u.last_name, u.first_name, gi.created_at`,
      [courseId],
    );
    return rows;
  },

  /** Most recently posted/updated grades, scoped by course — feeds the recent-activity merge. */
  async listRecentlyGraded({ courseId, courseIds, studentId, limit = 10 } = {}) {
    const params = [];
    const filters = ['g.graded_at IS NOT NULL'];
    if (courseId)  filters.push(`gi.course_id = $${params.push(courseId)}`);
    if (courseIds?.length) filters.push(`gi.course_id = ANY($${params.push(courseIds)})`);
    if (studentId) filters.push(`g.user_id = $${params.push(studentId)}`);
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT g.id, g.user_id, g.score, g.points_possible, g.graded_at,
              gi.id AS grade_item_id, gi.title AS item_title, gi.course_id,
              u.first_name, u.last_name
         FROM grades g
         JOIN grade_items gi ON gi.id = g.grade_item_id
         JOIN users u ON u.id = g.user_id
        WHERE ${filters.join(' AND ')}
        ORDER BY g.graded_at DESC LIMIT $${params.length}`,
      params,
    );
    return rows;
  },

  /**
   * Class-wide grade summary for a course: average %, count of students still
   * missing every grade, and a coarse distribution — used by instructor/TA/
   * department dashboards ("gradebook summary" / "class average" KPIs).
   */
  async courseGradeSummary(courseId) {
    const { rows } = await pool.query(
      `WITH student_grades AS (
         SELECT u.id AS user_id,
                SUM(g.score * gi.weight) / NULLIF(SUM(gi.max_points * gi.weight), 0) * 100 AS pct
           FROM users u
           JOIN enrollments e ON e.user_id = u.id AND e.course_id = $1
                              AND e.role = 'student' AND e.status = 'active'
           LEFT JOIN grade_items gi ON gi.course_id = $1
           LEFT JOIN grades g ON g.grade_item_id = gi.id AND g.user_id = u.id
          GROUP BY u.id
       )
       SELECT
         COUNT(*)      AS total_students,
         COUNT(pct)    AS graded_students,
         AVG(pct)      AS avg_pct,
         COUNT(*) FILTER (WHERE pct >= 90)               AS band_a,
         COUNT(*) FILTER (WHERE pct >= 80 AND pct < 90)   AS band_b,
         COUNT(*) FILTER (WHERE pct >= 70 AND pct < 80)   AS band_c,
         COUNT(*) FILTER (WHERE pct < 70 AND pct IS NOT NULL) AS band_d
       FROM student_grades`,
      [courseId],
    );
    const r = rows[0] ?? {};
    return {
      totalStudents: parseInt(r.total_students ?? 0, 10),
      gradedStudents: parseInt(r.graded_students ?? 0, 10),
      missingGrades: parseInt(r.total_students ?? 0, 10) - parseInt(r.graded_students ?? 0, 10),
      avgPercentage: r.avg_pct !== null ? Number(r.avg_pct) : null,
      distribution: {
        a: parseInt(r.band_a ?? 0, 10),
        b: parseInt(r.band_b ?? 0, 10),
        c: parseInt(r.band_c ?? 0, 10),
        d: parseInt(r.band_d ?? 0, 10),
      },
    };
  },

  /** Weighted average grade for a student in a course. */
  async weightedCourseGrade(courseId, userId) {
    const { rows } = await pool.query(
      `SELECT
           SUM(g.score * gi.weight) / NULLIF(SUM(gi.max_points * gi.weight), 0) * 100 AS weighted_pct
         FROM grades g
         JOIN grade_items gi ON gi.id = g.grade_item_id
        WHERE gi.course_id = $1 AND g.user_id = $2`,
      [courseId, userId],
    );
    return rows[0]?.weighted_pct ?? null;
  },
};

module.exports = GradeModel;
