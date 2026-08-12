'use strict';

const { body } = require('express-validator');

exports.create = [
  body('institutionId').optional().isUUID().withMessage('institutionId must be a valid UUID'),
  body('platformName').trim().notEmpty().withMessage('Platform name is required'),
  body('issuer').trim().notEmpty().withMessage('Issuer is required'),
  body('clientId').trim().notEmpty().withMessage('Client ID is required'),
  body('authLoginUrl').isURL({ require_tld: false }).withMessage('authLoginUrl must be a valid URL'),
  body('authTokenUrl').isURL({ require_tld: false }).withMessage('authTokenUrl must be a valid URL'),
  body('jwksUrl').isURL({ require_tld: false }).withMessage('jwksUrl must be a valid URL'),
];

exports.update = [
  body('platformName').optional().trim().notEmpty(),
  body('issuer').optional().trim().notEmpty(),
  body('clientId').optional().trim().notEmpty(),
  body('authLoginUrl').optional().isURL({ require_tld: false }),
  body('authTokenUrl').optional().isURL({ require_tld: false }),
  body('jwksUrl').optional().isURL({ require_tld: false }),
];

exports.addDeployment = [
  body('deploymentId').trim().notEmpty().withMessage('deploymentId is required'),
  body('label').optional().trim(),
];
