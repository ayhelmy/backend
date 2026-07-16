'use strict';

const { body } = require('express-validator');

exports.updateInstitution = [
  body('timezone').optional().notEmpty(),
  body('locale').optional().isIn(['en','ar','fr','es']),
  body('maxUsers').optional().isInt({ min: 1 }),
];

exports.updateUser = [
  body('locale').optional().isIn(['en','ar','fr','es']),
  body('notificationPreferences').optional().isObject(),
];
