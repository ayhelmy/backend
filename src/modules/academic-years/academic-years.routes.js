'use strict';

/**
 * Academic Years routes.
 * Mounted at / in app.js so full paths are used here.
 *
 * GET  /departments/:departmentId/academic-years
 * POST /departments/:departmentId/academic-years
 * GET  /academic-years/:id
 * PATCH /academic-years/:id
 * DELETE /academic-years/:id
 */

const { Router } = require('express');
const c = require('./academic-years.controller');
const authenticate = require('../../middleware/authenticate');
const { requireAnyPermission } = require('../../middleware/authorize');
const { body } = require('express-validator');
const validate = require('../../middleware/validate');

const router = Router();
router.use(authenticate);

const canView   = requireAnyPermission('academic_years.view', 'academic_years.manage', 'academic_years.create');
const canManage = requireAnyPermission('academic_years.create', 'academic_years.manage');

const validators = [
  body('name').trim().notEmpty().withMessage('name is required'),
  body('code').optional({ nullable: true }).trim(),
  body('yearOrder').optional().isInt({ min: 1 }),
  body('status').optional().isIn(['active', 'inactive', 'archived']),
  body('startDate').optional({ nullable: true }).isISO8601(),
  body('endDate').optional({ nullable: true }).isISO8601(),
];

// List & create under a department
router.get('/departments/:departmentId/academic-years',  canView,   c.list);
router.post('/departments/:departmentId/academic-years', canManage, validators, validate, c.create);

// Single resource operations
router.get('/academic-years/:id',    canView,   c.getOne);
router.patch('/academic-years/:id',  canManage, validators.map(v => v.optional ? v : v), validate, c.update);
router.delete('/academic-years/:id', requireAnyPermission('academic_years.manage'), c.remove);

module.exports = router;
