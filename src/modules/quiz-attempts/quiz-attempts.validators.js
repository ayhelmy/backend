'use strict';

const { body } = require('express-validator');

exports.saveResponses = [
  body('responses').isArray({ min: 1 }).withMessage('responses must be a non-empty array.'),
  body('responses.*.questionId').isUUID(),
  body('responses.*.responsePayload').isObject(),
];

exports.gradeAttempt = [
  body('responses').isArray({ min: 1 }).withMessage('responses must be a non-empty array.'),
  body('responses.*.responseId').isUUID(),
  body('responses.*.score').isFloat({ min: 0 }),
  body('responses.*.feedback').optional({ nullable: true }).isString(),
];
