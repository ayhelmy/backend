'use strict';

/**
 * Page Content routes.
 *
 * Public (no auth):
 *   GET  /api/v1/page-content/stats          — live platform statistics
 *   GET  /api/v1/page-content/home-page      — aggregated public home page payload
 *   GET  /api/v1/page-content/:page          — active content for a page (why_bedo|about|resources|home)
 *
 * Admin (super_admin only):
 *   GET    /api/v1/page-content/:page/admin  — all items incl. inactive
 *   POST   /api/v1/page-content/items        — create a new item
 *   PUT    /api/v1/page-content/items/:id    — update an item
 *   DELETE /api/v1/page-content/items/:id    — delete an item
 *   PATCH  /api/v1/page-content/stats        — update the uptime stat
 */

const { Router }      = require('express');
const ctrl            = require('./page-content.controller');
const authenticate    = require('../../middleware/authenticate');
const { authorize }   = require('../../middleware/authorize');

const router = Router();

// ── Public ────────────────────────────────────────────────────────────────────
// '/home-page' and '/stats' must be registered before the '/:page' catch-all.
router.get('/stats',          ctrl.getPlatformStats);
router.get('/home-page',      ctrl.getHomePage);
router.get('/:page',          ctrl.getPageContent);

// ── Admin — all routes below require auth + super_admin role ──────────────────
router.use(authenticate, authorize('super_admin'));

router.get('/:page/admin',    ctrl.getAllForAdmin);
router.post('/items',         ctrl.createItem);
router.put('/items/:id',      ctrl.updateItem);
router.delete('/items/:id',   ctrl.deleteItem);
router.patch('/stats',        ctrl.updateStats);

module.exports = router;
