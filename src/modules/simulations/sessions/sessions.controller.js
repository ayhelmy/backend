'use strict';

const svc = require('./sessions.service');
const ApiResponse = require('../../../utils/apiResponse');

exports.start      = async (req, res, next) => { try { ApiResponse.created(res, 'Session started', await svc.start(req.body, req.user)); } catch (e) { next(e); } };
exports.getOne     = async (req, res, next) => { try { ApiResponse.ok(res, 'Session', await svc.getOne(req.params.id, req.user)); } catch (e) { next(e); } };
exports.update     = async (req, res, next) => { try { ApiResponse.ok(res, 'Session updated', await svc.update(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.complete   = async (req, res, next) => { try { ApiResponse.ok(res, 'Session completed', await svc.complete(req.params.id, req.user)); } catch (e) { next(e); } };
exports.listEvents = async (req, res, next) => { try { ApiResponse.ok(res, 'Events', await svc.listEvents(req.params.id, req.user)); } catch (e) { next(e); } };
