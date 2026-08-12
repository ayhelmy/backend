'use strict';

const { pool } = require('../../config/database');

const COLS = `
  uaa.id, uaa.user_id, uaa.institution_id,
  uaa.department_id, uaa.academic_year_id, uaa.semester_term_id,
  uaa.role_context, uaa.is_current,
  uaa.assigned_by, uaa.assigned_at, uaa.created_at, uaa.updated_at
`;

const DETAIL_COLS = `
  ${COLS},
  d.name   AS department_name,   d.code AS department_code,
  ay.name  AS academic_year_name, ay.code AS academic_year_code, ay.year_order,
  st.name  AS semester_term_name, st.code AS semester_term_code, st.term_order
`;

const UserAcademicAssignmentModel = {
  async findById(id) {
    const { rows } = await pool.query(
      `SELECT ${DETAIL_COLS}
         FROM user_academic_assignments uaa
         JOIN departments   d   ON d.id   = uaa.department_id
         JOIN academic_years ay ON ay.id  = uaa.academic_year_id
         JOIN semester_terms st ON st.id  = uaa.semester_term_id
        WHERE uaa.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async findCurrentForUser(userId, roleContext) {
    const params  = [userId, true];
    const filters = ['uaa.user_id = $1', 'uaa.is_current = $2'];
    if (roleContext) filters.push(`uaa.role_context = $${params.push(roleContext)}`);
    const { rows } = await pool.query(
      `SELECT ${DETAIL_COLS}
         FROM user_academic_assignments uaa
         JOIN departments   d   ON d.id   = uaa.department_id
         JOIN academic_years ay ON ay.id  = uaa.academic_year_id
         JOIN semester_terms st ON st.id  = uaa.semester_term_id
        WHERE ${filters.join(' AND ')}
        ORDER BY uaa.assigned_at DESC`,
      params,
    );
    return rows;
  },

  async listForUser(userId) {
    const { rows } = await pool.query(
      `SELECT ${DETAIL_COLS}
         FROM user_academic_assignments uaa
         JOIN departments   d   ON d.id   = uaa.department_id
         JOIN academic_years ay ON ay.id  = uaa.academic_year_id
         JOIN semester_terms st ON st.id  = uaa.semester_term_id
        WHERE uaa.user_id = $1
        ORDER BY uaa.is_current DESC, uaa.assigned_at DESC`,
      [userId],
    );
    return rows;
  },

  async create({ userId, institutionId, departmentId, academicYearId, semesterTermId, roleContext, assignedBy }) {
    const { rows } = await pool.query(
      `INSERT INTO user_academic_assignments
         (user_id, institution_id, department_id, academic_year_id, semester_term_id,
          role_context, is_current, assigned_by)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7)
       ON CONFLICT (user_id, department_id, academic_year_id, semester_term_id, role_context)
         DO UPDATE SET is_current = TRUE, assigned_by = $7, assigned_at = NOW(), updated_at = NOW()
       RETURNING ${COLS.replace(/uaa\./g, '')}`,
      [userId, institutionId, departmentId, academicYearId, semesterTermId, roleContext, assignedBy ?? null],
    );
    return rows[0];
  },

  // When assigning a student, clear any previous current assignment first
  async replaceStudentCurrentAssignment({ userId, institutionId, departmentId, academicYearId, semesterTermId, assignedBy }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Mark existing current student assignments as not current
      await client.query(
        `UPDATE user_academic_assignments
            SET is_current = FALSE, updated_at = NOW()
          WHERE user_id = $1 AND role_context = 'student' AND is_current = TRUE`,
        [userId],
      );

      // Insert or update the new assignment
      const { rows } = await client.query(
        `INSERT INTO user_academic_assignments
           (user_id, institution_id, department_id, academic_year_id, semester_term_id,
            role_context, is_current, assigned_by)
         VALUES ($1,$2,$3,$4,$5,'student',TRUE,$6)
         ON CONFLICT (user_id, department_id, academic_year_id, semester_term_id, role_context)
           DO UPDATE SET is_current = TRUE, assigned_by = $6, assigned_at = NOW(), updated_at = NOW()
         RETURNING ${COLS.replace(/uaa\./g, '')}`,
        [userId, institutionId, departmentId, academicYearId, semesterTermId, assignedBy ?? null],
      );

      await client.query('COMMIT');
      return rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async update(id, fields) {
    const allowed = ['is_current', 'role_context'];
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
      `UPDATE user_academic_assignments SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length}
        RETURNING ${COLS.replace(/uaa\./g, '')}`,
      params,
    );
    return rows[0] ?? null;
  },

  // Check if user is assigned to a specific semester term with given role
  async isAssignedToTerm(userId, semesterTermId, roleContext) {
    const params  = [userId, semesterTermId];
    const filters = ['user_id = $1', 'semester_term_id = $2'];
    if (roleContext) filters.push(`role_context = $${params.push(roleContext)}`);
    const { rows } = await pool.query(
      `SELECT 1 FROM user_academic_assignments WHERE ${filters.join(' AND ')} LIMIT 1`,
      params,
    );
    return rows.length > 0;
  },

  async getInstructorAssignments(userId) {
    const { rows } = await pool.query(
      `SELECT ${DETAIL_COLS}
         FROM user_academic_assignments uaa
         JOIN departments   d   ON d.id   = uaa.department_id
         JOIN academic_years ay ON ay.id  = uaa.academic_year_id
         JOIN semester_terms st ON st.id  = uaa.semester_term_id
        WHERE uaa.user_id = $1
          AND uaa.role_context = 'instructor'
          AND uaa.is_current = TRUE
        ORDER BY ay.year_order ASC, st.term_order ASC`,
      [userId],
    );
    return rows;
  },
};

module.exports = UserAcademicAssignmentModel;
