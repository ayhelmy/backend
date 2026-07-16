/**
 * Auth input validators (express-validator).
 * SRS §4.1 AUTH-01: password must be ≥8 chars with at least 1 uppercase, 1 digit.
 * SRS §4.1 AUTH-08: email normalised to lowercase for consistent lookup.
 */
'use strict';

const { body } = require('express-validator');

// Password rules shared between register and reset
const passwordRules = body('password')
  .isLength({ min: 8 })
  .withMessage('Password must be at least 8 characters.')
  .matches(/[A-Z]/)
  .withMessage('Password must contain at least one uppercase letter.')
  .matches(/[0-9]/)
  .withMessage('Password must contain at least one number.');

exports.register = [
  body('email')
    .isEmail().withMessage('A valid email address is required.')
    .normalizeEmail(),
  passwordRules,
  body('firstName')
    .trim().notEmpty().withMessage('First name is required.')
    .isLength({ max: 100 }).withMessage('First name must be 100 characters or fewer.'),
  body('lastName')
    .trim().notEmpty().withMessage('Last name is required.')
    .isLength({ max: 100 }).withMessage('Last name must be 100 characters or fewer.'),
];

exports.login = [
  body('email').isEmail().withMessage('A valid email is required.').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required.'),
];

exports.forgotPassword = [
  body('email').isEmail().withMessage('A valid email is required.').normalizeEmail(),
];

exports.resetPassword = [
  body('token').notEmpty().withMessage('Reset token is required.'),
  passwordRules,
];

exports.verifyEmail = [
  body('token').notEmpty().withMessage('Verification token is required.'),
];

exports.resendVerification = [
  body('email').isEmail().withMessage('A valid email is required.').normalizeEmail(),
];
