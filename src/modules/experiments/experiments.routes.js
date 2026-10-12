'use strict';

/**
 * FM103 LMS event-contract tracking (WEB-DEVELOPER-GUIDE.md schemaVersion 2.1,
 * plus a schema-1.0 legacy compatibility path — see event-normalizer.service.js).
 * Additive to, and independent of, the simulation-activity click/heatmap module.
 *
 *   POST /experiments/events       — ingest one event or { events: [...] }
 *   GET  /experiments/progress     — required-step % + question results for one attempt
 *   GET  /experiments/completion   — saved completion for (project, assessmentVersion, experiment)
 *   GET  /experiments/history      — the learner's own attempts across a project
 */

const { Router } = require('express');
const ctrl = require('./experiments.controller');
const authenticate = require('../../middleware/authenticate');
const { requirePermission } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const v = require('./experiments.validators');

// Mounted at /api/v1/experiments in app.js — all paths below are relative to that.
const router = Router();
router.use(authenticate);

router.post(
  '/events',
  requirePermission('lessons.view'),
  v.postEvents, validate,
  ctrl.postEvents,
);

router.get(
  '/progress',
  requirePermission('lessons.view'),
  v.getProgress, validate,
  ctrl.getProgress,
);

router.get(
  '/completion',
  requirePermission('lessons.view'),
  v.getCompletion, validate,
  ctrl.getCompletion,
);

router.get(
  '/history',
  requirePermission('lessons.view'),
  v.getHistory, validate,
  ctrl.getHistory,
);

module.exports = router;
