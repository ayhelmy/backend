/**
 * Structured API error — maps to RFC 7807 Problem Details.
 * SRS refs: §10 "Errors follow RFC 7807 Problem Details format"
 */
'use strict';

class ApiError extends Error {
  /**
   * @param {number} statusCode  HTTP status code
   * @param {string} message     Human-readable error message
   * @param {string} [type]      URI reference identifying error type
   * @param {Array}  [errors]    Validation error details
   */
  constructor(statusCode, message, type = null, errors = []) {
    super(message);
    this.statusCode = statusCode;
    this.type = type || `https://Bedo SimuLearn.com/errors/${statusCode}`;
    this.errors = errors;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, errors = []) {
    return new ApiError(400, message, null, errors);
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'Forbidden') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }

  static conflict(message = 'Conflict') {
    return new ApiError(409, message);
  }

  static unprocessable(message = 'Unprocessable Entity') {
    return new ApiError(422, message);
  }

  static internal(message = 'Internal server error') {
    return new ApiError(500, message);
  }
}

module.exports = ApiError;
