'use strict';

const { body } = require('express-validator');

exports.update = [
  body('emailEnabled').optional().isBoolean(),
  body('inAppEnabled').optional().isBoolean(),
  body('pushEnabled').optional().isBoolean(),
  body('digestFrequency').optional().isIn(['instant', 'daily', 'weekly', 'off']),
  body('preferences').optional().isObject(),
];
