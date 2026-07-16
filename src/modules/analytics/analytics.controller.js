'use strict';

const svc = require('./analytics.service');
const ApiResponse = require('../../utils/apiResponse');

exports.institution = async (req, res, next) => { try { ApiResponse.ok(res, 'Institution analytics', await svc.institution(req.user.institutionId, req.query)); } catch (e) { next(e); } };
exports.course      = async (req, res, next) => { try { ApiResponse.ok(res, 'Course analytics', await svc.course(req.params.id, req.query, req.user)); } catch (e) { next(e); } };
exports.simulation  = async (req, res, next) => { try { ApiResponse.ok(res, 'Simulation analytics', await svc.simulation(req.params.id, req.query, req.user)); } catch (e) { next(e); } };
exports.student     = async (req, res, next) => { try { ApiResponse.ok(res, 'Student analytics', await svc.student(req.params.id, req.user)); } catch (e) { next(e); } };
