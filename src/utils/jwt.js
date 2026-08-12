/**
 * JWT utility — sign access tokens and verify them.
 * SRS §7.1 Login Flow:
 *   - Access token: 15 min TTL, stored in client memory (never localStorage)
 *   - Payload: sub (userId), email, institutionId, roles[]
 */
'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Issue a short-lived access token.
 * @param {{ id: string, email: string, institutionId: string|null, roles: string[] }} user
 * @param {string} [expiresInOverride]  Overrides config.jwt.accessExpiresIn — used by
 *   the LTI session-exchange flow, which mints a longer-lived token (no refresh
 *   cookie is issued for LTI sessions, see utils/lti-launch-token.js).
 */
function signAccess(user, expiresInOverride) {
  return jwt.sign(
    {
      sub:           user.id,
      email:         user.email,
      institutionId: user.institutionId ?? null,
      roles:         user.roles,        // array of role name strings
    },
    config.jwt.accessSecret,
    { expiresIn: expiresInOverride || config.jwt.accessExpiresIn },
  );
}

/**
 * Verify an access token.
 * @throws {jwt.TokenExpiredError | jwt.JsonWebTokenError}
 */
function verifyAccess(token) {
  return jwt.verify(token, config.jwt.accessSecret);
}

module.exports = { signAccess, verifyAccess };
