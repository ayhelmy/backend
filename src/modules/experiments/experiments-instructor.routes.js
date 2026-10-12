'use strict';

/**
 * Instructor-facing dashboard over the experiments tracking pipeline. Mounted
 * at /api/v1/courses (see app.js), alongside simulation-scores/grade-categories.
 * Route-level requirePermission('lessons.view') is not the real access
 * control (also true for students) — instructor-analytics.service.js's
 * assertCourseAccess (canViewCourseActivity, copied from simulation-activity)
 * is what actually gates this to instructors/dept managers/admins.
 *
 *   GET /courses/:courseId/simulations/:simulationId/experiments-analytics/dashboard
 */

const { Router } = require('express');
const ctrl = require('./experiments-instructor.controller');
const authenticate = require('../../middleware/authenticate');
const { requirePermission } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const v = require('./experiments-instructor.validators');

const router = Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/:courseId/simulations/:simulationId/experiments-analytics/dashboard',
  requirePermission('lessons.view'),
  v.getDashboard, validate,
  ctrl.getDashboard,
);

module.exports = router;
