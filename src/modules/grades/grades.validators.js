'use strict';

const { body } = require('express-validator');

exports.createItem = [
  body('title').trim().notEmpty(),
  body('itemType').isIn(['assignment','quiz','simulation','participation']),
  body('maxPoints').isFloat({ min: 0 }),
  body('lessonId').optional({ nullable: true }).isUUID(),
  body('simulationId').optional({ nullable: true }).isUUID(),
  body('quizId').optional({ nullable: true }).isUUID(),
  body('categoryId').optional({ nullable: true }).isUUID(),
];

exports.updateItem = [
  body('title').optional().trim().notEmpty(),
  body('maxPoints').optional().isFloat({ min: 0 }),
  body('weight').optional().isFloat({ min: 0 }),
  body('categoryId').optional({ nullable: true }).isUUID(),
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
