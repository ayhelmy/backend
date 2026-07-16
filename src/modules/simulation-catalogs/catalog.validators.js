'use strict';

const { body, param } = require('express-validator');

// ── Create catalog (root or sub) ──────────────────────────────────────────────

exports.createCatalog = [
  body('name').trim().notEmpty().withMessage('Catalog name is required'),
  body('description').optional({ nullable: true }).isString(),
  body('parentId').optional({ nullable: true }).isUUID().withMessage('parentId must be a valid UUID'),
  body('visibility')
    .optional()
    .isIn(['global', 'institution', 'demo_public', 'demo_and_institution'])
    .withMessage('visibility must be global | institution | demo_public'),
  body('institutionId').optional({ nullable: true }).isUUID().withMessage('institutionId must be a valid UUID'),
  body('isGlobal').optional().isBoolean().withMessage('isGlobal must be a boolean'),
  body('isDemo').optional().isBoolean().withMessage('isDemo must be a boolean'),
  body('sortOrder').optional().isInt({ min: 0 }).withMessage('sortOrder must be a non-negative integer'),
];

// ── Update catalog ────────────────────────────────────────────────────────────

exports.updateCatalog = [
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('description').optional({ nullable: true }).isString(),
  body('status').optional().isIn(['draft', 'active', 'archived']).withMessage('Invalid status'),
  body('visibility')
    .optional()
    .isIn(['global', 'institution', 'demo_public', 'demo_and_institution'])
    .withMessage('visibility must be global | institution | demo_public'),
  body('isGlobal').optional().isBoolean(),
  body('isDemo').optional().isBoolean(),
  body('sortOrder').optional().isInt({ min: 0 }),
];

// ── Move catalog ──────────────────────────────────────────────────────────────

exports.moveCatalog = [
  body('newParentId')
    .optional({ nullable: true })
    .custom((v) => v === null || /^[0-9a-f-]{36}$/i.test(v))
    .withMessage('newParentId must be a valid UUID or null'),
];

// ── Reorder catalog ───────────────────────────────────────────────────────────

exports.reorderCatalog = [
  body('sortOrder').isInt({ min: 0 }).withMessage('sortOrder must be a non-negative integer'),
];

// ── Items ─────────────────────────────────────────────────────────────────────

exports.addItem = [
  body('simulationId').isUUID().withMessage('simulationId must be a valid UUID'),
];

// ── Institution assignment ────────────────────────────────────────────────────

exports.assignToInstitution = [
  body('institutionId').isUUID().withMessage('institutionId must be a valid UUID'),
  body('includeSubtree')
    .optional()
    .isBoolean()
    .withMessage('includeSubtree must be a boolean'),
];

// ── Create simulation within catalog context ──────────────────────────────────

exports.createSimulationInCatalog = [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('difficulty').optional().isIn(['beginner', 'intermediate', 'advanced']).withMessage('Invalid difficulty'),
  body('visibility').optional().isIn(['private', 'institution', 'demo_public', 'demo_and_institution']).withMessage('Invalid visibility'),
  body('description').optional({ nullable: true }).isString(),
  body('thumbnailUrl').optional({ nullable: true }).isString(),
  body('maxScore').optional().isNumeric().withMessage('maxScore must be numeric'),
  body('passScore').optional().isNumeric().withMessage('passScore must be numeric'),
  body('maxAttempts').optional().isInt({ min: 0 }).withMessage('maxAttempts must be a non-negative integer'),
  body('estimatedMinutes').optional({ nullable: true }).isInt({ min: 1 }).withMessage('estimatedMinutes must be a positive integer'),
  body('version').optional().isString(),
];

// ── WebGL ZIP upload ──────────────────────────────────────────────────────────
// Note: the zip_file itself is validated by the upload middleware (type + size).
// These validators check the form-field metadata sent alongside the file.

exports.webglUpload = [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('description').optional({ nullable: true }).isString(),
  body('difficulty')
    .optional()
    .isIn(['beginner', 'intermediate', 'advanced'])
    .withMessage('difficulty must be beginner | intermediate | advanced'),
  body('estimatedMinutes')
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage('estimatedMinutes must be a positive integer'),
  body('visibility')
    .optional()
    .isIn(['private', 'institution', 'demo_public', 'demo_and_institution'])
    .withMessage('visibility must be private | institution | demo_public'),
  body('status')
    .optional()
    .isIn(['draft', 'active', 'deprecated'])
    .withMessage('status must be draft | active | deprecated'),
  body('thumbnailUrl').optional({ nullable: true }).isString(),
];

// ── Update simulation within catalog context ──────────────────────────────────

exports.updateSimulationInCatalog = [
  body('title').optional().trim().notEmpty().withMessage('Title cannot be empty'),
  body('difficulty').optional().isIn(['beginner', 'intermediate', 'advanced']).withMessage('Invalid difficulty'),
  body('visibility').optional().isIn(['private', 'institution', 'demo_public', 'demo_and_institution']).withMessage('Invalid visibility'),
  body('status').optional().isIn(['draft', 'active', 'deprecated']).withMessage('Invalid status'),
  body('description').optional({ nullable: true }).isString(),
  body('thumbnailUrl').optional({ nullable: true }).isString(),
  body('maxScore').optional().isNumeric().withMessage('maxScore must be numeric'),
  body('passScore').optional().isNumeric().withMessage('passScore must be numeric'),
  body('maxAttempts').optional().isInt({ min: 0 }).withMessage('maxAttempts must be a non-negative integer'),
  body('estimatedMinutes').optional({ nullable: true }).isInt({ min: 1 }).withMessage('estimatedMinutes must be a positive integer'),
  body('version').optional().isString(),
];
