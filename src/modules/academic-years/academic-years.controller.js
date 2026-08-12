'use strict';

const svc         = require('./academic-years.service');
const ApiResponse = require('../../utils/apiResponse');

exports.list    = async (req, res, next) => { try { ApiResponse.ok(res, 'Academic years', await svc.list(req.params.departmentId, req.query, req.user)); } catch (e) { next(e); } };
exports.getOne  = async (req, res, next) => { try { ApiResponse.ok(res, 'Academic year', await svc.getOne(req.params.id, req.user)); } catch (e) { next(e); } };
exports.create  = async (req, res, next) => { try { ApiResponse.created(res, 'Academic year created', await svc.create(req.params.departmentId, req.body, req.user)); } catch (e) { next(e); } };
exports.update  = async (req, res, next) => { try { ApiResponse.ok(res, 'Academic year updated', await svc.update(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.remove  = async (req, res, next) => { try { await svc.remove(req.params.id, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };
