'use strict';

/**
 * Dashboard stats — GET /api/v1/dashboard/stats
 * Returns role-scoped counts so the frontend dashboard cards show real data.
 * RBAC v2: uses role names for branching (no permission granularity needed here).
 */

const { Router }   = require('express');
const { pool }     = require('../../config/database');
const authenticate = require('../../middleware/authenticate');
const ApiResponse  = require('../../utils/apiResponse');
const { ROLES }    = require('../../constants/roles');

const router = Router();
router.use(authenticate);

router.get('/stats', async (req, res, next) => {
  try {
    const actor      = req.user;
    const roles      = (actor.roles ?? []).map((r) => (typeof r === 'string' ? r : r.name));
    const isSuperAdmin   = roles.includes(ROLES.SUPER_ADMIN);
    const isInstAdmin    = roles.includes(ROLES.INSTITUTION_ADMIN);
    const isDeptManager  = roles.includes(ROLES.DEPT_MANAGER);
    const isInstructor   = roles.includes(ROLES.INSTRUCTOR);
    const isTA           = roles.includes(ROLES.TEACHING_ASSISTANT);

    let stats = {};

    if (isSuperAdmin) {
      const [userCount, instCount, courseCount, enrollCount] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS total FROM users WHERE deleted_at IS NULL`),
        pool.query(`SELECT COUNT(*) AS total FROM institutions WHERE deleted_at IS NULL`),
        pool.query(`SELECT COUNT(*) AS total FROM courses WHERE deleted_at IS NULL`),
        pool.query(`SELECT COUNT(*) AS total FROM enrollments WHERE status = 'active'`),
      ]);
      stats = {
        totalUsers:        parseInt(userCount.rows[0].total, 10),
        totalInstitutions: parseInt(instCount.rows[0].total, 10),
        totalCourses:      parseInt(courseCount.rows[0].total, 10),
        totalEnrollments:  parseInt(enrollCount.rows[0].total, 10),
      };

    } else if (isInstAdmin) {
      const instId = actor.institutionId;
      const [userCount, courseCount, enrollCount, deptCount] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS total FROM users WHERE institution_id = $1 AND deleted_at IS NULL`, [instId]),
        pool.query(`SELECT COUNT(*) AS total FROM courses WHERE institution_id = $1 AND deleted_at IS NULL`, [instId]),
        pool.query(
          `SELECT COUNT(*) AS total FROM enrollments e
             JOIN courses c ON c.id = e.course_id
            WHERE c.institution_id = $1 AND e.status = 'active'`, [instId],
        ),
        pool.query(`SELECT COUNT(*) AS total FROM departments WHERE institution_id = $1`, [instId]),
      ]);
      stats = {
        totalUsers:       parseInt(userCount.rows[0].total, 10),
        totalCourses:     parseInt(courseCount.rows[0].total, 10),
        totalEnrollments: parseInt(enrollCount.rows[0].total, 10),
        totalDepartments: parseInt(deptCount.rows[0].total, 10),
      };

    } else if (isDeptManager) {
      const { rows: deptRows } = await pool.query(
        `SELECT department_id FROM user_departments WHERE user_id = $1`, [actor.id],
      );
      const deptIds = deptRows.map((r) => r.department_id);
      if (deptIds.length) {
        const [courseCount, userCount] = await Promise.all([
          pool.query(`SELECT COUNT(*) AS total FROM courses WHERE department_id = ANY($1) AND deleted_at IS NULL`, [deptIds]),
          pool.query(`SELECT COUNT(*) AS total FROM user_departments WHERE department_id = ANY($1)`, [deptIds]),
        ]);
        stats = {
          departmentCourses: parseInt(courseCount.rows[0].total, 10),
          departmentUsers:   parseInt(userCount.rows[0].total, 10),
        };
      } else {
        stats = { departmentCourses: 0, departmentUsers: 0 };
      }

    } else if (isInstructor || isTA) {
      const [publishedCount, draftCount, studentCount] = await Promise.all([
        pool.query(
          `SELECT COUNT(*) AS total FROM courses
            WHERE instructor_id = $1 AND status = 'published' AND deleted_at IS NULL`,
          [actor.id],
        ),
        pool.query(
          `SELECT COUNT(*) AS total FROM courses
            WHERE instructor_id = $1 AND status = 'draft' AND deleted_at IS NULL`,
          [actor.id],
        ),
        pool.query(
          `SELECT COUNT(DISTINCT e.user_id) AS total
             FROM enrollments e
             JOIN courses c ON c.id = e.course_id
            WHERE c.instructor_id = $1 AND e.status = 'active' AND e.role = 'student'`,
          [actor.id],
        ),
      ]);
      stats = {
        activeCourses:  parseInt(publishedCount.rows[0].total, 10),
        draftCourses:   parseInt(draftCount.rows[0].total, 10),
        activeStudents: parseInt(studentCount.rows[0].total, 10),
      };

    } else {
      // Student / guest
      const [enrollCount, completedCount] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS total FROM enrollments WHERE user_id = $1 AND status = 'active'`, [actor.id]),
        pool.query(`SELECT COUNT(*) AS total FROM course_progress WHERE user_id = $1 AND status = 'completed'`, [actor.id]),
      ]);
      stats = {
        enrolledCourses:  parseInt(enrollCount.rows[0].total, 10),
        completedCourses: parseInt(completedCount.rows[0].total, 10),
      };
    }

    ApiResponse.ok(res, 'Dashboard stats', stats);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
