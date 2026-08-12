'use strict';

/**
 * Authenticated NRPS roster-sync trigger for the instructor dashboard —
 * matches the spec's POST /api/v1/lti/nrps/sync-roster contract.
 */

const { Router } = require('express');
const { body } = require('express-validator');
const authenticate = require('../../middleware/authenticate');
const { requireAnyPermission } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const ApiResponse = require('../../utils/apiResponse');
const nrpsService = require('./nrps.service');

const router = Router();
router.use(authenticate);

router.post(
  '/sync-roster',
  requireAnyPermission('courses.manage_enrollments', 'courses.update_own'),
  body('courseId').isUUID().withMessage('courseId must be a valid UUID'),
  validate,
  async (req, res, next) => {
    try {
      const result = await nrpsService.syncRoster(req.body.courseId, req.user);
      ApiResponse.ok(res, 'Roster synced', result);
    } catch (e) { next(e); }
  },
);

module.exports = router;
