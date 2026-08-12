'use strict';

const svc = require('./course-announcements.service');
const ApiResponse = require('../../utils/apiResponse');

exports.create = async (req, res, next) => { try { ApiResponse.created(res, 'Announcement posted', await svc.create(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.list   = async (req, res, next) => { try { ApiResponse.ok(res, 'Announcements', await svc.list(req.params.id, req.query)); } catch (e) { next(e); } };
