'use strict';

const svc = require('./notification-preferences.service');
const ApiResponse = require('../../utils/apiResponse');

exports.get    = async (req, res, next) => { try { ApiResponse.ok(res, 'Notification preferences', await svc.get(req.user)); } catch (e) { next(e); } };
exports.update = async (req, res, next) => { try { ApiResponse.ok(res, 'Preferences updated', await svc.update(req.user, req.body)); } catch (e) { next(e); } };
