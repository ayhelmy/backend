'use strict';

/**
 * Roles & permissions routes — SRS §4.3 PERM-01 to PERM-04; §12 RBAC v2.
 * GET    /api/v1/roles                           list all roles with permissions
 * POST   /api/v1/roles                           create custom role (PERM-03)
 * GET    /api/v1/roles/permissions               list all permission codes
 * GET    /api/v1/roles/:id/permissions           permissions for a specific role
 * POST   /api/v1/roles/:id/permissions           add permission to role
 * DELETE /api/v1/roles/:id/permissions/:permId   remove permission from role
 * POST   /api/v1/roles/assign                    assign role to user
 * DELETE /api/v1/roles/users/:userId/roles/:roleId  revoke role from user
 *
 * Department and TA assignment:
 * POST   /api/v1/roles/departments/assign        assign dept_manager to department
 * DELETE /api/v1/roles/departments/:userId/:deptId revoke department assignment
 * POST   /api/v1/roles/ta/assign                 assign TA to course
 * DELETE /api/v1/roles/ta/:courseId/:userId      revoke TA from course
 */

const { Router } = require('express');
const rolesController = require('./roles.controller');
const authenticate    = require('../../middleware/authenticate');
const { requirePermission, requireAnyPermission } = require('../../middleware/authorize');
const validate        = require('../../middleware/validate');
const v               = require('./roles.validators');

const router = Router();
router.use(authenticate);

// /permissions must come before /:id
router.get('/permissions', requirePermission('roles.manage'), rolesController.listAllPermissions);

router.get('/',    requirePermission('roles.manage'), rolesController.listRoles);
router.post('/',   requirePermission('permissions.manage'), v.createRole, validate, rolesController.createRole);

router.get('/:id/permissions',            requirePermission('roles.manage'),        rolesController.listPermissions);
router.post('/:id/permissions',           requirePermission('permissions.manage'),  v.addPermission, validate, rolesController.addPermission);
router.delete('/:id/permissions/:permId', requirePermission('permissions.manage'),  rolesController.removePermission);

// Role assignment (mirrors /users/:id/roles, kept for backward compat)
router.post('/assign',                        requirePermission('users.assign_roles'), v.assignRole, validate, rolesController.assignRole);
router.delete('/users/:userId/roles/:roleId', requirePermission('users.assign_roles'), rolesController.revokeRole);

// Department assignments (dept_manager scoping)
router.post('/departments/assign',             requireAnyPermission('departments.assign_manager', 'users.assign_department'), rolesController.assignDepartment);
router.delete('/departments/:userId/:deptId',  requireAnyPermission('departments.assign_manager', 'users.assign_department'), rolesController.revokeDepartment);

// TA assignments
router.post('/ta/assign',                requirePermission('courses.assign_ta'), rolesController.assignTA);
router.delete('/ta/:courseId/:userId',   requirePermission('courses.assign_ta'), rolesController.revokeTA);

module.exports = router;
