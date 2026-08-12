/**
 * Grade category model — weighted gradebook grouping. Migration 048.
 * Weight-sum-to-100% validation lives in grade-categories.service.js
 * (validateWeights), using sumWeights() below.
 */
'use strict';

const { pool } = require('../../config/database');

const CATEGORY_COLS = `
  id, course_id, name, weight, item_type_filter, position, created_at, updated_at
`;

const GradeCategoryModel = {
  async findById(id) {
    const { rows } = await pool.query(
      `SELECT ${CATEGORY_COLS} FROM grade_categories WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async listByCourse(courseId) {
    const { rows } = await pool.query(
      `SELECT ${CATEGORY_COLS} FROM grade_categories WHERE course_id = $1 ORDER BY position, created_at`,
      [courseId],
    );
    return rows;
  },

  async create({ courseId, name, weight, itemTypeFilter, position }) {
    const { rows } = await pool.query(
      `INSERT INTO grade_categories (course_id, name, weight, item_type_filter, position)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING ${CATEGORY_COLS}`,
      [courseId, name, weight ?? 0, itemTypeFilter ?? null, position ?? 0],
    );
    return rows[0];
  },

  async update(id, fields) {
    const allowed = ['name', 'weight', 'item_type_filter', 'position'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        params.push(fields[key]);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (sets.length === 0) return this.findById(id);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE grade_categories SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} RETURNING ${CATEGORY_COLS}`,
      params,
    );
    return rows[0] ?? null;
  },

  async delete(id) {
    const { rows } = await pool.query(
      `DELETE FROM grade_categories WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows[0] ?? null;
  },

  /** Sum of weights across a course's categories (optionally excluding one, for pre-save validation). */
  async sumWeights(courseId, excludeId = null) {
    const params = [courseId];
    let where = 'course_id = $1';
    if (excludeId) { params.push(excludeId); where += ` AND id != $${params.length}`; }
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(weight), 0) AS total FROM grade_categories WHERE ${where}`,
      params,
    );
    return Number(rows[0].total);
  },
};

module.exports = GradeCategoryModel;
