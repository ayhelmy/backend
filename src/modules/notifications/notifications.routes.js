/**
 * Notifications routes — SRS §4.12 NOT-01 to NOT-05.
 * GET    /api/v1/notifications                — list for current user (status/type/priority/page/page_size)
 * GET    /api/v1/notifications/unread-count    — badge count
 * PATCH  /api/v1/notifications/mark-all-read   — mark all current user notifications as read
 * PATCH  /api/v1/notifications/:id/read
 * PATCH  /api/v1/notifications/:id/archive
 * DELETE /api/v1/notifications/:id
 */
'use strict';

const { Router } = require('express');
const notificationsController = require('./notifications.controller');
const authenticate = require('../../middleware/authenticate');

const router = Router();
router.use(authenticate);

// Static segments must be registered before /:id to avoid param capture.
router.get('/unread-count',       notificationsController.unreadCount);
router.patch('/mark-all-read',    notificationsController.markAllRead);
router.post('/read-all',          notificationsController.markAllRead); // back-compat alias
router.get('/',                   notificationsController.list);
router.patch('/:id/read',         notificationsController.markRead);
router.patch('/:id/archive',      notificationsController.archive);
router.delete('/:id',             notificationsController.remove);

module.exports = router;
