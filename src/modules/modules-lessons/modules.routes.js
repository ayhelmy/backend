'use strict';

/**
 * Course modules & lessons routes — SRS §4.6 MOD-01 to MOD-08. RBAC v2.
 * Mounted under /api/v1/courses (nested resources).
 *
 * GET    /courses/:courseId/modules/tree                                  — full tree with nested lessons
 * GET    /courses/:courseId/modules                                       — module list
 * POST   /courses/:courseId/modules                                       — create module
 * PATCH  /courses/:courseId/modules/reorder                              — reorder modules
 * GET    /courses/:courseId/modules/:moduleId                            — get module
 * PATCH  /courses/:courseId/modules/:moduleId                            — update module
 * DELETE /courses/:courseId/modules/:moduleId                            — delete module
 * GET    /courses/:courseId/modules/:moduleId/lessons                    — list lessons
 * POST   /courses/:courseId/modules/:moduleId/lessons                    — create lesson
 * PATCH  /courses/:courseId/modules/:moduleId/lessons/reorder            — reorder lessons
 * PATCH  /courses/:courseId/modules/:moduleId/lessons/:lessonId          — update lesson
 * DELETE /courses/:courseId/modules/:moduleId/lessons/:lessonId          — delete lesson
 * POST   /courses/:courseId/modules/:moduleId/lessons/:lessonId/complete — mark complete
 * POST   /courses/:courseId/validate-simulation                          — validate simulation access
 */

const { Router }        = require('express');
const modulesController = require('./modules.controller');
const authenticate      = require('../../middleware/authenticate');
const { requirePermission } = require('../../middleware/authorize');
const validate          = require('../../middleware/validate');
const modulesValidators = require('./modules.validators');

const router = Router({ mergeParams: true });
router.use(authenticate);

// ── Course journey (MUST be before /:courseId/modules to avoid param capture) ─
router.get('/:courseId/journey',         requirePermission('lessons.view'),   modulesController.getCourseJourney);

// ── Course tree (MUST be before /:moduleId to avoid param capture) ────────────
router.get('/:courseId/modules/tree',    requirePermission('lessons.view'),   modulesController.getCourseTree);

// ── Modules ───────────────────────────────────────────────────────────────────
router.get('/:courseId/modules',         requirePermission('lessons.view'),   modulesController.listModules);
router.post('/:courseId/modules',        requirePermission('lessons.create'), modulesValidators.createModule, validate, modulesController.createModule);
// reorder MUST be before /:moduleId
router.patch('/:courseId/modules/reorder', requirePermission('lessons.update'), modulesValidators.reorder, validate, modulesController.reorderModules);
router.get('/:courseId/modules/:moduleId',    requirePermission('lessons.view'),   modulesController.getModule);
router.patch('/:courseId/modules/:moduleId',  requirePermission('lessons.update'), modulesValidators.updateModule, validate, modulesController.updateModule);
router.delete('/:courseId/modules/:moduleId', requirePermission('lessons.delete'), modulesController.removeModule);

// ── Lessons ───────────────────────────────────────────────────────────────────
router.get('/:courseId/modules/:moduleId/lessons',     requirePermission('lessons.view'),   modulesController.listLessons);
router.post('/:courseId/modules/:moduleId/lessons',    requirePermission('lessons.create'), modulesValidators.createLesson, validate, modulesController.createLesson);
// reorder MUST be before /:lessonId
router.patch('/:courseId/modules/:moduleId/lessons/reorder',           requirePermission('lessons.update'), modulesValidators.reorder, validate, modulesController.reorderLessons);
router.patch('/:courseId/modules/:moduleId/lessons/:lessonId',         requirePermission('lessons.update'), modulesValidators.updateLesson, validate, modulesController.updateLesson);
router.delete('/:courseId/modules/:moduleId/lessons/:lessonId',        requirePermission('lessons.delete'), modulesController.removeLesson);
// complete — any enrolled student can call this
router.post('/:courseId/modules/:moduleId/lessons/:lessonId/complete',  requirePermission('lessons.view'), modulesController.markLessonComplete);
// simulation-launch — course-safe launch endpoint (validates enrollment + build status)
router.get('/:courseId/lessons/:lessonId/simulation-launch',            requirePermission('lessons.view'), modulesController.getLessonSimulationLaunch);

// ── Simulation validation ─────────────────────────────────────────────────────
router.post('/:courseId/validate-simulation', requirePermission('lessons.create'), modulesController.validateSimulation);

module.exports = router;
