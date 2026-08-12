'use strict';

const { body } = require('express-validator');

const ALL_ROLES = [
  'super_admin', 'institution_admin', 'dept_manager', 'instructor',
  'teaching_assistant', 'student', 'content_creator', 'simulation_developer', 'guest',
];

exports.createRole = [
  body('name')
    .trim().notEmpty().withMessage('Role name required')
    .matches(/^[a-z0-9_]+$/).withMessage('Role name must be lowercase letters, digits, or underscores'),
  body('label').trim().notEmpty().withMessage('Label required'),
  body('description').optional().isString(),
  body('permissionCodes').optional().isArray().withMessage('permissionCodes must be an array'),
];

exports.addPermission = [
  body('permissionCode').trim().notEmpty().withMessage('permissionCode required'),
];

exports.assignRole = [
  body('userId').isUUID().withMessage('userId must be a UUID'),
  body('roleName').isIn(ALL_ROLES).withMessage('Invalid role name'),
  body('institutionId').optional().isUUID(),
];
