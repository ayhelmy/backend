/**
 * Domain model — learning subject areas (Physics, Biology, etc.).
 * SRS §4.4 INST-04: Admins define learning domains to group courses + simulations.
 */
'use strict';

const { pool } = require('../../config/database');

const DomainModel = {
  async findById(id) {
    const { rows } = await pool.query(
      `SELECT id, institution_id, name, description, icon_url, color, created_at, updated_at
         FROM domains WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async list({ institutionId } = {}) {
    const params = [];
    const filter = institutionId
      ? `WHERE (institution_id = $${params.push(institutionId)} OR institution_id IS NULL)`
      : 'WHERE institution_id IS NULL';
    const { rows } = await pool.query(
      `SELECT id, institution_id, name, description, icon_url, color, created_at
         FROM domains ${filter} ORDER BY name`,
      params,
    );
    return rows;
  },

  async create({ institutionId, name, description, iconUrl, color }) {
    const { rows } = await pool.query(
      `INSERT INTO domains (institution_id, name, description, icon_url, color)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [institutionId ?? null, name, description ?? null, iconUrl ?? null, color ?? '#6366F1'],
    );
    return rows[0];
  },

  async update(id, fields) {
    const allowed = ['name','description','icon_url','color'];
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
      `UPDATE domains SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  },

  async delete(id) {
    const { rows } = await pool.query(
      `DELETE FROM domains WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows[0] ?? null;
  },
};

module.exports = DomainModel;
