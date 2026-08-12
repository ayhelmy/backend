/**
 * Mail routes — mailbox-style messaging (SRS "Messaging and Notifications").
 * GET    /api/v1/mail/inbox|sent|drafts|archived|trash
 * GET    /api/v1/mail/unread-count
 * GET    /api/v1/mail/folder-counts
 * GET    /api/v1/mail/recipients
 * GET    /api/v1/mail/messages/:messageId
 * POST   /api/v1/mail/messages
 * POST   /api/v1/mail/messages/:messageId/reply|reply-all|forward
 * PATCH  /api/v1/mail/messages/:messageId/read|unread|archive|restore
 * DELETE /api/v1/mail/messages/:messageId
 * POST   /api/v1/mail/drafts
 * PATCH  /api/v1/mail/drafts/:draftId
 * DELETE /api/v1/mail/drafts/:draftId
 * POST   /api/v1/mail/drafts/:draftId/send
 */
'use strict';

const { Router } = require('express');
const controller = require('./mail.controller');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const validators = require('./mail.validators');
const { requirePermission } = require('../../middleware/authorize');
const { handleMailAttachmentUpload } = require('../../middleware/upload');

const router = Router();
router.use(authenticate);
router.use(requirePermission('messages.view'));

// ── Folders + counts + recipients (static segments before any :param route) ──
router.get('/inbox',    controller.listInbox);
router.get('/sent',     controller.listSent);
router.get('/drafts',   controller.listDrafts);
router.get('/archived', controller.listArchived);
router.get('/trash',    controller.listTrash);

router.get('/unread-count',  controller.unreadCount);
router.get('/folder-counts', controller.folderCounts);
router.get('/recipients',    controller.listRecipients);

router.post('/attachments', requirePermission('messages.send'), handleMailAttachmentUpload, controller.uploadAttachment);

// ── Drafts ────────────────────────────────────────────────────────────────────
router.post('/drafts',                 validators.saveDraft, validate, controller.saveDraft);
router.patch('/drafts/:draftId',       validators.updateDraft, validate, controller.updateDraft);
router.delete('/drafts/:draftId',      controller.deleteDraft);
router.post('/drafts/:draftId/send',   controller.sendDraft);

// ── Compose / detail / actions ────────────────────────────────────────────────
router.post('/messages', requirePermission('messages.send'), validators.compose, validate, controller.compose);
router.get('/messages/:messageId', controller.getMessage);

router.post('/messages/:messageId/reply',     requirePermission('messages.send'), validators.reply, validate, controller.reply);
router.post('/messages/:messageId/reply-all', requirePermission('messages.send'), validators.reply, validate, controller.replyAll);
router.post('/messages/:messageId/forward',   requirePermission('messages.send'), validators.forward, validate, controller.forward);

router.patch('/messages/:messageId/read',     controller.markRead);
router.patch('/messages/:messageId/unread',   controller.markUnread);
router.patch('/messages/:messageId/archive',  controller.archive);
router.patch('/messages/:messageId/restore',  controller.restore);
router.delete('/messages/:messageId',         controller.remove);

module.exports = router;
