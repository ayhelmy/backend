'use strict';

/**
 * Quiz attempts routes — read/list scaffolding plus the attempt-taking
 * lifecycle. Mounted under /api/v1/courses.
 *
 * GET   /courses/:courseId/quizzes/:quizId/attempts          — quiz_attempts.view_course/view_own
 * GET   /courses/:courseId/quizzes/:quizId/attempts/me       — quiz_attempts.view_own (MUST be before /:attemptId)
 * POST  /courses/:courseId/quizzes/:quizId/attempts          — quiz_attempts.view_own (start/resume)
 * GET   /courses/:courseId/quizzes/:quizId/attempts/:id      — quiz_attempts.view_course/view_own
 * PATCH /courses/:courseId/quiz-attempts/:attemptId/responses — quiz_attempts.view_own (save)
 * POST  /courses/:courseId/quiz-attempts/:attemptId/submit    — quiz_attempts.view_own (submit)
 * PATCH /courses/:courseId/quiz-attempts/:attemptId/grade     — quiz_attempts.manage (manual grading)
 */

const { Router } = require('express');
const attemptsController = require('./quiz-attempts.controller');
const authenticate = require('../../middleware/authenticate');
const { requirePermission, requireAnyPermission } = require('../../middleware/authorize');
const { requireCourseAccess } = require('../../middleware/scopeGuards');
const validate = require('../../middleware/validate');
const attemptsValidators = require('./quiz-attempts.validators');

const router = Router({ mergeParams: true });
router.use(authenticate);

router.get('/:courseId/quizzes/:quizId/attempts',
  requireAnyPermission('quiz_attempts.view_course', 'quiz_attempts.view_own'),
  requireCourseAccess(),
  attemptsController.listAttempts,
);

// /attempts/me MUST be registered before /attempts/:attemptId to avoid param capture.
router.get('/:courseId/quizzes/:quizId/attempts/me',
  requirePermission('quiz_attempts.view_own'),
  requireCourseAccess(),
  attemptsController.getMyAttempts,
);

router.post('/:courseId/quizzes/:quizId/attempts',
  requirePermission('quiz_attempts.view_own'),
  requireCourseAccess(),
  attemptsController.startAttempt,
);

router.get('/:courseId/quizzes/:quizId/attempts/:attemptId',
  requireAnyPermission('quiz_attempts.view_course', 'quiz_attempts.view_own'),
  requireCourseAccess(),
  attemptsController.getAttempt,
);

router.patch('/:courseId/quiz-attempts/:attemptId/responses',
  requirePermission('quiz_attempts.view_own'),
  requireCourseAccess(),
  attemptsValidators.saveResponses, validate,
  attemptsController.saveResponses,
);

router.post('/:courseId/quiz-attempts/:attemptId/submit',
  requirePermission('quiz_attempts.view_own'),
  requireCourseAccess(),
  attemptsController.submitAttempt,
);

router.patch('/:courseId/quiz-attempts/:attemptId/grade',
  requirePermission('quiz_attempts.manage'),
  requireCourseAccess('quiz_attempts.manage'),
  attemptsValidators.gradeAttempt, validate,
  attemptsController.gradeAttempt,
);

module.exports = router;
