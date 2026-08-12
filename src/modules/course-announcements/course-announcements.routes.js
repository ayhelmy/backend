/**
 * Course announcements routes.
 * POST /api/v1/courses/:id/announcements — instructor-of-record or admin only
 * GET  /api/v1/courses/:id/announcements — anyone with course read access
 */
'use strict';

const { Router } = require('express');
const controller = require('./course-announcements.controller');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const validators = require('./course-announcements.validators');
const { requireCourseAccess, requireCourseOwnership } = require('../../middleware/scopeGuards');

const router = Router();
router.use(authenticate);

router.post('/:id/announcements', requireCourseOwnership, validators.create, validate, controller.create);
router.get('/:id/announcements',  requireCourseAccess(), controller.list);

module.exports = router;
