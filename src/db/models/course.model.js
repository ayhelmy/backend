/**
 * Course model — query helpers for courses and enrollments.
 * SRS §4.5 CRS-01 – CRS-10; §9 courses + enrollments schema.
 */
'use strict';

const { pool } = require('../../config/database');

const COURSE_COLS = `
  c.id, c.institution_id, c.department_id,
  c.academic_year_id, c.semester_term_id,
  c.term_id, c.domain_id,
  c.instructor_id, c.code, c.title, c.description, c.thumbnail_url,
  c.status, c.enrollment_type, c.enrollment_cap, c.start_date, c.end_date,
  c.passing_grade, c.settings, c.published_at, c.created_by,
  c.created_at, c.updated_at
`;

const COURSE_JOIN_COLS = `
  d.name  AS department_name,  d.code AS department_code,
  ay.name AS academic_year_name,
  st.name AS semester_term_name
`;

const COURSE_JOINS = `
  LEFT JOIN departments    d  ON d.id  = c.department_id    AND d.deleted_at  IS NULL
  LEFT JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.deleted_at IS NULL
  LEFT JOIN semester_terms st ON st.id = c.semester_term_id AND st.deleted_at IS NULL
`;

const CourseModel = {
  async findById(id) {
    const { rows } = await pool.query(
      `SELECT ${COURSE_COLS}, ${COURSE_JOIN_COLS}
       FROM courses c ${COURSE_JOINS}
       WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  },

  async list({ institutionId, departmentId, academicYearId, semesterTermId, status, instructorId, domainId, search, limit = 20, offset = 0 } = {}) {
    const params = [limit, offset];
    const filters = ['c.deleted_at IS NULL'];

    // null institutionId means super-admin platform-wide view — skip institution filter
    if (institutionId) {
      params.push(institutionId);
      filters.push(`c.institution_id = $${params.length}`);
    }

    if (departmentId)   filters.push(`c.department_id = $${params.push(departmentId)}`);
    if (academicYearId) filters.push(`c.academic_year_id = $${params.push(academicYearId)}`);
    if (semesterTermId) filters.push(`c.semester_term_id = $${params.push(semesterTermId)}`);
    if (status)         filters.push(`c.status = $${params.push(status)}`);
    if (instructorId)   filters.push(`c.instructor_id = $${params.push(instructorId)}`);
    if (domainId)       filters.push(`c.domain_id = $${params.push(domainId)}`);
    if (search) {
      const idx = params.push(`%${search}%`);
      filters.push(`(c.title ILIKE $${idx} OR c.description ILIKE $${idx})`);
    }
    const { rows } = await pool.query(
      `SELECT ${COURSE_COLS}, ${COURSE_JOIN_COLS}
       FROM courses c ${COURSE_JOINS}
       WHERE ${filters.join(' AND ')}
       ORDER BY c.created_at DESC LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },

  async create(data) {
    const {
      institutionId, departmentId, academicYearId, semesterTermId,
      termId, domainId, instructorId,
      code, title, description, thumbnailUrl, enrollmentType,
      enrollmentCap, startDate, endDate, passingGrade, settings, createdBy,
    } = data;
    const { rows } = await pool.query(
      `INSERT INTO courses
         (institution_id, department_id, academic_year_id, semester_term_id,
          term_id, domain_id, instructor_id,
          code, title, description, thumbnail_url, enrollment_type,
          enrollment_cap, start_date, end_date, passing_grade, settings, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING ${COURSE_COLS.replace(/c\./g, '')}`,
      [institutionId, departmentId ?? null, academicYearId ?? null, semesterTermId ?? null,
       termId ?? null, domainId ?? null,
       instructorId, code ?? null, title, description ?? null, thumbnailUrl ?? null,
       enrollmentType ?? 'open', enrollmentCap ?? null, startDate ?? null,
       endDate ?? null, passingGrade ?? 60, settings ?? {}, createdBy],
    );
    return rows[0];
  },

  async update(id, fields) {
    const allowed = [
      'title','description','thumbnail_url','status','enrollment_type',
      'enrollment_cap','start_date','end_date','passing_grade','settings',
      'domain_id','instructor_id','department_id',
      'academic_year_id','semester_term_id',
      'term_id','published_at',
    ];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        params.push(key === 'settings' ? JSON.stringify(fields[key]) : fields[key]);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (sets.length === 0) return this.findById(id);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE courses SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} AND deleted_at IS NULL
        RETURNING id, title, status, updated_at`,
      params,
    );
    return rows[0] ?? null;
  },

  async softDelete(id) {
    const { rows } = await pool.query(
      `UPDATE courses SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [id],
    );
    return rows[0] ?? null;
  },

  // ------------------------------------------------------------------
  // Enrollments
  // ------------------------------------------------------------------

  async findEnrollment(courseId, userId) {
    const { rows } = await pool.query(
      `SELECT * FROM enrollments WHERE course_id = $1 AND user_id = $2`,
      [courseId, userId],
    );
    return rows[0] ?? null;
  },

  async enroll({ courseId, userId, role = 'student', status = 'active' }) {
    const { rows } = await pool.query(
      `INSERT INTO enrollments (course_id, user_id, role, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (course_id, user_id) DO UPDATE
         SET status = EXCLUDED.status, role = EXCLUDED.role
       RETURNING *`,
      [courseId, userId, role, status],
    );
    return rows[0];
  },

  async updateEnrollment(courseId, userId, fields) {
    const allowed = ['status','role','final_grade','completed_at'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        params.push(fields[key]);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (sets.length === 0) return this.findEnrollment(courseId, userId);
    params.push(courseId, userId);
    const { rows } = await pool.query(
      `UPDATE enrollments SET ${sets.join(', ')}
        WHERE course_id = $${params.length - 1} AND user_id = $${params.length}
        RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  },

  async listEnrollments(courseId, { role, status, limit = 50, offset = 0 } = {}) {
    const params = [courseId, limit, offset];
    const filters = ['e.course_id = $1'];
    if (role)   filters.push(`e.role = $${params.push(role)}`);
    if (status) filters.push(`e.status = $${params.push(status)}`);
    const { rows } = await pool.query(
      `SELECT e.*, u.first_name, u.last_name, u.email, u.avatar_url
         FROM enrollments e
         JOIN users u ON u.id = e.user_id
        WHERE ${filters.join(' AND ')}
        ORDER BY u.last_name, u.first_name
        LIMIT $2 OFFSET $3`,
      params,
    );
    return rows;
  },

  /** Current enrollment count — for cap enforcement (CRS-04). */
  async enrollmentCount(courseId) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM enrollments
        WHERE course_id = $1 AND status = 'active' AND role = 'student'`,
      [courseId],
    );
    return parseInt(rows[0].total, 10);
  },
};

module.exports = CourseModel;
