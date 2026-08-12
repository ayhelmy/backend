'use strict';

const { body } = require('express-validator');

exports.create = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('slug').optional().trim().matches(/^[a-z0-9-]+$/).withMessage('Slug must be lowercase letters, digits, and hyphens'),
  body('domain').optional().trim(),
  body('primaryColor').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Must be a hex colour (#RRGGBB)'),
  body('timezone').optional().notEmpty(),
  body('locale').optional().isIn(['en', 'ar', 'fr', 'es']),
  body('subscriptionPlan').optional().isIn(['trial', 'starter', 'professional', 'enterprise']),
  body('maxUsers').optional().isInt({ min: 1 }),
];

exports.update = [
  body('name').optional().trim().notEmpty(),
  body('domain').optional().trim(),
  body('logoUrl').optional().trim(),
  body('primaryColor').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Must be a hex colour (#RRGGBB)'),
  body('timezone').optional().notEmpty(),
  body('locale').optional().isIn(['en', 'ar', 'fr', 'es']),
  body('subscriptionPlan').optional().isIn(['trial', 'starter', 'professional', 'enterprise']),
  body('maxUsers').optional().isInt({ min: 1 }),
  body('status').optional().isIn(['active', 'suspended']),
];

exports.createDept = [
  body('name').trim().notEmpty().withMessage('Department name is required'),
  body('code').optional().trim().matches(/^[A-Z0-9_-]{1,20}$/i).withMessage('Code must be 1–20 alphanumeric characters'),
  body('parentId').optional().isUUID(),
];

exports.updateDept = [
  body('name').optional().trim().notEmpty(),
  body('code').optional({ nullable: true }).trim(),
  body('parentId').optional({ nullable: true }).isUUID(),
];

exports.createTerm = [
  body('name').trim().notEmpty().withMessage('Term name is required'),
  body('startDate').isISO8601().withMessage('startDate must be a valid date (YYYY-MM-DD)'),
  body('endDate').isISO8601().withMessage('endDate must be a valid date (YYYY-MM-DD)'),
  body('isCurrent').optional().isBoolean(),
];

exports.updateTerm = [
  body('name').optional().trim().notEmpty(),
  body('startDate').optional().isISO8601(),
  body('endDate').optional().isISO8601(),
  body('isCurrent').optional().isBoolean(),
];

exports.createDomain = [
  body('name').trim().notEmpty().withMessage('Domain name is required'),
  body('description').optional().trim(),
  body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Must be a hex colour (#RRGGBB)'),
  body('iconUrl').optional().trim(),
];

exports.updateDomain = [
  body('name').optional().trim().notEmpty(),
  body('description').optional().trim(),
  body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/),
  body('iconUrl').optional().trim(),
];

exports.addEmailDomain = [
  body('domain').trim().notEmpty().withMessage('Domain is required'),
  body('isPrimary').optional().isBoolean(),
];
