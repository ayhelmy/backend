'use strict';

const { body } = require('express-validator');

exports.createItem = [
  body('title').trim().notEmpty(),
  body('itemType').isIn(['assignment','quiz','simulation','participation']),
  body('maxPoints').isFloat({ min: 0 }),
];

exports.updateItem = [
  body('title').optional().trim().notEmpty(),
  body('maxPoints').optional().isFloat({ min: 0 }),
  body('weight').optional().isFloat({ min: 0 }),
];

exports.submitGrade = [
  body('gradeItemId').isUUID(),
  body('userId').isUUID(),
  body('score').isFloat({ min: 0 }),
];

exports.updateGrade = [
  body('score').optional().isFloat({ min: 0 }),
  body('feedback').optional().isString(),
];
