'use strict';

const { body } = require('express-validator');

exports.createManualScore = [
  body('simulationId').isUUID(),
  body('userId').isUUID(),
  body('rawScore').isFloat({ min: 0 }),
  body('pointsPossible').optional().isFloat({ min: 0 }),
  body('passed').optional().isBoolean(),
  body('moduleId').optional({ nullable: true }).isUUID(),
  body('lessonId').optional({ nullable: true }).isUUID(),
  body('attemptNumber').optional().isInt({ min: 1 }),
];

exports.updateScore = [
  body('rawScore').optional().isFloat({ min: 0 }),
  body('pointsPossible').optional().isFloat({ min: 0 }),
  body('passed').optional().isBoolean(),
  body('overrideReason').optional().isString().notEmpty(),
];
