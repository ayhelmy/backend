'use strict';

const usersService = require('./users.service');
const ApiResponse  = require('../../utils/apiResponse');
const ApiError     = require('../../utils/apiError');

exports.list     = async (req, res, next) => { try { const { users, meta } = await usersService.list(req.query, req.user); ApiResponse.ok(res, 'Users', users, meta); } catch (e) { next(e); } };
exports.create   = async (req, res, next) => { try { ApiResponse.created(res, 'User created', await usersService.create(req.body, req.user)); } catch (e) { next(e); } };
exports.getOne   = async (req, res, next) => { try { ApiResponse.ok(res, 'User', await usersService.getOne(req.params.id, req.user)); } catch (e) { next(e); } };
exports.update   = async (req, res, next) => { try { ApiResponse.ok(res, 'User updated', await usersService.update(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.remove   = async (req, res, next) => { try { await usersService.remove(req.params.id, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };
exports.changePassword  = async (req, res, next) => { try { await usersService.changePassword(req.params.id, req.body, req.user); ApiResponse.ok(res, 'Password changed'); } catch (e) { next(e); } };
exports.getRoles        = async (req, res, next) => { try { ApiResponse.ok(res, 'User roles', await usersService.getRoles(req.params.id, req.user)); } catch (e) { next(e); } };
exports.assignRole      = async (req, res, next) => { try { ApiResponse.created(res, 'Role assigned', await usersService.assignRole(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.revokeRole      = async (req, res, next) => { try { await usersService.revokeRole(req.params.id, req.params.roleId, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };

// ── Department assignment ─────────────────────────────────────────────────────

exports.assignDepartment = async (req, res, next) => {
  try {
    ApiResponse.created(
      res,
      'Department assigned',
      await usersService.assignDepartment(req.params.id, req.body, req.user),
    );
  } catch (e) { next(e); }
};

exports.revokeDepartment = async (req, res, next) => {
  try {
    await usersService.revokeDepartment(req.params.id, req.params.deptId, req.user);
    ApiResponse.noContent(res);
  } catch (e) { next(e); }
};

// ── Institution admin assignment (super_admin only) ───────────────────────────

exports.assignInstitutionAdmin = async (req, res, next) => {
  try {
    const body = { roleName: 'institution_admin', institutionId: req.body.institutionId };
    ApiResponse.created(
      res,
      'Institution admin assigned',
      await usersService.assignRole(req.params.id, body, req.user),
    );
  } catch (e) { next(e); }
};

// ── Bulk CSV import (USR-06) ──────────────────────────────────────────────────

exports.importValidate = async (req, res, next) => {
  try {
    if (!req.file) throw ApiError.badRequest('No CSV file uploaded. Use field name "file".');
    ApiResponse.ok(res, 'Validation complete', await usersService.importValidate(req.file.buffer, req.user));
  } catch (e) { next(e); }
};

exports.importConfirm = async (req, res, next) => {
  try {
    ApiResponse.ok(res, 'Import complete', await usersService.importConfirm(req.body.rows, req.user));
  } catch (e) { next(e); }
};
