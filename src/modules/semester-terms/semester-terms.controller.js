'use strict';

const svc         = require('./semester-terms.service');
const ApiResponse = require('../../utils/apiResponse');

exports.list       = async (req, res, next) => { try { ApiResponse.ok(res, 'Semester terms', await svc.list(req.params.academicYearId, req.query, req.user)); } catch (e) { next(e); } };
exports.getOne     = async (req, res, next) => { try { ApiResponse.ok(res, 'Semester term', await svc.getOne(req.params.id, req.user)); } catch (e) { next(e); } };
exports.create     = async (req, res, next) => { try { ApiResponse.created(res, 'Semester term created', await svc.create(req.params.academicYearId, req.body, req.user)); } catch (e) { next(e); } };
exports.update     = async (req, res, next) => { try { ApiResponse.ok(res, 'Semester term updated', await svc.update(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.remove     = async (req, res, next) => { try { await svc.remove(req.params.id, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };
exports.getCourses = async (req, res, next) => { try { ApiResponse.ok(res, 'Term courses', await svc.getCourses(req.params.termId, req.query, req.user)); } catch (e) { next(e); } };
