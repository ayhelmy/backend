'use strict';

const svc = require('./settings.service');
const ApiResponse = require('../../utils/apiResponse');

exports.getInstitution     = async (req, res, next) => { try { ApiResponse.ok(res, 'Institution settings', await svc.getInstitution(req.user.institutionId)); } catch (e) { next(e); } };
exports.updateInstitution  = async (req, res, next) => { try { ApiResponse.ok(res, 'Settings updated', await svc.updateInstitution(req.user.institutionId, req.body, req.user)); } catch (e) { next(e); } };
exports.getUserSettings    = async (req, res, next) => { try { ApiResponse.ok(res, 'User settings', await svc.getUserSettings(req.user.id, req.user.institutionId)); } catch (e) { next(e); } };
exports.updateUserSettings = async (req, res, next) => { try { ApiResponse.ok(res, 'User settings updated', await svc.updateUserSettings(req.user.id, req.body, req.user.institutionId)); } catch (e) { next(e); } };
