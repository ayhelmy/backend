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
      `SELECT id, course_id, title, item_type, lesson_id, simulation_id,
              max_points, weight, due_date, created_at
         FROM grade_items WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async listGradeItems(courseId) {
    const { rows } = await pool.query(
      `SELECT id, course_id, title, item_type, lesson_id, simulation_id,
              max_points, weight, due_date, created_at
         FROM grade_items WHERE course_id = $1 ORDER BY created_at`,
      [courseId],
    );
    return rows;
  },

  async createGradeItem({ courseId, title, itemType, lessonId, simulationId, maxPoints, weight, dueDate }) {
    const { rows } = await pool.query(
      `INSERT INTO grade_items
         (course_id, title, item_type, lesson_id, simulation_id, max_points, weight, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [courseId, title, itemType ?? 'simulation', lessonId ?? null,
       simulationId ?? null, maxPoints ?? 100, weight ?? 1, dueDate ?? null],
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

  async upsertGrade({ gradeItemId, userId, score, pointsPossible, isOverride, overrideNote, gradedBy }) {
    const { rows } = await pool.query(
      `INSERT INTO grades
         (grade_item_id, user_id, score, points_possible, is_override, override_note, graded_by, graded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (grade_item_id, user_id) DO UPDATE
         SET score           = EXCLUDED.score,
             points_possible = EXCLUDED.points_possible,
             is_override     = EXCLUDED.is_override,
             override_note   = EXCLUDED.override_note,
             graded_by       = EXCLUDED.graded_by,
             graded_at       = NOW(),
             updated_at      = NOW()
       RETURNING *`,
      [gradeItemId, userId, score, pointsPossible ?? null,
       isOverride ?? false, overrideNote ?? null, gradedBy ?? null],
    );
    return rows[0];
  },

  /** Full gradebook grid: items × students, one row per (item, student). */
  async gradebookGrid(courseId) {
    const { rows } = await pool.query(
      `SELECT
           gi.id AS grade_item_id, gi.title AS item_title, gi.item_type,
           gi.max_points, gi.weight, gi.due_date,
           u.id AS user_id, u.first_name, u.last_name, u.email,
           g.score, g.points_possible, g.is_override, g.graded_at
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
