'use strict';

const { body } = require('express-validator');

exports.create = [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('visibility').optional().isIn(['private', 'institution', 'demo_public']).withMessage('Invalid visibility'),
  body('difficulty').optional().isIn(['beginner', 'intermediate', 'advanced']).withMessage('Invalid difficulty'),
  body('maxAttempts').optional().isInt({ min: 0 }).withMessage('maxAttempts must be a non-negative integer'),
  body('passScore').optional().isFloat({ min: 0, max: 100 }).withMessage('passScore must be between 0 and 100'),
  body('maxScore').optional().isFloat({ min: 1 }).withMessage('maxScore must be positive'),
  body('isFeatured').optional().isBoolean().withMessage('isFeatured must be a boolean'),
  body('featuredOrder').optional().isInt({ min: 0 }).withMessage('featuredOrder must be a non-negative integer'),
];

exports.update = [
  body('title').optional().trim().notEmpty().withMessage('Title cannot be empty'),
  body('status').optional().isIn(['draft', 'active', 'deprecated']).withMessage('Invalid status'),
  body('visibility').optional().isIn(['private', 'institution', 'demo_public']).withMessage('Invalid visibility'),
  body('maxAttempts').optional().isInt({ min: 0 }).withMessage('maxAttempts must be a non-negative integer'),
  body('difficulty').optional().isIn(['beginner', 'intermediate', 'advanced']).withMessage('Invalid difficulty'),
  body('isFeatured').optional().isBoolean().withMessage('isFeatured must be a boolean'),
  body('featuredOrder').optional().isInt({ min: 0 }).withMessage('featuredOrder must be a non-negative integer'),
];
