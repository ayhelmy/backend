'use strict';

/**
 * Grades routes — SRS §4.8 GRD-01 to GRD-07. RBAC v2.
 * Mounted under /api/v1/courses (gradebook is course-scoped).
 *
 * GET   /courses/:courseId/gradebook                     — grades.view_course
 * GET   /courses/:courseId/gradebook/items               — grades.view_course
 * POST  /courses/:courseId/gradebook/items               — grades.edit_course
 * PATCH /courses/:courseId/gradebook/items/:itemId       — grades.edit_course
 * GET   /courses/:courseId/gradebook/students/:studentId — grades.view_course (own data: grades.view_own)
 * POST  /courses/:courseId/gradebook/grades              — grades.edit_course
 * PATCH /courses/:courseId/gradebook/grades/:gradeId     — grades.override
 */

const { Router } = require('express');
const gradesController  = require('./grades.controller');
const authenticate      = require('../../middleware/authenticate');
const { requirePermission, requireAnyPermission } = require('../../middleware/authorize');
const { requireCourseAccess } = require('../../middleware/scopeGuards');
const validate          = require('../../middleware/validate');
const gradesValidators  = require('./grades.validators');

const router = Router({ mergeParams: true });
router.use(authenticate);

// All grade endpoints are course-scoped — requireCourseAccess validates institution AND
// role-based access (instructor owns, TA is assigned, student is enrolled, admin is in institution).

// Gradebook overview — instructors, TAs, dept_managers, institution_admins
router.get('/:courseId/gradebook',
  requireAnyPermission('grades.view_course', 'grades.view_department'),
  requireCourseAccess('grades.view_course'),
  gradesController.getGradebook,
);
router.get('/:courseId/gradebook/items',
  requireAnyPermission('grades.view_course', 'grades.view_own'),
  requireCourseAccess(),
  gradesController.listItems,
);

// Grade item management — instructors only
router.post('/:courseId/gradebook/items',
  requirePermission('grades.edit_course'),
  requireCourseAccess('grades.edit_course'),
  gradesValidators.createItem, validate,
  gradesController.createItem,
);
router.patch('/:courseId/gradebook/items/:itemId',
  requirePermission('grades.edit_course'),
  requireCourseAccess('grades.edit_course'),
  gradesValidators.updateItem, validate,
  gradesController.updateItem,
);

// Student grade view — instructors/TAs see all, students see own (service enforces)
router.get('/:courseId/gradebook/students/:studentId',
  requireAnyPermission('grades.view_course', 'grades.view_own'),
  requireCourseAccess(),
  gradesController.getStudentGrades,
);

// Grade submission and override
router.post('/:courseId/gradebook/grades',
  requirePermission('grades.edit_course'),
  requireCourseAccess('grades.edit_course'),
  gradesValidators.submitGrade, validate,
  gradesController.submitGrade,
);
router.patch('/:courseId/gradebook/grades/:gradeId',
  requirePermission('grades.override'),
  requireCourseAccess('grades.override'),
  gradesValidators.updateGrade, validate,
  gradesController.updateGrade,
);

module.exports = router;
