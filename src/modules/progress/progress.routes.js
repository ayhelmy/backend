/**
 * Progress routes — SRS §4.9 PRG-01 to PRG-05.
 * GET  /api/v1/progress/courses/:courseId     — course-level progress for current user
 * GET  /api/v1/progress/lessons/:lessonId     — lesson progress for current user
 * POST /api/v1/progress/lessons/:lessonId/complete
 */
'use strict';

const { Router } = require('express');
const progressController = require('./progress.controller');
const authenticate = require('../../middleware/authenticate');

const router = Router();
router.use(authenticate);

router.get('/courses/:courseId',              progressController.getCourseProgress);
router.get('/lessons/:lessonId',              progressController.getLessonProgress);
router.post('/lessons/:lessonId/complete',    progressController.completeLesson);

module.exports = router;
