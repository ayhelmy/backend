/**
 * Global error-handling middleware.
 * SRS refs: §10 "Errors follow RFC 7807 Problem Details format"
 * NFR-13: Error alerting; NFR-04: no stack traces in production.
 * Must be registered LAST in app.js (after all routes).
 */
'use strict';

const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // Validation errors from express-validator are wrapped as ApiError.badRequest
  if (err instanceof ApiError && err.isOperational) {
    return res.status(err.statusCode).json({
      type: err.type,
      title: err.message,
      status: err.statusCode,
      ...(err.errors.length > 0 && { errors: err.errors }),
    });
  }

  // Unhandled / programming errors — never expose internals in production
  const statusCode = err.statusCode || 500;
  return res.status(statusCode).json({
    type: 'https://Bedo SimuLearn.com/errors/internal',
    title: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    status: statusCode,
  });
};

module.exports = errorHandler;
