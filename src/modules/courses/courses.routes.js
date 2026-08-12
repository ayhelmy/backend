'use strict';

/**
 * Courses routes — SRS §4.5 CRS-01 to CRS-10. RBAC v2.
 *
 * GET    /api/v1/courses               — scoped by role
 * GET    /api/v1/courses/me/enrolled   — my actively-enrolled courses (any authenticated user)
 * POST   /api/v1/courses               — instructor only (courses.create)
 * GET    /api/v1/courses/:id           — public within institution
 * PATCH  /api/v1/courses/:id           — instructor (own) or admin
 * DELETE /api/v1/courses/:id           — institution_admin or super_admin
 * POST   /api/v1/courses/:id/publish   — courses.publish (instructor/dept_manager)
 * POST   /api/v1/courses/:id/archive   — courses.archive (instructor/admin)
 * POST   /api/v1/courses/:id/clone     — courses.create
 * GET    /api/v1/courses/:id/enrollments
 * POST   /api/v1/courses/:id/enrollments
 * GET    /api/v1/courses/:id/enrollments/me
 * POST   /api/v1/courses/:id/enrollments/:userId/approve
 * DELETE /api/v1/courses/:id/enrollments/:userId
 */

const { Router }         = require('express');
const coursesController  = require('./courses.controller');
const authenticate       = require('../../middleware/authenticate');
const { requirePermission, requireAnyPermission, authorize } = require('../../middleware/authorize');
const { requireCourseOwnership, loadCourse } = require('../../middleware/scopeGuards');
const validate           = require('../../middleware/validate');
const coursesValidators  = require('./courses.validators');

const router = Router();
router.use(authenticate);

// ── Catalog ───────────────────────────────────────────────────────────────────
router.get('/',    requireAnyPermission('courses.view_all', 'courses.view_institution', 'courses.view_department', 'courses.view_own'), coursesController.list);
router.post('/',   requirePermission('courses.create'), coursesValidators.create, validate, coursesController.create);
// /me/enrolled MUST be registered before /:id to avoid param capture.
router.get('/me/enrolled', coursesController.listMyEnrolled);
router.get('/:id', requireAnyPermission('courses.view_all', 'courses.view_institution', 'courses.view_department', 'courses.view_own'), coursesController.getOne);

// ── Mutations (ownership enforced by requireCourseOwnership) ──────────────────
router.patch('/:id',  requireAnyPermission('courses.update_own', 'courses.update_all'), requireCourseOwnership, coursesValidators.update, validate, coursesController.update);
router.delete('/:id', requireAnyPermission('courses.update_all', 'courses.update_own'), loadCourse, authorize('super_admin', 'institution_admin', 'instructor'), coursesController.remove);

// ── State transitions ─────────────────────────────────────────────────────────
router.post('/:id/publish', requireAnyPermission('courses.publish', 'courses.update_all'), requireCourseOwnership, coursesController.publish);
router.post('/:id/archive',  requirePermission('courses.archive'), loadCourse, authorize('super_admin', 'institution_admin', 'instructor'), coursesController.archive);
router.post('/:id/restore',  requirePermission('courses.archive'), loadCourse, authorize('super_admin', 'institution_admin', 'instructor'), coursesController.restore);
router.post('/:id/clone',   requirePermission('courses.create'),  coursesController.clone);

// ── TA assignment ─────────────────────────────────────────────────────────────
router.post('/:id/teaching-assistants',            requirePermission('courses.assign_ta'), loadCourse, coursesController.assignTA);
router.delete('/:id/teaching-assistants/:userId',  requirePermission('courses.assign_ta'), loadCourse, coursesController.revokeTA);
router.get('/:id/teaching-assistants',             requirePermission('courses.assign_ta'), loadCourse, coursesController.listTAs);

// ── Simulation access (department-filtered) ───────────────────────────────────
// Returns catalogs / simulations available for this course (filtered by dept if set).
router.get('/:id/simulation-catalogs', requireAnyPermission('courses.view_all', 'courses.view_institution', 'courses.view_department', 'courses.view_own'), coursesController.getCourseCatalogs);
router.get('/:id/simulations',         requireAnyPermission('courses.view_all', 'courses.view_institution', 'courses.view_department', 'courses.view_own'), coursesController.getCourseSimulations);

// ── Enrollments ───────────────────────────────────────────────────────────────
router.get('/:id/enrollments', requireAnyPermission('courses.manage_enrollments', 'grades.view_course'), coursesController.listEnrollments);
router.post('/:id/enrollments', coursesValidators.enroll, validate, coursesController.enroll);
// /me MUST be registered before /:userId
router.get('/:id/enrollments/me', coursesController.myEnrollment);
router.post('/:id/enrollments/:userId/approve', requirePermission('courses.manage_enrollments'), coursesController.approveEnrollment);
router.delete('/:id/enrollments/:userId',       requirePermission('courses.manage_enrollments'), coursesController.unenroll);

module.exports = router;
