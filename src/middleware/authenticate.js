/**
 * JWT authentication middleware.
 * SRS §4.1 AUTH-06 — every protected endpoint guarded.
 * SRS §7.1 — verifies Bearer token; loads cached permissions for requirePermission().
 *
 * req.user = { id, email, institutionId, roles: string[], permissions: string[] }
 */
'use strict';

const { verifyAccess } = require('../utils/jwt');
const redis            = require('../config/redis');
const ApiError         = require('../utils/apiError');
const { RoleModel }    = require('../db/models');

const PERMS_CACHE_TTL = 5 * 60; // 5 minutes

async function loadPermissions(userId, institutionId) {
  const cacheKey = `user_perms:${userId}:${institutionId ?? 'null'}`;
  const cached   = await redis.get(cacheKey).catch(() => null);
  if (cached) return JSON.parse(cached);

  // Cache miss — load from DB
  const roles = await RoleModel.getUserRolesWithPermissions(userId, institutionId);
  const perms = [...new Set(roles.flatMap((r) => r.permissions ?? []))];
  await redis.setex(cacheKey, PERMS_CACHE_TTL, JSON.stringify(perms)).catch(() => {});
  return perms;
}

const authenticate = async (req, _res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw ApiError.unauthorized('Missing or malformed Authorization header.');
    }

    const token   = authHeader.slice(7);
    const payload = verifyAccess(token);

    // Load permissions (from Redis cache or DB) — enables requirePermission() below
    const permissions = await loadPermissions(payload.sub, payload.institutionId);

    req.user = {
      id:            payload.sub,
      email:         payload.email,
      institutionId: payload.institutionId ?? null,
      roles:         payload.roles || [],
      permissions,
    };

    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    if (err.name === 'TokenExpiredError') return next(ApiError.unauthorized('Access token expired.'));
    if (err.name === 'JsonWebTokenError')  return next(ApiError.unauthorized('Invalid access token.'));
    next(err);
  }
};

module.exports = authenticate;
