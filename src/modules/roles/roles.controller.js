'use strict';

const rolesService = require('./roles.service');
const ApiResponse  = require('../../utils/apiResponse');

exports.listRoles          = async (req, res, next) => { try { ApiResponse.ok(res, 'Roles', await rolesService.listRoles(req.user)); } catch (e) { next(e); } };
exports.listPermissions    = async (req, res, next) => { try { ApiResponse.ok(res, 'Role permissions', await rolesService.listPermissions(req.params.id)); } catch (e) { next(e); } };
exports.listAllPermissions = async (req, res, next) => { try { ApiResponse.ok(res, 'All permissions', await rolesService.listAllPermissions()); } catch (e) { next(e); } };
exports.addPermission      = async (req, res, next) => { try { ApiResponse.created(res, 'Permission added', await rolesService.addPermission(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.removePermission   = async (req, res, next) => { try { await rolesService.removePermission(req.params.id, req.params.permId, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };
exports.assignRole         = async (req, res, next) => { try { ApiResponse.created(res, 'Role assigned', await rolesService.assignRole(req.body, req.user)); } catch (e) { next(e); } };
exports.revokeRole         = async (req, res, next) => { try { await rolesService.revokeRole(req.params.userId, req.params.roleId, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };
exports.createRole         = async (req, res, next) => { try { ApiResponse.created(res, 'Role created', await rolesService.createRole(req.body, req.user)); } catch (e) { next(e); } };

// ── Department assignment ─────────────────────────────────────────────────────
exports.assignDepartment  = async (req, res, next) => { try { ApiResponse.created(res, 'Department assigned', await rolesService.assignDepartment(req.body, req.user)); } catch (e) { next(e); } };
exports.revokeDepartment  = async (req, res, next) => { try { await rolesService.revokeDepartment(req.params.userId, req.params.deptId, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };

// ── TA assignment ─────────────────────────────────────────────────────────────
exports.assignTA          = async (req, res, next) => { try { ApiResponse.created(res, 'TA assigned', await rolesService.assignTA(req.body, req.user)); } catch (e) { next(e); } };
exports.revokeTA          = async (req, res, next) => { try { await rolesService.revokeTA(req.params.courseId, req.params.userId, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };
