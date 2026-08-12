'use strict';

const svc = require('./grade-categories.service');
const ApiResponse = require('../../utils/apiResponse');

exports.listCategories  = async (req, res, next) => { try { ApiResponse.ok(res, 'Grade categories', await svc.listCategories(req.params.courseId, req.user)); } catch (e) { next(e); } };
exports.createCategory  = async (req, res, next) => { try { ApiResponse.created(res, 'Grade category created', await svc.createCategory(req.params.courseId, req.body, req.user)); } catch (e) { next(e); } };
exports.updateCategory  = async (req, res, next) => { try { ApiResponse.ok(res, 'Grade category updated', await svc.updateCategory(req.params.courseId, req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.deleteCategory  = async (req, res, next) => { try { await svc.deleteCategory(req.params.courseId, req.params.id, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };
exports.validateWeights = async (req, res, next) => { try { ApiResponse.ok(res, 'Weight validation', await svc.validateWeights(req.params.courseId, req.user)); } catch (e) { next(e); } };
