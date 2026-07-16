'use strict';

/**
 * Settings routes — SRS §4.16 SET-01 to SET-05. RBAC v2.
 * GET   /api/v1/settings/institution   — institution settings
 * PATCH /api/v1/settings/institution
 * GET   /api/v1/settings/user          — current user preferences
 * PATCH /api/v1/settings/user
 */

const { Router }   = require('express');
const settingsController  = require('./settings.controller');
const authenticate        = require('../../middleware/authenticate');
const { requireAnyPermission } = require('../../middleware/authorize');
const validate            = require('../../middleware/validate');
const settingsValidators  = require('./settings.validators');

const router = Router();
router.use(authenticate);

router.get('/institution',
  requireAnyPermission('institutions.manage_own', 'platform.settings.manage'),
  settingsController.getInstitution,
);
router.patch('/institution',
  requireAnyPermission('institutions.manage_own', 'platform.settings.manage'),
  settingsValidators.updateInstitution, validate,
  settingsController.updateInstitution,
);

// User preferences — any authenticated user
router.get('/user',   settingsController.getUserSettings);
router.patch('/user', settingsValidators.updateUser, validate, settingsController.updateUserSettings);

module.exports = router;
