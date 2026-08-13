'use strict';

/**
 * Simulation Activity routes
 *
 * Start session (course+lesson context):
 *   POST /courses/:courseId/lessons/:lessonId/simulation-activity/start
 *
 * Session lifecycle:
 *   POST /simulation-activity/:sessionId/heartbeat
 *   POST /simulation-activity/:sessionId/end
 *
 * Student self-service:
 *   GET  /users/me/simulation-activity
 *   GET  /lessons/:lessonId/simulation-activity/latest   — last session for lesson (home page)
 *
 * Instructor/admin views:
 *   GET  /courses/:courseId/simulation-activity
 *   GET  /courses/:courseId/lessons/:lessonId/simulation-activity
 *
 * Admin cleanup:
 *   POST /simulation-activity/cleanup   (super_admin only)
 */

const { Router }   = require('express');
const ctrl         = require('./activity.controller');
const authenticate = require('../../middleware/authenticate');
const { requirePermission, authorize } = require('../../middleware/authorize');
const validate     = require('../../middleware/validate');
const v            = require('./activity.validators');

const router = Router({ mergeParams: true });

// ── Start a session ───────────────────────────────────────────────────────────
router.post(
  '/courses/:courseId/lessons/:lessonId/simulation-activity/start',
  authenticate,
  requirePermission('lessons.view'),
  v.start, validate,
  ctrl.start,
);

// ── Heartbeat ─────────────────────────────────────────────────────────────────
router.post(
  '/simulation-activity/:sessionId/heartbeat',
  authenticate,
  requirePermission('lessons.view'),
  ctrl.heartbeat,
);

// ── End session ───────────────────────────────────────────────────────────────
router.post(
  '/simulation-activity/:sessionId/end',
  authenticate,
  requirePermission('lessons.view'),
  v.end, validate,
  ctrl.end,
);

// ── Student: own activity history ─────────────────────────────────────────────
router.get(
  '/users/me/simulation-activity',
  authenticate,
  requirePermission('lessons.view'),
  v.listActivity, validate,
  ctrl.listMyActivity,
);

// ── Student: latest session for a specific lesson (used by course home page) ──
router.get(
  '/lessons/:lessonId/simulation-activity/latest',
  authenticate,
  requirePermission('lessons.view'),
  ctrl.getLatestSessionForLesson,
);

// ── Instructor/admin: all activity for a course ───────────────────────────────
router.get(
  '/courses/:courseId/simulation-activity',
  authenticate,
  requirePermission('lessons.view'),
  v.listActivity, validate,
  ctrl.listCourseActivity,
);

// ── Instructor/admin: activity for a specific lesson ──────────────────────────
router.get(
  '/courses/:courseId/lessons/:lessonId/simulation-activity',
  authenticate,
  requirePermission('lessons.view'),
  v.listActivity, validate,
  ctrl.listLessonActivity,
);

// ── Simulation-level analytics ────────────────────────────────────────────────
router.get(
  '/courses/:courseId/simulations/:simulationId/analytics',
  authenticate,
  requirePermission('lessons.view'),
  ctrl.getSimulationAnalytics,
);

// ── Click tracking ────────────────────────────────────────────────────────────
router.post(
  '/simulation-activity/:sessionId/clicks',
  authenticate,
  requirePermission('lessons.view'),
  v.recordClicks, validate,
  ctrl.recordClicks,
);

router.get(
  '/simulation-activity/:sessionId/clicks/csv',
  authenticate,
  requirePermission('lessons.view'),
  ctrl.downloadClicksCsv,
);

router.get(
  '/simulation-activity/:sessionId/click-events',
  authenticate,
  requirePermission('lessons.view'),
  ctrl.getClickEvents,
);

router.get(
  '/simulation-activity/:sessionId/click-stats',
  authenticate,
  requirePermission('lessons.view'),
  ctrl.getClickStats,
);

router.get(
  '/simulation-activity/:sessionId/steps',
  authenticate,
  requirePermission('lessons.view'),
  ctrl.getStepBreakdown,
);

// ── Admin: cleanup stale sessions (super_admin only) ─────────────────────────
router.post(
  '/simulation-activity/cleanup',
  authenticate,
  authorize('super_admin'),
  ctrl.cleanupStaleSessions,
);

module.exports = router;
