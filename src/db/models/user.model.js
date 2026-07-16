/**
 * User model — query helpers wrapping the users table.
 * SRS §4.2 USR-01 – USR-07; §9 users schema.
 * All reads exclude soft-deleted rows (deleted_at IS NULL).
 */
'use strict';

const { pool } = require('../../config/database');

// Columns safe to return to callers (never include password_hash)
const PUBLIC_COLUMNS = `
  id, email, first_name, last_name, avatar_url, bio,
  status, institution_id, last_login_at, created_at, updated_at
`;

const UserModel = {
  /** Find a single user by primary key. Returns null if not found or soft-deleted. */
  async findById(id) {
    const { rows } = await pool.query(
      `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  },

  /** Find by email — includes password_hash for auth comparisons. */
  async findByEmailWithHash(email) {
    const { rows } = await pool.query(
      `SELECT id, email, password_hash, first_name, last_name, status, institution_id
         FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [email],
    );
    return rows[0] ?? null;
  },

  /** Paginated list scoped to an institution. */
  async findByInstitution(institutionId, { limit = 20, offset = 0, status } = {}) {
    const params = [institutionId, limit, offset];
    const statusClause = status ? `AND status = $${params.push(status)}` : '';
    const { rows } = await pool.query(
      `SELECT ${PUBLIC_COLUMNS}
         FROM users
        WHERE institution_id = $1 AND deleted_at IS NULL ${statusClause}
        ORDER BY last_name, first_name
        LIMIT $2 OFFSET $3`,
      params,
    );
    return rows;
  },

  /** Create a new user. Returns the public columns. */
  async create({ email, passwordHash, firstName, lastName, institutionId, status = 'pending' }) {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, institution_id, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${PUBLIC_COLUMNS}`,
      [email, passwordHash, firstName, lastName, institutionId, status],
    );
    return rows[0];
  },

  /** Partial update — only patches fields that are provided. */
  async update(id, fields) {
    const allowed = ['first_name','last_name','avatar_url','bio','status','institution_id'];
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
      `UPDATE users SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} AND deleted_at IS NULL
        RETURNING ${PUBLIC_COLUMNS}`,
      params,
    );
    return rows[0] ?? null;
  },

  /** Stamp last_login_at. Called on successful token issue. */
  async touchLogin(id) {
    await pool.query(
      `UPDATE users SET last_login_at = NOW() WHERE id = $1`,
      [id],
    );
  },

  /** Soft-delete. Anonymises PII in the same statement (GDPR USR-03). */
  async softDelete(id) {
    const { rows } = await pool.query(
      `UPDATE users
          SET deleted_at = NOW(),
              email        = 'deleted_' || id || '@removed',
              first_name   = 'Deleted',
              last_name    = 'User',
              avatar_url   = NULL,
              bio          = NULL,
              password_hash = NULL,
              updated_at   = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id`,
      [id],
    );
    return rows[0] ?? null;
  },

  /**
   * Fetch a user with their roles, managed departments, and course assignments.
   * Used by getOne to build the full RBAC v2 response.
   */
  async findWithRoles(id) {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.avatar_url, u.bio,
              u.status, u.institution_id, u.last_login_at, u.created_at, u.updated_at,
              COALESCE((
                SELECT JSON_AGG(JSON_BUILD_OBJECT('id', r.id, 'name', r.name, 'label', r.label))
                  FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                 WHERE ur.user_id = u.id AND r.label NOT LIKE '[DEPRECATED]%'
              ), '[]'::json) AS roles,
              COALESCE((
                SELECT JSON_AGG(ud.department_id)
                  FROM user_departments ud WHERE ud.user_id = u.id
              ), '[]'::json) AS managed_departments,
              COALESCE((
                SELECT JSON_AGG(e.course_id)
                  FROM enrollments e
                 WHERE e.user_id = u.id AND e.status = 'active'
              ), '[]'::json) AS enrolled_course_ids,
              COALESCE((
                SELECT JSON_AGG(cta.course_id)
                  FROM course_teaching_assistants cta WHERE cta.user_id = u.id
              ), '[]'::json) AS ta_course_ids
         FROM users u
        WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  },

  /** Count active users in an institution (for subscription cap checks). */
  async countByInstitution(institutionId) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM users
        WHERE institution_id = $1 AND status = 'active' AND deleted_at IS NULL`,
      [institutionId],
    );
    return parseInt(rows[0].total, 10);
  },
};

module.exports = UserModel;
