'use strict';

/**
 * Simulation scores routes — Phase 1 (CRUD + manual instructor entry).
 * Mounted under /api/v1/courses. The Unity postMessage bridge auto-score path
 * is Phase 3.
 *
 * GET   /courses/:courseId/simulation-scores      — simulation_scores.view_course/view_own
 * POST  /courses/:courseId/simulation-scores      — simulation_scores.manage
 * GET   /courses/:courseId/simulation-scores/:id  — simulation_scores.view_course/view_own
 * PATCH /courses/:courseId/simulation-scores/:id  — simulation_scores.manage
 */

const { Router } = require('express');
const scoresController = require('./simulation-scores.controller');
const authenticate = require('../../middleware/authenticate');
const { requirePermission, requireAnyPermission } = require('../../middleware/authorize');
const { requireCourseAccess } = require('../../middleware/scopeGuards');
const validate = require('../../middleware/validate');
const scoresValidators = require('./simulation-scores.validators');

const router = Router({ mergeParams: true });
router.use(authenticate);

router.get('/:courseId/simulation-scores',
  requireAnyPermission('simulation_scores.view_course', 'simulation_scores.view_own'),
  requireCourseAccess(),
  scoresController.listByCourse,
);

router.post('/:courseId/simulation-scores',
  requirePermission('simulation_scores.manage'),
  requireCourseAccess('simulation_scores.manage'),
  scoresValidators.createManualScore, validate,
  scoresController.createManualScore,
);

router.get('/:courseId/simulation-scores/:id',
  requireAnyPermission('simulation_scores.view_course', 'simulation_scores.view_own'),
  requireCourseAccess(),
  scoresController.getById,
);

router.patch('/:courseId/simulation-scores/:id',
  requirePermission('simulation_scores.manage'),
  requireCourseAccess('simulation_scores.manage'),
  scoresValidators.updateScore, validate,
  scoresController.updateScore,
);

module.exports = router;
