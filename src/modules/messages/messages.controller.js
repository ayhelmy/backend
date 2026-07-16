'use strict';

const svc = require('./messages.service');
const ApiResponse = require('../../utils/apiResponse');

exports.listThreads  = async (req, res, next) => { try { ApiResponse.ok(res, 'Threads', await svc.listThreads(req.user, req.query)); } catch (e) { next(e); } };
exports.createThread = async (req, res, next) => { try { ApiResponse.created(res, 'Thread created', await svc.createThread(req.body, req.user)); } catch (e) { next(e); } };
exports.getThread    = async (req, res, next) => { try { ApiResponse.ok(res, 'Thread', await svc.getThread(req.params.threadId, req.user)); } catch (e) { next(e); } };
exports.listMessages = async (req, res, next) => { try { ApiResponse.ok(res, 'Messages', await svc.listMessages(req.params.threadId, req.user, req.query)); } catch (e) { next(e); } };
exports.sendMessage  = async (req, res, next) => { try { ApiResponse.created(res, 'Message sent', await svc.sendMessage(req.params.threadId, req.body, req.user)); } catch (e) { next(e); } };
