'use strict';

/**
 * Authenticated "Resync Grade" endpoint for the instructor dashboard —
 * matches the spec's POST /api/v1/lti/ags/sync-score contract. Distinct from
 * lti-protocol.routes.js (public, unauthenticated LTI protocol endpoints):
 * this is a normal JSON API guarded by the same simulation_scores.manage
 * permission instructors already have for grading.
 */

const { Router } = require('express');
const { body } = require('express-validator');
const authenticate = require('../../middleware/authenticate');
const { requireAnyPermission } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const ApiResponse = require('../../utils/apiResponse');
const ApiError = require('../../utils/apiError');
const { SimulationScoreModel, CourseModel } = require('../../db/models');
const agsService = require('./ags.service');

const router = Router();
router.use(authenticate);

router.post(
  '/sync-score',
  requireAnyPermission('simulation_scores.manage'),
  body('scoreId').isUUID().withMessage('scoreId must be a valid UUID'),
  validate,
  async (req, res, next) => {
    try {
      const score = await SimulationScoreModel.findById(req.body.scoreId);
      if (!score) throw ApiError.notFound('Simulation score not found.');

      const course = await CourseModel.findById(score.course_id);
      if (!course) throw ApiError.notFound('Simulation score not found.');
      if (!req.user.roles?.includes('super_admin') && course.institution_id !== req.user.institutionId) {
        throw ApiError.notFound('Simulation score not found.');
      }

      const updated = await agsService.syncScoreToAgs(score.id);
      if (!updated) {
        throw ApiError.badRequest('This score is not linked to an LMS gradebook column.');
      }

      ApiResponse.ok(res, 'Grade sync attempted', {
        id: updated.id,
        agsSyncStatus: updated.ags_sync_status,
        agsLastSyncAt: updated.ags_last_sync_at,
        agsLastError: updated.ags_last_error,
        agsRetryCount: updated.ags_retry_count,
      });
    } catch (e) { next(e); }
  },
);

module.exports = router;
