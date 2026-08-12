/**
 * LTI protocol errors — distinct from ApiError because /lti/login and
 * /lti/launch respond with browser redirects (302 to /lti/error?code=...),
 * not JSON error bodies. lti-protocol.controller.js catches LtiError and
 * builds the redirect; every other error path (admin CRUD) still uses
 * ApiError/RFC 7807 as normal.
 */
'use strict';

const LTI_ERROR_CODES = Object.freeze({
  INVALID_REQUEST:          'INVALID_REQUEST',
  UNKNOWN_PLATFORM:         'UNKNOWN_PLATFORM',
  UNKNOWN_DEPLOYMENT:       'UNKNOWN_DEPLOYMENT',
  STATE_NOT_FOUND:          'STATE_NOT_FOUND',
  STATE_EXPIRED:            'STATE_EXPIRED',
  NONCE_MISMATCH:           'NONCE_MISMATCH',
  SIGNATURE_INVALID:        'SIGNATURE_INVALID',
  JWKS_FETCH_FAILED:        'JWKS_FETCH_FAILED',
  CLAIM_VALIDATION_FAILED:  'CLAIM_VALIDATION_FAILED',
  UNSUPPORTED_MESSAGE_TYPE: 'UNSUPPORTED_MESSAGE_TYPE',
  CONTEXT_NOT_PROVISIONED:  'CONTEXT_NOT_PROVISIONED',
  SIMULATION_NOT_ASSIGNED:  'SIMULATION_NOT_ASSIGNED',
  SIMULATION_NOT_FOUND:     'SIMULATION_NOT_FOUND',
  UNAUTHORIZED_ROLE:        'UNAUTHORIZED_ROLE',
  INTERNAL_ERROR:           'INTERNAL_ERROR',
});

const DEFAULT_MESSAGES = {
  [LTI_ERROR_CODES.INVALID_REQUEST]:          'The LTI request was missing required parameters.',
  [LTI_ERROR_CODES.UNKNOWN_PLATFORM]:         'No LTI platform is registered for this issuer/client.',
  [LTI_ERROR_CODES.UNKNOWN_DEPLOYMENT]:       'This deployment is not registered for the platform.',
  [LTI_ERROR_CODES.STATE_NOT_FOUND]:          'The login session could not be found. Please relaunch from the LMS.',
  [LTI_ERROR_CODES.STATE_EXPIRED]:            'The login session expired or was already used. Please relaunch from the LMS.',
  [LTI_ERROR_CODES.NONCE_MISMATCH]:           'The launch nonce did not match — possible replay attempt.',
  [LTI_ERROR_CODES.SIGNATURE_INVALID]:        'The launch token signature could not be verified.',
  [LTI_ERROR_CODES.JWKS_FETCH_FAILED]:        'Could not retrieve the platform\'s public keys.',
  [LTI_ERROR_CODES.CLAIM_VALIDATION_FAILED]:  'The launch token is missing required claims.',
  [LTI_ERROR_CODES.UNSUPPORTED_MESSAGE_TYPE]: 'This LTI message type is not supported yet.',
  [LTI_ERROR_CODES.CONTEXT_NOT_PROVISIONED]:  'This course was not set up through SimuLearn\'s content selection. Please ask your instructor to re-add this activity via "External Tool" > SimuLearn in your LMS.',
  [LTI_ERROR_CODES.SIMULATION_NOT_ASSIGNED]:  'This simulation is not assigned to your institution. Please contact your LMS administrator or SimuLearn administrator.',
  [LTI_ERROR_CODES.SIMULATION_NOT_FOUND]:     'This simulation could not be found or is no longer active.',
  [LTI_ERROR_CODES.UNAUTHORIZED_ROLE]:        'Your role is not authorized to perform this action.',
  [LTI_ERROR_CODES.INTERNAL_ERROR]:           'An unexpected error occurred while processing the LTI request.',
};

class LtiError extends Error {
  /**
   * @param {string} code    one of LTI_ERROR_CODES
   * @param {string} [message]
   */
  constructor(code, message) {
    super(message || DEFAULT_MESSAGES[code] || 'LTI error.');
    this.code = code;
    this.isLtiError = true;
  }
}

module.exports = { LtiError, LTI_ERROR_CODES };
