/**
 * Rate limiting middleware.
 * SRS refs: §5 NFR-04 — "Rate limiting on all public API endpoints."
 */
'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Default limiter — applied to general /api/v1 routes.
 * In development, the limit is intentionally high to avoid blocking testing.
 */
const defaultLimiter = rateLimit({
  windowMs: config.rateLimit?.windowMs || 15 * 60 * 1000,
  max: isProduction ? (config.rateLimit?.max || 300) : 5000,

  standardHeaders: true,
  legacyHeaders: false,

  skip: (req) => {
    return (
      req.method === 'OPTIONS' ||
      req.path.includes('/health') ||
      req.path.includes('/api/docs') ||
      req.path.includes('/api/docs.json')
    );
  },

  message: {
    type: 'https://Bedo SimuLearn.com/errors/429',
    title: 'Too many requests',
    status: 429,
    detail: 'Too many requests, please try again later.',
  },
});

/**
 * Stricter limiter for sensitive authentication endpoints.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 20 : 1000,

  standardHeaders: true,
  legacyHeaders: false,

  skip: (req) => {
    return req.method === 'OPTIONS';
  },

  message: {
    type: 'https://Bedo SimuLearn.com/errors/429',
    title: 'Too many authentication attempts',
    status: 429,
    detail: 'Too many authentication requests, please try again later.',
  },
});

module.exports = {
  defaultLimiter,
  authLimiter,
};