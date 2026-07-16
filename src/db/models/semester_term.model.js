'use strict';

const { pool } = require('../../config/database');

const COLS = `
  st.id, st.institution_id, st.department_id, st.academic_year_id,
  st.name, st.code, st.term_order, st.status,
  st.start_date, st.end_date,
  st.created_by, st.created_at, st.updated_at
`;

const SemesterTermModel = {
  async findById(id) {
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM semester_terms st
        WHERE st.id = $1 AND st.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  },

  async listByAcademicYear(academicYearId, { status } = {}) {
    const params  = [academicYearId];
    const filters = ['st.academic_year_id = $1', 'st.deleted_at IS NULL'];
    if (status) filters.push(`st.status = $${params.push(status)}`);
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM semester_terms st
        WHERE ${filters.join(' AND ')}
        ORDER BY st.term_order ASC, st.created_at ASC`,
      params,
    );
    return rows;
  },

  async listByDepartment(departmentId) {
    const { rows } = await pool.query(
      `SELECT ${COLS},
              ay.name AS academic_year_name, ay.code AS academic_year_code
         FROM semester_terms st
         JOIN academic_years ay ON ay.id = st.academic_year_id AND ay.deleted_at IS NULL
        WHERE st.department_id = $1 AND st.deleted_at IS NULL
        ORDER BY ay.year_order ASC, st.term_order ASC`,
      [departmentId],
    );
    return rows;
  },

  async create({ institutionId, departmentId, academicYearId, name, code, termOrder, status, startDate, endDate, createdBy }) {
    const { rows } = await pool.query(
      `INSERT INTO semester_terms
         (institution_id, department_id, academic_year_id, name, code,
          term_order, status, start_date, end_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING ${COLS.replace(/st\./g, '')}`,
      [institutionId, departmentId, academicYearId, name, code ?? null,
       termOrder ?? 1, status ?? 'active',
       startDate ?? null, endDate ?? null, createdBy ?? null],
    );
    return rows[0];
  },

  async update(id, fields) {
    const allowed = ['name','code','term_order','status','start_date','end_date'];
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
      `UPDATE semester_terms SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} AND deleted_at IS NULL
        RETURNING ${COLS.replace(/st\./g, '')}`,
      params,
    );
    return rows[0] ?? null;
  },

  async softDelete(id) {
    const { rows } = await pool.query(
      `UPDATE semester_terms SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [id],
    );
    return rows[0] ?? null;
  },

  async belongsToInstitution(id, institutionId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM semester_terms WHERE id = $1 AND institution_id = $2 AND deleted_at IS NULL`,
      [id, institutionId],
    );
    return rows.length > 0;
  },

  async belongsToAcademicYear(id, academicYearId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM semester_terms WHERE id = $1 AND academic_year_id = $2 AND deleted_at IS NULL`,
      [id, academicYearId],
    );
    return rows.length > 0;
  },
};

module.exports = SemesterTermModel;
