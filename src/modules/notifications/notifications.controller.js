'use strict';

const svc = require('./notifications.service');
const ApiResponse = require('../../utils/apiResponse');

exports.list        = async (req, res, next) => { try { ApiResponse.ok(res, 'Notifications', await svc.list(req.user.id, req.query)); } catch (e) { next(e); } };
exports.unreadCount  = async (req, res, next) => { try { ApiResponse.ok(res, 'Unread count', await svc.unreadCount(req.user.id)); } catch (e) { next(e); } };
exports.markRead     = async (req, res, next) => { try { ApiResponse.ok(res, 'Marked read', await svc.markRead(req.params.id, req.user.id)); } catch (e) { next(e); } };
exports.markAllRead  = async (req, res, next) => { try { ApiResponse.ok(res, 'All marked read', await svc.markAllRead(req.user.id)); } catch (e) { next(e); } };
exports.archive      = async (req, res, next) => { try { ApiResponse.ok(res, 'Archived', await svc.archive(req.params.id, req.user.id)); } catch (e) { next(e); } };
exports.remove       = async (req, res, next) => { try { await svc.remove(req.params.id, req.user.id); ApiResponse.noContent(res); } catch (e) { next(e); } };
