'use strict';

const svc = require('./audit.service');
const ApiResponse = require('../../utils/apiResponse');

exports.list   = async (req, res, next) => { try { ApiResponse.ok(res, 'Audit logs', await svc.list(req.query, req.user)); } catch (e) { next(e); } };
exports.getOne = async (req, res, next) => { try { ApiResponse.ok(res, 'Audit log entry', await svc.getOne(req.params.id, req.user)); } catch (e) { next(e); } };
