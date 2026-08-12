/**
 * Short-lived token minted after a validated LTI launch, carried via redirect
 * query param to /lti/launching so the frontend can fetch launch details.
 *
 * Deliberately NOT signAccess/verifyAccess (utils/jwt.js): those encode a
 * trusted SimuLearn user identity {sub,email,institutionId,roles} and are
 * accepted anywhere the generic `authenticate` middleware runs. A launch
 * token carries an external LTI subject (platform-issued, not a SimuLearn
 * user id) and must never be usable as a session token — using a separate
 * signing secret/function makes that structurally impossible.
 */
'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

function signLaunchToken(payload) {
  return jwt.sign(payload, config.lti.launchTokenSecret, {
    expiresIn: config.lti.launchTokenTtl,
  });
}

function verifyLaunchToken(token) {
  return jwt.verify(token, config.lti.launchTokenSecret);
}

module.exports = { signLaunchToken, verifyLaunchToken };
