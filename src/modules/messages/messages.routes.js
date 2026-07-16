/**
 * Messages routes — SRS §4.13 MSG-01 to MSG-06.
 * GET  /api/v1/messages/threads
 * POST /api/v1/messages/threads
 * GET  /api/v1/messages/threads/:threadId
 * POST /api/v1/messages/threads/:threadId/messages
 * GET  /api/v1/messages/threads/:threadId/messages
 */
'use strict';

const { Router } = require('express');
const messagesController = require('./messages.controller');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const messagesValidators = require('./messages.validators');

const router = Router();
router.use(authenticate);

router.get('/threads',                         messagesController.listThreads);
router.post('/threads',                        messagesValidators.createThread, validate, messagesController.createThread);
router.get('/threads/:threadId',               messagesController.getThread);
router.get('/threads/:threadId/messages',      messagesController.listMessages);
router.post('/threads/:threadId/messages',     messagesValidators.sendMessage, validate, messagesController.sendMessage);

module.exports = router;
