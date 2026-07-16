'use strict';

/**
 * Scope-enforcement middleware — Bedo SimuLearn RBAC v2.
 * These guards perform DB lookups to validate that the authenticated user
 * has access to the specific resource in the URL.
 *
 * Usage (in route files):
 *   router.patch('/:id', requireCourseOwnership, coursesController.update);
 *   router.get('/:id/gradebook', requireCourseAccess('grades.view_course'), gradesController.get);
 */

const { pool }    = require('../config/database');
const ApiError    = require('../utils/apiError');
const { P }       = require('../constants/permissions');
const { ROLES }   = require('../constants/roles');

// ── Course-level scope helpers ────────────────────────────────────────────────

/**
 * Loads the course by req.params.id (or req.params.courseId) and attaches it
 * to req.course. Returns 404 if not found, 403 on institution mismatch.
 * Must run after authenticate.
 */
const loadCourse = async (req, _res, next) => {
  const courseId = req.params.id ?? req.params.courseId;
  try {
    const { rows } = await pool.query(
      `SELECT id, institution_id, department_id, instructor_id, status
         FROM courses WHERE id = $1 AND deleted_at IS NULL`,
      [courseId],
    );
    const course = rows[0];
    if (!course) return next(ApiError.notFound('Course not found.'));

    const actor = req.user;
    const isSuperAdmin = actor.roles?.includes(ROLES.SUPER_ADMIN);

    // Prevent leaking cross-tenant data: return 404 (not 403) for other institutions
    if (!isSuperAdmin && course.institution_id !== actor.institutionId) {
      return next(ApiError.notFound('Course not found.'));
    }

    req.course = course;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * requireCourseAccess(requiredPermission)
 * Combines loadCourse + permission check + ownership/assignment check.
 *
 * Access rules (in priority order):
 *   super_admin          → always allowed
 *   institution_admin    → any course in own institution (needs requiredPermission)
 *   dept_manager         → courses in own department (needs requiredPermission)
 *   instructor           → own created courses only
 *   teaching_assistant   → courses assigned as TA
 *   student              → enrolled courses only
 */
const requireCourseAccess = (requiredPermission) => [
  loadCourse,
  async (req, _res, next) => {
    const actor  = req.user;
    const course = req.course;

    // super_admin bypasses all checks
    if (actor.roles?.includes(ROLES.SUPER_ADMIN)) return next();

    // Permission check (from cached permissions)
    if (requiredPermission && !actor.permissions?.includes(requiredPermission)) {
      return next(ApiError.forbidden(`Missing required permission: ${requiredPermission}.`));
    }

    const role = (actor.roles ?? []).find((r) =>
      [ROLES.INSTITUTION_ADMIN, ROLES.DEPT_MANAGER, ROLES.INSTRUCTOR,
       ROLES.TEACHING_ASSISTANT, ROLES.STUDENT].includes(typeof r === 'string' ? r : r.name),
    );
    const roleName = typeof role === 'string' ? role : role?.name;

    switch (roleName) {
      case ROLES.INSTITUTION_ADMIN:
        // Institution already validated in loadCourse
        return next();

      case ROLES.DEPT_MANAGER: {
        if (!course.department_id) return next(ApiError.forbidden('This course has no department assigned.'));
        const { rows } = await pool.query(
          `SELECT 1 FROM user_departments WHERE user_id = $1 AND department_id = $2 LIMIT 1`,
          [actor.id, course.department_id],
        );
        if (!rows.length) return next(ApiError.forbidden('This course does not belong to your department.'));
        return next();
      }

      case ROLES.INSTRUCTOR:
        if (course.instructor_id !== actor.id) {
          return next(ApiError.forbidden('You are not the instructor of this course.'));
        }
        return next();

      case ROLES.TEACHING_ASSISTANT: {
        const { rows } = await pool.query(
          `SELECT 1 FROM course_teaching_assistants WHERE course_id = $1 AND user_id = $2 LIMIT 1`,
          [course.id, actor.id],
        );
        if (!rows.length) return next(ApiError.forbidden('You are not assigned as TA for this course.'));
        return next();
      }

      case ROLES.STUDENT: {
        const { rows } = await pool.query(
          `SELECT 1 FROM enrollments WHERE course_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
          [course.id, actor.id],
        );
        if (!rows.length) return next(ApiError.forbidden('You are not enrolled in this course.'));
        return next();
      }

      default:
        return next(ApiError.forbidden('Insufficient role for this course.'));
    }
  },
];

/**
 * requireCourseOwnership — only the course instructor (or admin) may proceed.
 * Use for write operations (update, publish, archive, delete).
 */
const requireCourseOwnership = [
  loadCourse,
  (req, _res, next) => {
    const actor  = req.user;
    const course = req.course;

    if (actor.roles?.includes(ROLES.SUPER_ADMIN)) return next();
    if (actor.roles?.includes(ROLES.INSTITUTION_ADMIN)) return next();

    if (actor.roles?.includes(ROLES.INSTRUCTOR)) {
      if (course.instructor_id !== actor.id) {
        return next(ApiError.forbidden('You are not the instructor of this course.'));
      }
      return next();
    }

    return next(ApiError.forbidden('Only the course instructor or an admin may modify this course.'));
  },
];

// ── Institution scope (DB-validated) ─────────────────────────────────────────

/**
 * requireDepartmentScope — validates actor can manage the given department.
 * Checks req.params.id (department ID) or req.params.deptId.
 */
const requireDepartmentScope = async (req, _res, next) => {
  const actor    = req.user;
  const deptId   = req.params.deptId ?? req.params.id;

  if (actor.roles?.includes(ROLES.SUPER_ADMIN)) return next();
  if (actor.roles?.includes(ROLES.INSTITUTION_ADMIN)) {
    // Verify department belongs to actor's institution
    const { rows } = await pool.query(
      `SELECT 1 FROM departments WHERE id = $1 AND institution_id = $2 LIMIT 1`,
      [deptId, actor.institutionId],
    );
    if (!rows.length) return next(ApiError.notFound('Department not found.'));
    return next();
  }
  if (actor.roles?.includes(ROLES.DEPT_MANAGER)) {
    const { rows } = await pool.query(
      `SELECT 1 FROM user_departments WHERE user_id = $1 AND department_id = $2 LIMIT 1`,
      [actor.id, deptId],
    );
    if (!rows.length) return next(ApiError.forbidden('This department is not assigned to you.'));
    return next();
  }

  return next(ApiError.forbidden('Department management access denied.'));
};

/**
 * optionalAuth — populates req.user if a valid Bearer token is present,
 * but does NOT reject unauthenticated requests. Use for public/demo routes.
 */
const optionalAuth = async (req, _res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  try {
    const authenticate = require('./authenticate');
    await authenticate(req, _res, next);
  } catch {
    req.user = null;
    next();
  }
};

module.exports = {
  loadCourse,
  requireCourseAccess,
  requireCourseOwnership,
  requireDepartmentScope,
  optionalAuth,
};
