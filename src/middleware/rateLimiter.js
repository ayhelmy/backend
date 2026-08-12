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

/**
 * Limiter for QTI package import — bulk parsing/DB-writing operation, stricter
 * than the default limiter but not as tight as auth (legitimate instructors may
 * import several question banks in a session).
 */
const qtiImportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 10 : 500,

  standardHeaders: true,
  legacyHeaders: false,

  skip: (req) => req.method === 'OPTIONS',

  message: {
    type: 'https://Bedo SimuLearn.com/errors/429',
    title: 'Too many import requests',
    status: 429,
    detail: 'Too many QTI import requests, please try again later.',
  },
});

/**
 * Limiter for the public LTI OIDC login/launch endpoints. Generous compared
 * to authLimiter: legitimate traffic here is many distinct students each
 * making one login + one launch request through the same LMS during a class
 * period, not repeated attempts by a single bad actor.
 */
const ltiLaunchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 300 : 5000,

  standardHeaders: true,
  legacyHeaders: false,

  skip: (req) => req.method === 'OPTIONS',

  message: {
    type: 'https://Bedo SimuLearn.com/errors/429',
    title: 'Too many LTI launch requests',
    status: 429,
    detail: 'Too many LTI launch requests, please try again later.',
  },
});

module.exports = {
  defaultLimiter,
  authLimiter,
  qtiImportLimiter,
  ltiLaunchLimiter,
};