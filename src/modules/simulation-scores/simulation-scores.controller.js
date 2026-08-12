'use strict';

const svc = require('./simulation-scores.service');
const ApiResponse = require('../../utils/apiResponse');

exports.listByCourse       = async (req, res, next) => { try { ApiResponse.ok(res, 'Simulation scores', await svc.listByCourse(req.params.courseId, req.user)); } catch (e) { next(e); } };
exports.getById            = async (req, res, next) => { try { ApiResponse.ok(res, 'Simulation score', await svc.getById(req.params.courseId, req.params.id, req.user)); } catch (e) { next(e); } };
exports.createManualScore  = async (req, res, next) => { try { ApiResponse.created(res, 'Simulation score recorded', await svc.createManualScore(req.params.courseId, req.body, req.user)); } catch (e) { next(e); } };
exports.updateScore        = async (req, res, next) => { try { ApiResponse.ok(res, 'Simulation score updated', await svc.updateScore(req.params.courseId, req.params.id, req.body, req.user)); } catch (e) { next(e); } };
