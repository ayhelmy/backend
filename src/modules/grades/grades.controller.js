'use strict';

const svc = require('./grades.service');
const ApiResponse = require('../../utils/apiResponse');

exports.getGradebook     = async (req, res, next) => { try { ApiResponse.ok(res, 'Gradebook', await svc.getGradebook(req.params.courseId, req.query, req.user)); } catch (e) { next(e); } };
exports.listItems        = async (req, res, next) => { try { ApiResponse.ok(res, 'Grade items', await svc.listItems(req.params.courseId)); } catch (e) { next(e); } };
exports.createItem       = async (req, res, next) => { try { ApiResponse.created(res, 'Grade item created', await svc.createItem(req.params.courseId, req.body, req.user)); } catch (e) { next(e); } };
exports.updateItem       = async (req, res, next) => { try { ApiResponse.ok(res, 'Grade item updated', await svc.updateItem(req.params.itemId, req.body, req.user)); } catch (e) { next(e); } };
exports.getStudentGrades = async (req, res, next) => { try { ApiResponse.ok(res, 'Student grades', await svc.getStudentGrades(req.params.courseId, req.params.studentId, req.user)); } catch (e) { next(e); } };
exports.submitGrade      = async (req, res, next) => { try { ApiResponse.created(res, 'Grade submitted', await svc.submitGrade(req.params.courseId, req.body, req.user)); } catch (e) { next(e); } };
exports.updateGrade      = async (req, res, next) => { try { ApiResponse.ok(res, 'Grade updated', await svc.updateGrade(req.params.gradeId, req.body, req.user)); } catch (e) { next(e); } };
