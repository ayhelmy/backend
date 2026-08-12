/**
 * Auth routes — SRS §4.1 AUTH-01 to AUTH-08, §10.1 Auth API.
 *
 * POST /api/v1/auth/register               AUTH-01
 * POST /api/v1/auth/verify-email           AUTH-01
 * POST /api/v1/auth/resend-verification    AUTH-01 (re-send expired link)
 * POST /api/v1/auth/login                  AUTH-02
 * POST /api/v1/auth/logout                 AUTH-06
 * POST /api/v1/auth/refresh                AUTH-05
 * POST /api/v1/auth/forgot-password        AUTH-05
 * POST /api/v1/auth/reset-password         AUTH-05
 * GET  /api/v1/auth/me                     AUTH-03
 */
'use strict';

const { Router } = require('express');
const authController  = require('./auth.controller');
const { authLimiter } = require('../../middleware/rateLimiter');
const authenticate    = require('../../middleware/authenticate');
const validate        = require('../../middleware/validate');
const authValidators  = require('./auth.validators');

const router = Router();

router.post('/register',
  authLimiter, authValidators.register, validate, authController.register);

router.post('/verify-email',
  authValidators.verifyEmail, validate, authController.verifyEmail);

router.post('/resend-verification',
  authLimiter, authValidators.resendVerification, validate, authController.resendVerification);

router.post('/login',
  authLimiter, authValidators.login, validate, authController.login);

router.post('/logout',
  authenticate, authController.logout);

router.post('/refresh',
  authLimiter, authController.refresh);

router.post('/forgot-password',
  authLimiter, authValidators.forgotPassword, validate, authController.forgotPassword);

router.post('/reset-password',
  authLimiter, authValidators.resetPassword, validate, authController.resetPassword);

router.get('/me',
  authenticate, authController.me);

module.exports = router;
