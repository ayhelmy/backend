'use strict';

/**
 * Audit log routes — SRS §4.15 AUD-01 to AUD-05 (read-only). RBAC v2.
 * GET /api/v1/audit-logs          — paginated, filterable (scoped by role)
 * GET /api/v1/audit-logs/:id      — single entry
 */

const { Router }   = require('express');
const auditController = require('./audit.controller');
const authenticate    = require('../../middleware/authenticate');
const { requireAnyPermission } = require('../../middleware/authorize');

const router = Router();
router.use(authenticate);

// All audit viewers: platform or institution level (match migration 015 permission codes)
router.use(requireAnyPermission('platform.audit.view', 'audit.view_institution'));

router.get('/',    auditController.list);
router.get('/:id', auditController.getOne);

module.exports = router;
