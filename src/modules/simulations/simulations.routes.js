'use strict';

/**
 * Simulations routes — SRS §4.7 SIM-01 to SIM-10. RBAC v2.
 *
 * Public (optionalAuth — guests see demo_public only):
 *   GET  /demo                          list demo simulations (no auth required)
 *   POST /:id/demo-launch               launch demo simulation (no auth required)
 *   GET  /                              list (filtered by role/scope via service)
 *   GET  /:id                           get one (visibility-gated in service)
 *   GET  /:id/preview                   preview URL (visibility-gated)
 *
 * Super Admin (simulation_catalogs.manage_global):
 *   POST   /                            create simulation
 *   PATCH  /:id                         update simulation
 *   DELETE /:id                         delete simulation
 *
 * Authenticated launch (any logged-in user):
 *   POST /:id/launch                    launch with full access-control enforcement
 *
 * Institution assignment (assign_to_institution):
 *   POST   /:id/institutions/:instId    assign simulation visibility to institution
 *   DELETE /:id/institutions/:instId    revoke
 */

const { Router }            = require('express');
const simulationsController = require('./simulations.controller');
const authenticate          = require('../../middleware/authenticate');
const { optionalAuth }      = require('../../middleware/scopeGuards');
const { requirePermission, requireAnyPermission } = require('../../middleware/authorize');
const validate              = require('../../middleware/validate');
const v                     = require('./simulations.validators');

const router = Router();

// ── Demo routes (no auth required) ───────────────────────────────────────────
// Register before /:id to avoid param collision
router.get('/demo',             simulationsController.listDemo);
router.post('/:id/demo-launch', simulationsController.demoLaunch);

// ── Authenticated launch ──────────────────────────────────────────────────────
router.post('/:id/launch', authenticate, simulationsController.launch);

// ── Browsing (optionalAuth: guests get demo only, auth users get scoped list) ─
router.get('/',        optionalAuth, simulationsController.list);
router.get('/:id',     optionalAuth, simulationsController.getOne);
router.get('/:id/preview', optionalAuth, simulationsController.preview);

// ── Management (super_admin only) ─────────────────────────────────────────────
router.post('/',     authenticate, requirePermission('simulation_catalogs.manage_global'), v.create, validate, simulationsController.create);
router.patch('/:id', authenticate, requirePermission('simulation_catalogs.manage_global'), v.update, validate, simulationsController.update);
router.delete('/:id',authenticate, requirePermission('simulation_catalogs.manage_global'), simulationsController.remove);

// ── Legacy institution-level assignment ───────────────────────────────────────
router.post('/:id/institutions/:instId',   authenticate, requireAnyPermission('simulation_catalogs.assign_to_institution', 'simulation_catalogs.manage_global'), simulationsController.assignToInstitution);
router.delete('/:id/institutions/:instId', authenticate, requireAnyPermission('simulation_catalogs.assign_to_institution', 'simulation_catalogs.manage_global'), simulationsController.revokeFromInstitution);

module.exports = router;
