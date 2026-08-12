'use strict';

const svc         = require('./modules.service');
const ApiResponse = require('../../utils/apiResponse');

// ── Modules ───────────────────────────────────────────────────────────────────

exports.listModules    = async (req, res, next) => { try { ApiResponse.ok(res, 'Modules', await svc.listModules(req.params.courseId, req.user)); } catch (e) { next(e); } };
exports.getCourseTree  = async (req, res, next) => { try { ApiResponse.ok(res, 'Course tree', await svc.getCourseTree(req.params.courseId, req.user)); } catch (e) { next(e); } };
exports.createModule   = async (req, res, next) => { try { ApiResponse.created(res, 'Module created', await svc.createModule(req.params.courseId, req.body, req.user)); } catch (e) { next(e); } };
exports.getModule      = async (req, res, next) => { try { ApiResponse.ok(res, 'Module', await svc.getModule(req.params.moduleId, req.user)); } catch (e) { next(e); } };
exports.updateModule   = async (req, res, next) => { try { ApiResponse.ok(res, 'Module updated', await svc.updateModule(req.params.moduleId, req.body, req.user)); } catch (e) { next(e); } };
exports.removeModule   = async (req, res, next) => { try { await svc.removeModule(req.params.moduleId, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };
exports.reorderModules = async (req, res, next) => { try { ApiResponse.ok(res, 'Modules reordered', await svc.reorderModules(req.params.courseId, req.body.order, req.user)); } catch (e) { next(e); } };

// ── Lessons ───────────────────────────────────────────────────────────────────

exports.listLessons         = async (req, res, next) => { try { ApiResponse.ok(res, 'Lessons', await svc.listLessons(req.params.moduleId, req.user)); } catch (e) { next(e); } };
exports.createLesson        = async (req, res, next) => { try { ApiResponse.created(res, 'Lesson created', await svc.createLesson(req.params.moduleId, req.body, req.user)); } catch (e) { next(e); } };
exports.updateLesson        = async (req, res, next) => { try { ApiResponse.ok(res, 'Lesson updated', await svc.updateLesson(req.params.lessonId, req.body, req.user)); } catch (e) { next(e); } };
exports.removeLesson        = async (req, res, next) => { try { await svc.removeLesson(req.params.lessonId, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };
exports.reorderLessons      = async (req, res, next) => { try { ApiResponse.ok(res, 'Lessons reordered', await svc.reorderLessons(req.params.moduleId, req.body.order, req.user)); } catch (e) { next(e); } };
exports.markLessonComplete  = async (req, res, next) => { try { ApiResponse.ok(res, 'Lesson marked complete', await svc.markLessonComplete(req.params.lessonId, req.user)); } catch (e) { next(e); } };
exports.validateSimulation  = async (req, res, next) => { try { ApiResponse.ok(res, 'Simulation validated', await svc.validateSimulation(req.params.courseId, req.body.simulationId, req.user)); } catch (e) { next(e); } };
exports.getCourseJourney            = async (req, res, next) => { try { ApiResponse.ok(res, 'Course journey', await svc.getCourseJourney(req.params.courseId, req.user)); } catch (e) { next(e); } };
exports.getLessonSimulationLaunch   = async (req, res, next) => { try { ApiResponse.ok(res, 'Simulation launch info', await svc.getLessonSimulationLaunch(req.params.courseId, req.params.lessonId, req.user, req)); } catch (e) { next(e); } };
