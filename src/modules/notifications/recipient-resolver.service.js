'use strict';

/**
 * RecipientResolverService — resolves recipient user-ID arrays for automatic
 * notification triggers. Built on the same enrollments/course_teaching_assistants/
 * user_departments queries already used by scopeGuards.js and courses.service.js.
 */

const { pool } = require('../../config/database');

async function courseStudents(courseId) {
  const { rows } = await pool.query(
    `SELECT user_id FROM enrollments WHERE course_id = $1 AND role = 'student' AND status = 'active'`,
    [courseId],
  );
  return rows.map((r) => r.user_id);
}

async function courseStaff(courseId) {
  const { rows } = await pool.query(
    `SELECT instructor_id AS user_id FROM courses WHERE id = $1 AND instructor_id IS NOT NULL
     UNION
     SELECT user_id FROM course_teaching_assistants WHERE course_id = $1`,
    [courseId],
  );
  return rows.map((r) => r.user_id);
}

async function courseParticipants(courseId) {
  const [students, staff] = await Promise.all([courseStudents(courseId), courseStaff(courseId)]);
  return [...new Set([...students, ...staff])];
}

async function departmentUsers(departmentId, roleFilter) {
  const params = [departmentId];
  const roleClause = roleFilter ? `AND ur.role_id IN (SELECT id FROM roles WHERE name = $${params.push(roleFilter)})` : '';
  const { rows } = await pool.query(
    `SELECT DISTINCT ud.user_id
       FROM user_departments ud
       ${roleFilter ? 'JOIN user_roles ur ON ur.user_id = ud.user_id' : ''}
      WHERE ud.department_id = $1 ${roleClause}`,
    params,
  );
  return rows.map((r) => r.user_id);
}

async function institutionUsers(institutionId, roleFilter) {
  const params = [institutionId];
  const roleClause = roleFilter ? `AND ur.role_id IN (SELECT id FROM roles WHERE name = $${params.push(roleFilter)})` : '';
  const { rows } = await pool.query(
    `SELECT DISTINCT u.id AS user_id
       FROM users u
       ${roleFilter ? 'JOIN user_roles ur ON ur.user_id = u.id' : ''}
      WHERE u.institution_id = $1 AND u.deleted_at IS NULL ${roleClause}`,
    params,
  );
  return rows.map((r) => r.user_id);
}

module.exports = { courseStudents, courseStaff, courseParticipants, departmentUsers, institutionUsers };
