'use strict';

/**
 * LTI platform admin routes — authenticated JSON API for registering and
 * managing LMS platform registrations, tool signing keys, and viewing launch
 * logs. The public LTI protocol endpoints (OIDC login/launch/JWKS) live in
 * lti-protocol.routes.js instead, since their auth model (browser redirects
 * from an external LMS, no Bearer token) is fundamentally different.
 *
 *   GET    /                          list (own institution, or all for super_admin)
 *   POST   /                          register a new platform
 *   GET    /:id                       get one (+ its deployments)
 *   PATCH  /:id                       update
 *   POST   /:id/activate              re-enable
 *   POST   /:id/deactivate            disable
 *   POST   /:id/deployments           add a deployment_id
 *   DELETE /:id/deployments/:deploymentId
 *   GET    /keys                      tool signing-key metadata (never private material)
 *   POST   /keys/rotate               rotate the tool's signing keypair
 *   GET    /launch-logs               recent LTI audit events
 */

const { Router } = require('express');
const c = require('./lti-platforms.controller');
const authenticate = require('../../middleware/authenticate');
const { requireAnyPermission, requirePermission } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const v = require('./lti-platforms.validators');

const router = Router();
router.use(authenticate);

const VIEW = ['lti_platforms.view_all', 'lti_platforms.view_own'];
const MANAGE = ['lti_platforms.manage_all', 'lti_platforms.manage_own'];

// Keys and launch-logs are fixed paths — must be registered before the
// param-based '/:id' routes to avoid being captured as an id.
router.get('/keys',         requirePermission('lti_keys.view'),   c.listKeys);
router.post('/keys/rotate', requirePermission('lti_keys.manage'), c.rotateKey);
router.get('/launch-logs',  requireAnyPermission('audit.view_platform', 'audit.view_institution'), c.listLaunchLogs);

router.get('/',      requireAnyPermission(...VIEW),   c.list);
router.post('/',     requireAnyPermission(...MANAGE), v.create, validate, c.create);
router.get('/:id',   requireAnyPermission(...VIEW),   c.getOne);
router.patch('/:id', requireAnyPermission(...MANAGE), v.update, validate, c.update);
router.post('/:id/activate',   requireAnyPermission(...MANAGE), c.activate);
router.post('/:id/deactivate', requireAnyPermission(...MANAGE), c.deactivate);

router.post('/:id/deployments',                     requireAnyPermission(...MANAGE), v.addDeployment, validate, c.addDeployment);
router.delete('/:id/deployments/:deploymentId',     requireAnyPermission(...MANAGE), c.removeDeployment);

module.exports = router;
