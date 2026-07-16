/**
 * express-validator result checker.
 * Wrap route validators: [body('email').isEmail(), validate]
 * Throws ApiError.badRequest with the full validation error array on failure.
 */
'use strict';

const { validationResult } = require('express-validator');
const ApiError = require('../utils/apiError');

const validate = (req, _res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      ApiError.badRequest('Validation failed', errors.array())
    );
  }
  next();
};

module.exports = validate;
