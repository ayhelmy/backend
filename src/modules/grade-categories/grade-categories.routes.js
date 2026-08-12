'use strict';

/**
 * Grade categories routes — weighted gradebook grouping (migration 048).
 * Mounted under /api/v1/courses.
 *
 * GET    /courses/:courseId/grade-categories           — grades.view_course
 * POST   /courses/:courseId/grade-categories           — grade_categories.manage
 * GET    /courses/:courseId/grade-categories/validate  — grades.view_course
 * PATCH  /courses/:courseId/grade-categories/:id       — grade_categories.manage
 * DELETE /courses/:courseId/grade-categories/:id       — grade_categories.manage
 */

const { Router } = require('express');
const categoriesController = require('./grade-categories.controller');
const authenticate = require('../../middleware/authenticate');
const { requirePermission, requireAnyPermission } = require('../../middleware/authorize');
const { requireCourseAccess } = require('../../middleware/scopeGuards');
const validate = require('../../middleware/validate');
const categoriesValidators = require('./grade-categories.validators');

const router = Router({ mergeParams: true });
router.use(authenticate);

router.get('/:courseId/grade-categories',
  requireAnyPermission('grades.view_course', 'grade_categories.view'),
  requireCourseAccess(),
  categoriesController.listCategories,
);

router.post('/:courseId/grade-categories',
  requirePermission('grade_categories.manage'),
  requireCourseAccess('grade_categories.manage'),
  categoriesValidators.createCategory, validate,
  categoriesController.createCategory,
);

// validate MUST be before /:id to avoid param capture
router.get('/:courseId/grade-categories/validate',
  requireAnyPermission('grades.view_course', 'grade_categories.view'),
  requireCourseAccess(),
  categoriesController.validateWeights,
);

router.patch('/:courseId/grade-categories/:id',
  requirePermission('grade_categories.manage'),
  requireCourseAccess('grade_categories.manage'),
  categoriesValidators.updateCategory, validate,
  categoriesController.updateCategory,
);

router.delete('/:courseId/grade-categories/:id',
  requirePermission('grade_categories.manage'),
  requireCourseAccess('grade_categories.manage'),
  categoriesController.deleteCategory,
);

module.exports = router;
