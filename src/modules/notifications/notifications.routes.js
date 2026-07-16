/**
 * Notifications routes — SRS §4.12 NOT-01 to NOT-05.
 * GET   /api/v1/notifications          — list for current user
 * PATCH /api/v1/notifications/:id/read
 * POST  /api/v1/notifications/read-all
 * DELETE /api/v1/notifications/:id
 */
'use strict';

const { Router } = require('express');
const notificationsController = require('./notifications.controller');
const authenticate = require('../../middleware/authenticate');

const router = Router();
router.use(authenticate);

router.get('/',              notificationsController.list);
router.patch('/:id/read',    notificationsController.markRead);
router.post('/read-all',     notificationsController.markAllRead);
router.delete('/:id',        notificationsController.remove);

module.exports = router;
