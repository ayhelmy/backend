'use strict';

const { body } = require('express-validator');

exports.createCategory = [
  body('name').trim().notEmpty().withMessage('Category name is required.'),
  body('weight').isFloat({ min: 0 }),
  body('itemTypeFilter').optional({ nullable: true }).isIn(['simulation', 'assignment', 'quiz', 'participation']),
  body('position').optional().isInt({ min: 0 }),
];

exports.updateCategory = [
  body('name').optional().trim().notEmpty(),
  body('weight').optional().isFloat({ min: 0 }),
  body('itemTypeFilter').optional({ nullable: true }).isIn(['simulation', 'assignment', 'quiz', 'participation']),
  body('position').optional().isInt({ min: 0 }),
];
