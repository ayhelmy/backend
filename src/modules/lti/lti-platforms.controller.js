'use strict';

const registrySvc = require('./platform-registry.service');
const keysSvc      = require('./tool-keys.service');
const ApiResponse = require('../../utils/apiResponse');

// ── Platforms ─────────────────────────────────────────────────────────────────

exports.list   = async (req, res, next) => { try { const r = await registrySvc.list(req.user, req.query); ApiResponse.ok(res, 'LTI platforms', r.platforms, r.meta); } catch (e) { next(e); } };
exports.create = async (req, res, next) => { try { ApiResponse.created(res, 'LTI platform registered', await registrySvc.create(req.body, req.user)); } catch (e) { next(e); } };
exports.getOne = async (req, res, next) => { try { ApiResponse.ok(res, 'LTI platform', await registrySvc.getOne(req.params.id, req.user)); } catch (e) { next(e); } };
exports.update = async (req, res, next) => { try { ApiResponse.ok(res, 'LTI platform updated', await registrySvc.update(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.activate   = async (req, res, next) => { try { ApiResponse.ok(res, 'LTI platform activated',   await registrySvc.setStatus(req.params.id, 'active',   req.user)); } catch (e) { next(e); } };
exports.deactivate = async (req, res, next) => { try { ApiResponse.ok(res, 'LTI platform deactivated', await registrySvc.setStatus(req.params.id, 'inactive', req.user)); } catch (e) { next(e); } };

// ── Deployments ───────────────────────────────────────────────────────────────

exports.addDeployment    = async (req, res, next) => { try { ApiResponse.created(res, 'Deployment added', await registrySvc.addDeployment(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.removeDeployment = async (req, res, next) => { try { await registrySvc.removeDeployment(req.params.id, req.params.deploymentId, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };

// ── Tool keys ─────────────────────────────────────────────────────────────────

exports.listKeys  = async (req, res, next) => { try { ApiResponse.ok(res, 'LTI signing keys', await keysSvc.listKeysForAdmin()); } catch (e) { next(e); } };
exports.rotateKey = async (req, res, next) => { try { ApiResponse.created(res, 'LTI signing key rotated', await keysSvc.rotateKey(req.user)); } catch (e) { next(e); } };

// ── Launch logs ───────────────────────────────────────────────────────────────

exports.listLaunchLogs = async (req, res, next) => { try { const r = await registrySvc.listLaunchLogs(req.user, req.query); ApiResponse.ok(res, 'LTI launch logs', r.logs, r.meta); } catch (e) { next(e); } };
