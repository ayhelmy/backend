'use strict';

const { body } = require('express-validator');
const { ASSIGNABLE_ROLES, SUPER_ONLY_ROLES } = require('../../constants/roles');

// All roles that can be assigned (regular + admin-tier)
const ALL_ASSIGNABLE = [...ASSIGNABLE_ROLES, ...SUPER_ONLY_ROLES];

exports.create = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('firstName').trim().notEmpty().withMessage('First name required'),
  body('lastName').trim().notEmpty().withMessage('Last name required'),
  body('role').optional().isIn(ALL_ASSIGNABLE).withMessage('Invalid role'),
  body('institutionId').optional().isUUID().withMessage('institutionId must be a valid UUID'),
];

exports.update = [
  body('firstName').optional().trim().notEmpty().withMessage('First name cannot be empty'),
  body('lastName').optional().trim().notEmpty().withMessage('Last name cannot be empty'),
  body('avatarUrl').optional({ nullable: true }).isURL().withMessage('Invalid URL'),
  body('bio').optional({ nullable: true }).isString(),
  body('status').optional().isIn(['active', 'suspended', 'pending']).withMessage('Invalid status'),
];

exports.changePassword = [
  body('currentPassword').optional().isString(),
  body('newPassword')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
    .matches(/[0-9]/).withMessage('Password must contain a digit'),
];

exports.assignRole = [
  body('roleName').isIn(ALL_ASSIGNABLE).withMessage('Invalid role name'),
  body('institutionId').optional().isUUID().withMessage('institutionId must be a valid UUID'),
  body('contextType')
    .optional()
    .isIn(['platform', 'institution', 'department', 'course'])
    .withMessage('contextType must be one of: platform, institution, department, course'),
  body('contextId').optional().isUUID().withMessage('contextId must be a valid UUID'),
];

exports.assignDepartment = [
  body('departmentId').isUUID().withMessage('departmentId must be a valid UUID'),
];

exports.importConfirm = [
  body('rows').isArray({ min: 1 }).withMessage('rows must be a non-empty array'),
  body('rows.*.email').isEmail().withMessage('Each row must have a valid email'),
  body('rows.*.firstName').trim().notEmpty().withMessage('Each row must have a firstName'),
  body('rows.*.lastName').trim().notEmpty().withMessage('Each row must have a lastName'),
  // Import does not allow assigning super_admin or institution_admin via CSV
  body('rows.*.role').optional().isIn(ASSIGNABLE_ROLES).withMessage('Invalid role in CSV row'),
];
