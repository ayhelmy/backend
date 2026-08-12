'use strict';

const svc         = require('./institutions.service');
const ApiResponse = require('../../utils/apiResponse');

// ── Institutions ──────────────────────────────────────────────────────────────

exports.list   = async (req, res, next) => { try { const r = await svc.list(req.query); ApiResponse.ok(res, 'Institutions', r.institutions, r.meta); } catch (e) { next(e); } };
exports.create = async (req, res, next) => { try { ApiResponse.created(res, 'Institution created', await svc.create(req.body, req.user)); } catch (e) { next(e); } };
exports.getOne = async (req, res, next) => { try { ApiResponse.ok(res, 'Institution', await svc.getOne(req.params.id, req.user)); } catch (e) { next(e); } };
exports.update = async (req, res, next) => { try { ApiResponse.ok(res, 'Institution updated', await svc.update(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.remove = async (req, res, next) => { try { await svc.remove(req.params.id); ApiResponse.noContent(res); } catch (e) { next(e); } };

// ── Departments ───────────────────────────────────────────────────────────────

exports.listDepartments  = async (req, res, next) => { try { ApiResponse.ok(res, 'Departments', await svc.listDepartments(req.params.id)); } catch (e) { next(e); } };
exports.createDepartment = async (req, res, next) => { try { ApiResponse.created(res, 'Department created', await svc.createDepartment(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.updateDepartment = async (req, res, next) => { try { ApiResponse.ok(res, 'Department updated', await svc.updateDepartment(req.params.deptId, req.body)); } catch (e) { next(e); } };
exports.removeDepartment = async (req, res, next) => { try { await svc.removeDepartment(req.params.deptId); ApiResponse.noContent(res); } catch (e) { next(e); } };

// ── Academic Terms ────────────────────────────────────────────────────────────

exports.listTerms  = async (req, res, next) => { try { ApiResponse.ok(res, 'Terms', await svc.listTerms(req.params.id)); } catch (e) { next(e); } };
exports.createTerm = async (req, res, next) => { try { ApiResponse.created(res, 'Term created', await svc.createTerm(req.params.id, req.body)); } catch (e) { next(e); } };
exports.updateTerm = async (req, res, next) => { try { ApiResponse.ok(res, 'Term updated', await svc.updateTerm(req.params.termId, req.body)); } catch (e) { next(e); } };
exports.removeTerm = async (req, res, next) => { try { await svc.removeTerm(req.params.termId); ApiResponse.noContent(res); } catch (e) { next(e); } };

// ── Learning Domains ──────────────────────────────────────────────────────────

exports.listDomains  = async (req, res, next) => { try { ApiResponse.ok(res, 'Domains', await svc.listDomains(req.params.id)); } catch (e) { next(e); } };
exports.createDomain = async (req, res, next) => { try { ApiResponse.created(res, 'Domain created', await svc.createDomain(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.updateDomain = async (req, res, next) => { try { ApiResponse.ok(res, 'Domain updated', await svc.updateDomain(req.params.domainId, req.params.id, req.body)); } catch (e) { next(e); } };
exports.removeDomain = async (req, res, next) => { try { await svc.removeDomain(req.params.domainId, req.params.id); ApiResponse.noContent(res); } catch (e) { next(e); } };

// ── Email Registration Domains ────────────────────────────────────────────────

exports.listEmailDomains  = async (req, res, next) => { try { ApiResponse.ok(res, 'Email domains', await svc.listEmailDomains(req.params.id)); } catch (e) { next(e); } };
exports.addEmailDomain    = async (req, res, next) => { try { ApiResponse.created(res, 'Email domain added', await svc.addEmailDomain(req.params.id, req.body)); } catch (e) { next(e); } };
exports.removeEmailDomain = async (req, res, next) => { try { await svc.removeEmailDomain(req.params.id, req.params.domainId); ApiResponse.noContent(res); } catch (e) { next(e); } };
