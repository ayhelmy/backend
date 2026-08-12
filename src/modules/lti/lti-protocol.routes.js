'use strict';

/**
 * Public LTI 1.3 protocol endpoints. No `authenticate` — these are hit
 * directly by the LMS platform (OIDC redirects, form_post launches) or by an
 * LMS's JWKS-fetching HTTP client, never by a logged-in SimuLearn browser
 * session. Rate-limited via ltiLaunchLimiter, registered in app.js before the
 * blanket defaultLimiter (mirrors the existing /auth/* authLimiter pattern).
 *
 *   GET/POST /lti/login                  OIDC third-party-initiated login
 *   POST     /lti/launch                 Receives the platform's id_token (resource-link or deep-linking)
 *   GET      /lti/jwks.json              Tool's public JWKS
 *   GET      /lti/launch-details         Backs the /lti/launching frontend page (debug/info)
 *   GET      /lti/deep-linking/context   Backs the /lti/deep-linking picker page
 *   POST     /lti/deep-linking/response  Builds the signed Deep Linking response JWT
 *   GET      /lti/session-exchange       Resource-link launch -> real SimuLearn session
 */

const { Router } = require('express');
const c = require('./lti-protocol.controller');

const router = Router();

router.get('/login', c.login);
router.post('/login', c.login);
router.post('/launch', c.launch);
router.get('/jwks.json', c.jwks);
router.get('/launch-details', c.launchDetails);
router.get('/deep-linking/context', c.deepLinkingContext);
router.post('/deep-linking/response', c.deepLinkingResponse);
router.get('/session-exchange', c.sessionExchange);

module.exports = router;
