'use strict';

/**
 * Role & Permission model — RBAC v2 query helpers.
 * SRS §12 Permission Matrix v2; §4.3 AUTH-04 role-based access.
 * Supports both legacy (institution_id) and v2 (context_type/context_id) columns.
 */

const { pool } = require('../../config/database');

const RoleModel = {
  async listRoles() {
    const { rows } = await pool.query(
      `SELECT id, name, label, description, is_system, created_at
         FROM roles
        WHERE name NOT LIKE '[DEPRECATED]%'
          AND label NOT LIKE '[DEPRECATED]%'
        ORDER BY
          CASE name
            WHEN 'super_admin'        THEN 1
            WHEN 'institution_admin'  THEN 2
            WHEN 'dept_manager'       THEN 3
            WHEN 'instructor'         THEN 4
            WHEN 'teaching_assistant' THEN 5
            WHEN 'student'            THEN 6
            WHEN 'guest'              THEN 7
            ELSE 99
          END`,
    );
    return rows;
  },

  async findRoleByName(name) {
    const { rows } = await pool.query(
      `SELECT * FROM roles WHERE name = $1`, [name],
    );
    return rows[0] ?? null;
  },

  /**
   * Returns all permission codes held by a user in an institution context.
   * Supports both old institution_id column and new context columns.
   */
  async getUserPermissions(userId, institutionId) {
    const { rows } = await pool.query(
      `SELECT DISTINCT p.code
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1
          AND r.label NOT LIKE '[DEPRECATED]%'
          AND (
            ur.institution_id = $2
            OR ur.institution_id IS NULL
            OR ur.context_type = 'platform'
          )`,
      [userId, institutionId],
    );
    return rows.map((r) => r.code);
  },

  /**
   * Returns all roles assigned to a user with their permission codes.
   * Filters out deprecated roles (content_creator, simulation_developer).
   */
  async getUserRolesWithPermissions(userId, institutionId) {
    const { rows } = await pool.query(
      `SELECT r.id, r.name, r.label,
              ARRAY_REMOVE(ARRAY_AGG(DISTINCT p.code), NULL) AS permissions
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = $1
          AND r.label NOT LIKE '[DEPRECATED]%'
          AND (
            ur.institution_id = $2
            OR ur.institution_id IS NULL
            OR ur.context_type = 'platform'
          )
        GROUP BY r.id, r.name, r.label`,
      [userId, institutionId],
    );
    return rows;
  },

  /** Check if user has a specific permission code in the given institution. */
  async hasPermission(userId, institutionId, permissionCode) {
    const { rows } = await pool.query(
      `SELECT 1 FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1
          AND r.label NOT LIKE '[DEPRECATED]%'
          AND (
            ur.institution_id = $2
            OR ur.institution_id IS NULL
            OR ur.context_type = 'platform'
          )
          AND p.code = $3
        LIMIT 1`,
      [userId, institutionId, permissionCode],
    );
    return rows.length > 0;
  },

  /**
   * Assign a role to a user in the given institution context.
   * Optionally record context_type and context_id for scoped roles.
   */
  async assignRole(userId, roleName, institutionId, assignedBy = null, contextType = 'institution', contextId = null) {
    const effectiveContextId = contextId ?? institutionId;
    const { rows } = await pool.query(
      `INSERT INTO user_roles (user_id, role_id, institution_id, assigned_by, context_type, context_id)
       SELECT $1, id, $3, $4, $5, $6 FROM roles WHERE name = $2
       ON CONFLICT (user_id, role_id, institution_id) DO UPDATE
         SET context_type = EXCLUDED.context_type,
             context_id   = EXCLUDED.context_id,
             assigned_by  = EXCLUDED.assigned_by
       RETURNING *`,
      [userId, roleName, institutionId, assignedBy, contextType, effectiveContextId],
    );
    return rows[0] ?? null;
  },

  async revokeRole(userId, roleName, institutionId) {
    const { rows } = await pool.query(
      `DELETE FROM user_roles
        WHERE user_id = $1
          AND institution_id = $3
          AND role_id = (SELECT id FROM roles WHERE name = $2)
        RETURNING user_id`,
      [userId, roleName, institutionId],
    );
    return rows[0] ?? null;
  },

  async listPermissions() {
    const { rows } = await pool.query(
      `SELECT id, code, resource, action, description FROM permissions ORDER BY resource, action`,
    );
    return rows;
  },

  async getRolePermissions(roleName) {
    const { rows } = await pool.query(
      `SELECT p.code, p.resource, p.action, p.description
         FROM permissions p
         JOIN role_permissions rp ON rp.permission_id = p.id
         JOIN roles r ON r.id = rp.role_id
        WHERE r.name = $1
        ORDER BY p.resource, p.action`,
      [roleName],
    );
    return rows;
  },

  /** Returns the department IDs assigned to a dept_manager. */
  async getUserDepartments(userId) {
    const { rows } = await pool.query(
      `SELECT department_id FROM user_departments WHERE user_id = $1`,
      [userId],
    );
    return rows.map((r) => r.department_id);
  },

  /** Assign a department to a user (dept_manager context). */
  async assignDepartment(userId, departmentId, assignedBy = null) {
    const { rows } = await pool.query(
      `INSERT INTO user_departments (user_id, department_id, assigned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [userId, departmentId, assignedBy],
    );
    return rows[0] ?? null;
  },

  async revokeDepartment(userId, departmentId) {
    const { rows } = await pool.query(
      `DELETE FROM user_departments WHERE user_id = $1 AND department_id = $2 RETURNING *`,
      [userId, departmentId],
    );
    return rows[0] ?? null;
  },

  /** Returns course IDs where the user is assigned as a teaching assistant. */
  async getTACourses(userId) {
    const { rows } = await pool.query(
      `SELECT course_id FROM course_teaching_assistants WHERE user_id = $1`,
      [userId],
    );
    return rows.map((r) => r.course_id);
  },

  /** Assign a TA to a course. */
  async assignTA(courseId, userId, assignedBy = null) {
    const { rows } = await pool.query(
      `INSERT INTO course_teaching_assistants (course_id, user_id, assigned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [courseId, userId, assignedBy],
    );
    return rows[0] ?? null;
  },

  async revokeTA(courseId, userId) {
    const { rows } = await pool.query(
      `DELETE FROM course_teaching_assistants WHERE course_id = $1 AND user_id = $2 RETURNING *`,
      [courseId, userId],
    );
    return rows[0] ?? null;
  },
};

module.exports = RoleModel;
