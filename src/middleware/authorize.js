'use strict';

/**
 * RBAC authorisation middleware — Bedo SimuLearn v2.
 * SRS §4.3 Role and Permission Management; §12 Permission Matrix v2.
 *
 * Exports:
 *   authorize(…roles)              — role-name gate (OR logic)
 *   requirePermission(code)        — single permission code gate
 *   requireAnyPermission(…codes)   — multi-permission OR gate
 *   requireAllPermissions(…codes)  — multi-permission AND gate
 *
 * Scope guards (DB-free, JWT-based):
 *   requireInstitutionScope(paramName) — actor.institutionId must match URL param
 *
 * All return 403 on failure; 401 when no authenticated user.
 */

const ApiError = require('../utils/apiError');

// ── Role gate ─────────────────────────────────────────────────────────────────

const authorize = (...allowedRoles) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());

  const userRoles = req.user.roles.map((r) => (typeof r === 'string' ? r : r.name));
  if (!allowedRoles.some((role) => userRoles.includes(role))) {
    return next(ApiError.forbidden(
      `This action requires one of the following roles: ${allowedRoles.join(', ')}.`,
    ));
  }
  next();
};

// ── Single permission gate ────────────────────────────────────────────────────

const requirePermission = (permissionCode) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());

  if (!req.user.permissions?.includes(permissionCode)) {
    return next(ApiError.forbidden(`Missing required permission: ${permissionCode}.`));
  }
  next();
};

// ── OR gate — any one of the listed permissions ───────────────────────────────

const requireAnyPermission = (...codes) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());

  const has = codes.some((c) => req.user.permissions?.includes(c));
  if (!has) {
    return next(ApiError.forbidden(
      `Missing one of the required permissions: ${codes.join(', ')}.`,
    ));
  }
  next();
};

// ── AND gate — ALL listed permissions required ────────────────────────────────

const requireAllPermissions = (...codes) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());

  const missing = codes.filter((c) => !req.user.permissions?.includes(c));
  if (missing.length) {
    return next(ApiError.forbidden(
      `Missing required permissions: ${missing.join(', ')}.`,
    ));
  }
  next();
};

// ── Institution scope guard (JWT-based, no DB hit) ────────────────────────────
// Ensures the authenticated user can access the institution identified by the
// given URL parameter. super_admin always passes.

const requireInstitutionScope = (paramName = 'id') => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());

  const isSuperAdmin = req.user.roles?.includes('super_admin');
  if (isSuperAdmin) return next();

  const institutionId = req.params[paramName];
  if (institutionId && req.user.institutionId !== institutionId) {
    return next(ApiError.forbidden('You can only access resources within your own institution.'));
  }
  next();
};

module.exports = {
  authorize,
  requirePermission,
  requireAnyPermission,
  requireAllPermissions,
  requireInstitutionScope,
};
