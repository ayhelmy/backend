/**
 * Notification preferences routes.
 * GET   /api/v1/notification-preferences
 * PATCH /api/v1/notification-preferences
 */
'use strict';

const { Router } = require('express');
const controller = require('./notification-preferences.controller');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const validators = require('./notification-preferences.validators');

const router = Router();
router.use(authenticate);

router.get('/',    controller.get);
router.patch('/',  validators.update, validate, controller.update);

module.exports = router;
