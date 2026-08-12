/**
 * 404 catch-all — must be registered after all routes, before errorHandler.
 */
'use strict';

const ApiError = require('../utils/apiError');

const notFound = (req, _res, next) => {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

module.exports = notFound;
