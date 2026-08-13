'use strict';

/**
 * Semester Terms routes. Mounted at / in app.js.
 *
 * GET  /academic-years/:academicYearId/semester-terms
 * POST /academic-years/:academicYearId/semester-terms
 * GET  /semester-terms/:id
 * PATCH /semester-terms/:id
 * DELETE /semester-terms/:id
 * GET  /semester-terms/:termId/courses
 */

const { Router } = require('express');
const c = require('./semester-terms.controller');
const authenticate = require('../../middleware/authenticate');
const { requireAnyPermission } = require('../../middleware/authorize');
const { body } = require('express-validator');
const validate = require('../../middleware/validate');

const router = Router();

const canView   = requireAnyPermission('semester_terms.view', 'semester_terms.manage', 'semester_terms.create');
const canManage = requireAnyPermission('semester_terms.create', 'semester_terms.manage');

const validators = [
  body('name').trim().notEmpty().withMessage('name is required'),
  body('code').optional({ nullable: true }).trim(),
  body('termOrder').optional().isInt({ min: 1 }),
  body('status').optional().isIn(['active', 'inactive', 'archived']),
  body('startDate').optional({ nullable: true }).isISO8601(),
  body('endDate').optional({ nullable: true }).isISO8601(),
];

// Nested under academic year
router.get('/academic-years/:academicYearId/semester-terms',  authenticate, canView,   c.list);
router.post('/academic-years/:academicYearId/semester-terms', authenticate, canManage, validators, validate, c.create);

// Single resource
router.get('/semester-terms/:id',    authenticate, canView,   c.getOne);
router.patch('/semester-terms/:id',  authenticate, canManage, validators, validate, c.update);
router.delete('/semester-terms/:id', authenticate, requireAnyPermission('semester_terms.manage'), c.remove);

// Courses in a term
router.get('/semester-terms/:termId/courses',
  authenticate,
  requireAnyPermission('courses.view_all','courses.view_institution','courses.view_department','courses.view_own'),
  c.getCourses,
);

module.exports = router;
