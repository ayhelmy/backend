'use strict';

/**
 * Users routes — SRS §4.2 USR-01 to USR-06; §10.2.
 * RBAC v2: permission-based guards with scope enforcement.
 */

const { Router } = require('express');
const multer     = require('multer');
const usersController = require('./users.controller');
const academicAssignmentSvc = require('./user-academic-assignments.service');
const authenticate    = require('../../middleware/authenticate');
const { requirePermission, requireAnyPermission } = require('../../middleware/authorize');
const validate        = require('../../middleware/validate');
const v               = require('./users.validators');
const { body }        = require('express-validator');
const ApiResponse     = require('../../utils/apiResponse');

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(authenticate);

// ── Bulk import (must be registered before /:id to avoid param collision) ─────
router.post('/import/validate', requirePermission('users.create'), upload.single('file'), usersController.importValidate);
router.post('/import/confirm',  requirePermission('users.create'), v.importConfirm, validate, usersController.importConfirm);

// ── Core CRUD ─────────────────────────────────────────────────────────────────
router.get('/',    requireAnyPermission('users.view_all', 'users.view_institution', 'users.view_department'), usersController.list);
router.post('/',   requirePermission('users.create'), v.create, validate, usersController.create);
// getOne and update allow self-access; scope enforced in service
router.get('/:id',    usersController.getOne);
router.patch('/:id',  v.update, validate, usersController.update);
router.delete('/:id', requirePermission('users.delete'), usersController.remove);

// ── Password ──────────────────────────────────────────────────────────────────
router.patch('/:id/password', v.changePassword, validate, usersController.changePassword);

// ── Role management ───────────────────────────────────────────────────────────
router.get('/:id/roles',                requireAnyPermission('users.view_institution', 'users.view_all', 'users.assign_roles'), usersController.getRoles);
router.post('/:id/roles',               requirePermission('users.assign_roles'), v.assignRole, validate, usersController.assignRole);
router.delete('/:id/roles/:roleId',     requirePermission('users.assign_roles'), usersController.revokeRole);

// ── Institution admin assignment (super_admin only, dedicated endpoint) ───────
router.post('/:id/assign-institution-admin',
  requirePermission('institutions.assign_admin'),
  validate,
  usersController.assignInstitutionAdmin,
);

// ── Department assignment ─────────────────────────────────────────────────────
router.post('/:id/departments',             requireAnyPermission('departments.assign_manager', 'users.assign_department'), v.assignDepartment, validate, usersController.assignDepartment);
router.delete('/:id/departments/:deptId',   requireAnyPermission('departments.assign_manager', 'users.assign_department'), usersController.revokeDepartment);

// ── Academic assignments ──────────────────────────────────────────────────────
const assignmentValidators = [
  body('departmentId').isUUID().withMessage('departmentId (UUID) is required'),
  body('academicYearId').isUUID().withMessage('academicYearId (UUID) is required'),
  body('semesterTermId').isUUID().withMessage('semesterTermId (UUID) is required'),
  body('roleContext').isIn(['instructor','student','teaching_assistant','dept_manager']).withMessage('invalid roleContext'),
];

router.get('/me/academic-assignment',
  async (req, res, next) => {
    try { ApiResponse.ok(res, 'Current academic assignment', await academicAssignmentSvc.getMyCurrent(req.user)); }
    catch (e) { next(e); }
  },
);
router.get('/:id/academic-assignments',
  async (req, res, next) => {
    try { ApiResponse.ok(res, 'Academic assignments', await academicAssignmentSvc.list(req.params.id, req.user)); }
    catch (e) { next(e); }
  },
);
router.post('/:id/academic-assignments',
  requireAnyPermission('academic_assignments.manage'),
  assignmentValidators, validate,
  async (req, res, next) => {
    try { ApiResponse.created(res, 'Assignment created', await academicAssignmentSvc.create(req.params.id, req.body, req.user)); }
    catch (e) { next(e); }
  },
);
router.patch('/:id/academic-assignments/:assignmentId',
  requireAnyPermission('academic_assignments.manage'),
  async (req, res, next) => {
    try { ApiResponse.ok(res, 'Assignment updated', await academicAssignmentSvc.update(req.params.assignmentId, req.body, req.user)); }
    catch (e) { next(e); }
  },
);

module.exports = router;
