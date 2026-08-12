'use strict';

/**
 * Mail access rules — SRS "Messaging Scope Rules" §1 (unchanged by the
 * chat→mailbox refactor; this logic is schema-agnostic). Backend is the
 * source of truth: canMessage() is checked per-recipient on send/reply
 * regardless of what the frontend recipient selector already filtered.
 */

const { pool } = require('../../config/database');
const { ROLES } = require('../../constants/roles');

function roleNames(actor) {
  return (actor.roles ?? []).map((r) => (typeof r === 'string' ? r : r.name));
}

// ── canMessage — pairwise check, defense in depth even though the frontend
// recipient selector is already scoped by listMessageableUsers(). ───────────

async function canMessage(actor, targetUserId) {
  if (targetUserId === actor.id) return false;
  const roles = roleNames(actor);

  const { rows: [target] } = await pool.query(
    `SELECT id, institution_id FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [targetUserId],
  );
  if (!target) return false;

  if (roles.includes(ROLES.SUPER_ADMIN)) return true;

  // Everyone below this point is scoped to their own institution.
  if (target.institution_id !== actor.institutionId) return false;

  if (roles.includes(ROLES.INSTITUTION_ADMIN)) return true;

  if (roles.includes(ROLES.DEPT_MANAGER)) {
    const { rows } = await pool.query(
      `SELECT 1
         FROM user_departments ud
        WHERE ud.user_id = $1
          AND ud.department_id IN (SELECT department_id FROM user_departments WHERE user_id = $2)
        UNION
       SELECT 1
         FROM enrollments e JOIN courses c ON c.id = e.course_id
        WHERE e.user_id = $1 AND e.status = 'active'
          AND c.department_id IN (SELECT department_id FROM user_departments WHERE user_id = $2)
        UNION
       SELECT 1 FROM courses c
        WHERE c.instructor_id = $1
          AND c.department_id IN (SELECT department_id FROM user_departments WHERE user_id = $2)
       LIMIT 1`,
      [targetUserId, actor.id],
    );
    return rows.length > 0;
  }

  if (roles.includes(ROLES.INSTRUCTOR)) {
    const { rows } = await pool.query(
      `SELECT 1 FROM enrollments e JOIN courses c ON c.id = e.course_id
        WHERE c.instructor_id = $1 AND e.user_id = $2 AND e.status = 'active'
        UNION
       SELECT 1 FROM course_teaching_assistants cta JOIN courses c ON c.id = cta.course_id
        WHERE c.instructor_id = $1 AND cta.user_id = $2
       LIMIT 1`,
      [actor.id, targetUserId],
    );
    return rows.length > 0;
  }

  if (roles.includes(ROLES.TEACHING_ASSISTANT)) {
    const { rows } = await pool.query(
      `SELECT 1 FROM course_teaching_assistants mine JOIN courses c ON c.id = mine.course_id
        WHERE mine.user_id = $1 AND c.instructor_id = $2
        UNION
       SELECT 1 FROM course_teaching_assistants mine
        JOIN course_teaching_assistants other ON other.course_id = mine.course_id
        WHERE mine.user_id = $1 AND other.user_id = $2
        UNION
       SELECT 1 FROM course_teaching_assistants mine
        JOIN enrollments e ON e.course_id = mine.course_id
        WHERE mine.user_id = $1 AND e.user_id = $2 AND e.status = 'active'
       LIMIT 1`,
      [actor.id, targetUserId],
    );
    return rows.length > 0;
  }

  if (roles.includes(ROLES.STUDENT)) {
    const { rows } = await pool.query(
      `SELECT 1 FROM enrollments e JOIN courses c ON c.id = e.course_id
        WHERE e.user_id = $1 AND e.status = 'active'
          AND (c.instructor_id = $2
               OR EXISTS (SELECT 1 FROM course_teaching_assistants cta WHERE cta.course_id = c.id AND cta.user_id = $2))
        UNION
       SELECT 1 FROM enrollments mine
        JOIN enrollments other ON other.course_id = mine.course_id
        JOIN courses c ON c.id = mine.course_id
        WHERE mine.user_id = $1 AND mine.status = 'active'
          AND other.user_id = $2 AND other.status = 'active'
          AND COALESCE((c.settings->>'allowStudentMessaging')::boolean, false) = true
       LIMIT 1`,
      [actor.id, targetUserId],
    );
    return rows.length > 0;
  }

  return false; // guest and any unrecognized role
}

// ── listMessageableUsers — powers the mail compose recipient selector ───────

async function listMessageableUsers(actor, {
  courseId, search, role, departmentId, academicYearId, semesterTermId, page = 1, limit = 20,
} = {}) {
  const roles = roleNames(actor);
  const offset = (page - 1) * limit;

  const extra = [];
  function addExtraFilters(params) {
    if (role)           { params.push(role);           extra.push(`u.id IN (SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.name = $${params.length})`); }
    if (departmentId)   { params.push(departmentId);   extra.push(`u.id IN (SELECT user_id FROM user_departments WHERE department_id = $${params.length})`); }
    if (academicYearId) { params.push(academicYearId); extra.push(`u.id IN (SELECT user_id FROM user_academic_assignments WHERE academic_year_id = $${params.length})`); }
    if (semesterTermId) { params.push(semesterTermId); extra.push(`u.id IN (SELECT user_id FROM user_academic_assignments WHERE semester_term_id = $${params.length})`); }
    return extra.length ? `AND ${extra.join(' AND ')}` : '';
  }

  function run(sql, params) {
    let finalSql = sql;
    if (search) {
      params.push(`%${search}%`);
      finalSql += ` AND (u.first_name ILIKE $${params.length} OR u.last_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
    }
    finalSql += addExtraFilters(params);
    params.push(limit, offset);
    finalSql += ` ORDER BY u.first_name, u.last_name LIMIT $${params.length - 1} OFFSET $${params.length}`;
    return pool.query(finalSql, params);
  }

  let query, params;

  if (roles.includes(ROLES.SUPER_ADMIN)) {
    query = `SELECT DISTINCT u.id, u.first_name, u.last_name, u.email, u.avatar_url, u.institution_id
                FROM users u WHERE u.deleted_at IS NULL AND u.id != $1`;
    params = [actor.id];
  } else if (roles.includes(ROLES.INSTITUTION_ADMIN)) {
    query = `SELECT DISTINCT u.id, u.first_name, u.last_name, u.email, u.avatar_url, u.institution_id
                FROM users u
               WHERE u.deleted_at IS NULL AND u.id != $1 AND u.institution_id = $2`;
    params = [actor.id, actor.institutionId];
  } else if (roles.includes(ROLES.DEPT_MANAGER)) {
    query = `SELECT DISTINCT u.id, u.first_name, u.last_name, u.email, u.avatar_url, u.institution_id
                FROM users u
               WHERE u.deleted_at IS NULL AND u.id != $1
                 AND (
                   u.id IN (SELECT user_id FROM user_departments WHERE department_id IN (SELECT department_id FROM user_departments WHERE user_id = $1))
                   OR u.id IN (SELECT e.user_id FROM enrollments e JOIN courses c ON c.id = e.course_id
                                WHERE e.status = 'active' AND c.department_id IN (SELECT department_id FROM user_departments WHERE user_id = $1))
                   OR u.id IN (SELECT c.instructor_id FROM courses c
                                WHERE c.department_id IN (SELECT department_id FROM user_departments WHERE user_id = $1))
                 )`;
    params = [actor.id];
  } else if (roles.includes(ROLES.INSTRUCTOR)) {
    query = `SELECT DISTINCT u.id, u.first_name, u.last_name, u.email, u.avatar_url, u.institution_id
                FROM users u
               WHERE u.deleted_at IS NULL AND u.id != $1
                 AND (
                   u.id IN (SELECT e.user_id FROM enrollments e JOIN courses c ON c.id = e.course_id
                             WHERE c.instructor_id = $1 AND e.status = 'active'
                               ${courseId ? 'AND c.id = $2' : ''})
                   OR u.id IN (SELECT cta.user_id FROM course_teaching_assistants cta JOIN courses c ON c.id = cta.course_id
                                WHERE c.instructor_id = $1 ${courseId ? 'AND c.id = $2' : ''})
                 )`;
    params = courseId ? [actor.id, courseId] : [actor.id];
  } else if (roles.includes(ROLES.TEACHING_ASSISTANT)) {
    query = `SELECT DISTINCT u.id, u.first_name, u.last_name, u.email, u.avatar_url, u.institution_id
                FROM users u
               WHERE u.deleted_at IS NULL AND u.id != $1
                 AND (
                   u.id IN (SELECT c.instructor_id FROM course_teaching_assistants cta JOIN courses c ON c.id = cta.course_id WHERE cta.user_id = $1)
                   OR u.id IN (SELECT other.user_id FROM course_teaching_assistants mine
                                JOIN course_teaching_assistants other ON other.course_id = mine.course_id
                                WHERE mine.user_id = $1)
                   OR u.id IN (SELECT e.user_id FROM course_teaching_assistants mine
                                JOIN enrollments e ON e.course_id = mine.course_id
                                WHERE mine.user_id = $1 AND e.status = 'active')
                 )`;
    params = [actor.id];
  } else if (roles.includes(ROLES.STUDENT)) {
    query = `SELECT DISTINCT u.id, u.first_name, u.last_name, u.email, u.avatar_url, u.institution_id
                FROM users u
               WHERE u.deleted_at IS NULL AND u.id != $1
                 AND (
                   u.id IN (SELECT c.instructor_id FROM enrollments e JOIN courses c ON c.id = e.course_id
                             WHERE e.user_id = $1 AND e.status = 'active')
                   OR u.id IN (SELECT cta.user_id FROM enrollments e
                                JOIN course_teaching_assistants cta ON cta.course_id = e.course_id
                                WHERE e.user_id = $1 AND e.status = 'active')
                   OR u.id IN (SELECT other.user_id FROM enrollments mine
                                JOIN enrollments other ON other.course_id = mine.course_id
                                JOIN courses c ON c.id = mine.course_id
                                WHERE mine.user_id = $1 AND mine.status = 'active' AND other.status = 'active'
                                  AND COALESCE((c.settings->>'allowStudentMessaging')::boolean, false) = true)
                 )`;
    params = [actor.id];
  } else {
    return []; // guest
  }

  const { rows } = await run(query, params);
  return rows;
}

module.exports = { canMessage, listMessageableUsers };
