'use strict';

const { pool } = require('../../config/database');

const COLS = `
  ay.id, ay.institution_id, ay.department_id,
  ay.name, ay.code, ay.year_order, ay.status,
  ay.start_date, ay.end_date,
  ay.created_by, ay.created_at, ay.updated_at
`;

const AcademicYearModel = {
  async findById(id) {
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM academic_years ay
        WHERE ay.id = $1 AND ay.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  },

  async listByDepartment(departmentId, { status } = {}) {
    const params  = [departmentId];
    const filters = ['ay.department_id = $1', 'ay.deleted_at IS NULL'];
    if (status) filters.push(`ay.status = $${params.push(status)}`);
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM academic_years ay
        WHERE ${filters.join(' AND ')}
        ORDER BY ay.year_order ASC, ay.created_at ASC`,
      params,
    );
    return rows;
  },

  async create({ institutionId, departmentId, name, code, yearOrder, status, startDate, endDate, createdBy }) {
    const { rows } = await pool.query(
      `INSERT INTO academic_years
         (institution_id, department_id, name, code, year_order, status,
          start_date, end_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING ${COLS.replace(/ay\./g, '')}`,
      [institutionId, departmentId, name, code ?? null,
       yearOrder ?? 1, status ?? 'active',
       startDate ?? null, endDate ?? null, createdBy ?? null],
    );
    return rows[0];
  },

  async update(id, fields) {
    const allowed = ['name','code','year_order','status','start_date','end_date'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const val   = fields[key] ?? fields[camel];
      if (val !== undefined) {
        params.push(val);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (!sets.length) return this.findById(id);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE academic_years SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} AND deleted_at IS NULL
        RETURNING ${COLS.replace(/ay\./g, '')}`,
      params,
    );
    return rows[0] ?? null;
  },

  async softDelete(id) {
    const { rows } = await pool.query(
      `UPDATE academic_years SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [id],
    );
    return rows[0] ?? null;
  },

  async belongsToInstitution(id, institutionId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM academic_years WHERE id = $1 AND institution_id = $2 AND deleted_at IS NULL`,
      [id, institutionId],
    );
    return rows.length > 0;
  },
};

module.exports = AcademicYearModel;
