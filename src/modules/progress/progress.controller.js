'use strict';

const svc = require('./progress.service');
const ApiResponse = require('../../utils/apiResponse');

exports.getCourseProgress = async (req, res, next) => { try { ApiResponse.ok(res, 'Course progress', await svc.getCourseProgress(req.params.courseId, req.user.id)); } catch (e) { next(e); } };
exports.getLessonProgress = async (req, res, next) => { try { ApiResponse.ok(res, 'Lesson progress', await svc.getLessonProgress(req.params.lessonId, req.user.id)); } catch (e) { next(e); } };
exports.completeLesson    = async (req, res, next) => { try { ApiResponse.ok(res, 'Lesson marked complete', await svc.completeLesson(req.params.lessonId, req.user.id)); } catch (e) { next(e); } };
