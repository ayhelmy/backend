'use strict';

/**
 * Quizzes routes — Phase 1 (authoring CRUD + question management). RBAC: see
 * migration 051_quiz_permissions.sql. Mounted under /api/v1/courses.
 *
 * GET    /courses/:courseId/quizzes                                    — quizzes.view_course/view_own
 * POST   /courses/:courseId/quizzes                                    — quizzes.create
 * GET    /courses/:courseId/quizzes/:quizId                            — quizzes.view_course/view_own
 * PATCH  /courses/:courseId/quizzes/:quizId                            — quizzes.update
 * DELETE /courses/:courseId/quizzes/:quizId                            — quizzes.delete
 * POST   /courses/:courseId/quizzes/:quizId/publish                   — quizzes.publish
 * GET    /courses/:courseId/quizzes/:quizId/questions                 — quizzes.view_course/view_own
 * POST   /courses/:courseId/quizzes/:quizId/questions                 — quizzes.update
 * PATCH  /courses/:courseId/quizzes/:quizId/questions/reorder         — quizzes.update
 * PATCH  /courses/:courseId/quizzes/:quizId/questions/:questionId     — quizzes.update
 * DELETE /courses/:courseId/quizzes/:quizId/questions/:questionId     — quizzes.update
 */

const { Router } = require('express');
const quizzesController = require('./quizzes.controller');
const authenticate = require('../../middleware/authenticate');
const { requirePermission, requireAnyPermission } = require('../../middleware/authorize');
const { requireCourseAccess } = require('../../middleware/scopeGuards');
const validate = require('../../middleware/validate');
const quizzesValidators = require('./quizzes.validators');
const { handleQtiUpload } = require('../../middleware/upload');
const { qtiImportLimiter } = require('../../middleware/rateLimiter');

const router = Router({ mergeParams: true });
router.use(authenticate);

// ── Quiz management ───────────────────────────────────────────────────────────
router.get('/:courseId/quizzes',
  requireAnyPermission('quizzes.view_course', 'quizzes.view_own'),
  requireCourseAccess(),
  quizzesController.listQuizzes,
);
router.post('/:courseId/quizzes',
  requirePermission('quizzes.create'),
  requireCourseAccess('quizzes.create'),
  quizzesValidators.createQuiz, validate,
  quizzesController.createQuiz,
);

// ── QTI import/export ──────────────────────────────────────────────────────
// import-qti (new quiz) MUST be before /:quizId routes to avoid param capture.
router.post('/:courseId/quizzes/import-qti',
  qtiImportLimiter,
  requirePermission('quizzes.create'),
  requireCourseAccess('quizzes.create'),
  handleQtiUpload,
  quizzesValidators.importQti, validate,
  quizzesController.importQtiNewQuiz,
);

router.get('/:courseId/quizzes/:quizId',
  requireAnyPermission('quizzes.view_course', 'quizzes.view_own'),
  requireCourseAccess(),
  quizzesController.getQuiz,
);
router.patch('/:courseId/quizzes/:quizId',
  requirePermission('quizzes.update'),
  requireCourseAccess('quizzes.update'),
  quizzesValidators.updateQuiz, validate,
  quizzesController.updateQuiz,
);
router.delete('/:courseId/quizzes/:quizId',
  requirePermission('quizzes.delete'),
  requireCourseAccess('quizzes.delete'),
  quizzesController.deleteQuiz,
);
router.post('/:courseId/quizzes/:quizId/publish',
  requirePermission('quizzes.publish'),
  requireCourseAccess('quizzes.publish'),
  quizzesController.publishQuiz,
);
router.post('/:courseId/quizzes/:quizId/import-qti',
  qtiImportLimiter,
  requirePermission('quizzes.update'),
  requireCourseAccess('quizzes.update'),
  handleQtiUpload,
  quizzesValidators.importQti, validate,
  quizzesController.importQtiIntoQuiz,
);
router.get('/:courseId/quizzes/:quizId/export-qti',
  requireAnyPermission('quizzes.view_course', 'quizzes.view_own'),
  requireCourseAccess(),
  quizzesController.exportQti,
);

// ── Question management ───────────────────────────────────────────────────────
router.get('/:courseId/quizzes/:quizId/questions',
  requireAnyPermission('quizzes.view_course', 'quizzes.view_own'),
  requireCourseAccess(),
  quizzesController.listQuestions,
);
router.post('/:courseId/quizzes/:quizId/questions',
  requirePermission('quizzes.update'),
  requireCourseAccess('quizzes.update'),
  quizzesValidators.createQuestion, validate,
  quizzesController.createQuestion,
);
// reorder MUST be before /:questionId to avoid param capture
router.patch('/:courseId/quizzes/:quizId/questions/reorder',
  requirePermission('quizzes.update'),
  requireCourseAccess('quizzes.update'),
  quizzesValidators.reorderQuestions, validate,
  quizzesController.reorderQuestions,
);
router.patch('/:courseId/quizzes/:quizId/questions/:questionId',
  requirePermission('quizzes.update'),
  requireCourseAccess('quizzes.update'),
  quizzesValidators.updateQuestion, validate,
  quizzesController.updateQuestion,
);
router.delete('/:courseId/quizzes/:quizId/questions/:questionId',
  requirePermission('quizzes.update'),
  requireCourseAccess('quizzes.update'),
  quizzesController.deleteQuestion,
);

module.exports = router;
