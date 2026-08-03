/**
 * Auth service — complete implementation.
 * SRS §4.1 AUTH-01 – AUTH-08, §7.1 Login Flow, §6 UC-01.
 *
 * Token strategy (SRS §7.1):
 *   - Access token  : JWT, 15 min TTL, stored in client memory
 *   - Refresh token : opaque random hex, HttpOnly cookie, 7 days TTL
 *   - Redis keys:
 *       email_verify:{token}       → userId              (TTL: 24h)
 *       pwd_reset:{token}          → userId              (TTL: 1h)
 *       refresh:{token}            → {userId, institutionId} (TTL: 7d)
 *       user_sessions:{userId}     → SET of active refresh tokens
 *       login_fails:{email}        → failure count       (TTL: 15m sliding)
 */
'use strict';

const redis                                              = require('../../config/redis');
const { UserModel, RoleModel, AuditModel,
        InstitutionModel }                               = require('../../db/models');
const { signAccess }    = require('../../utils/jwt');
const { randomToken, hashPassword, comparePassword } = require('../../utils/crypto');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../../utils/email');
const ApiError          = require('../../utils/apiError');
const config            = require('../../config');

// ── Redis key helpers ─────────────────────────────────────────────────────────
const keys = {
  emailVerify: (t)    => `email_verify:${t}`,
  pwdReset:    (t)    => `pwd_reset:${t}`,
  refresh:     (t)    => `refresh:${t}`,
  sessions:    (uid)  => `user_sessions:${uid}`,
  loginFails:  (email)=> `login_fails:${email.toLowerCase()}`,
  userPerms:   (uid, iid) => `user_perms:${uid}:${iid || 'null'}`,
};

const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;   // 7 days
const EMAIL_VERIFY_TTL    = 24 * 60 * 60;         // 24 hours
const PWD_RESET_TTL       = 60 * 60;              // 1 hour
const MAX_LOGIN_FAILS     = 5;
const FAIL_WINDOW_SECONDS = 15 * 60;              // 15 minutes lock window

// ── Cookie helpers ────────────────────────────────────────────────────────────
//function setRefreshCookie(res, token) {
  //res.cookie('refreshToken', token, {
    //httpOnly: true,
    //secure:   config.env === 'production',
    //sameSite: config.env === 'production' ? 'strict' : 'lax',
    //path:     '/',
    //maxAge:   REFRESH_TTL_SECONDS * 1000,
  //});
//}

function setRefreshCookie(res, token) {
  const cookieOptions = {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: config.env === 'production' ? 'none' : 'lax',
    path: '/',
    maxAge: REFRESH_TTL_SECONDS * 1000,
  };

  res.cookie('refreshToken', token, cookieOptions);
}

function clearRefreshCookie(res) {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: config.env === 'production' ? 'none' : 'lax',
    path: '/',
  });
}

function parseRefreshToken(req) {
  if (req.cookies?.refreshToken) return req.cookies.refreshToken;
  if (req.body?.refreshToken) return req.body.refreshToken;
  const authHeader = req.headers?.authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

// ── Shared: build auth response payload ──────────────────────────────────────
async function buildAuthPayload(userId) {
  const user  = await UserModel.findById(userId);
  if (!user) throw ApiError.unauthorized('User not found');
  const roles = await RoleModel.getUserRolesWithPermissions(user.id, user.institution_id);
  const roleNames = roles.map((r) => r.name);
  const accessToken = signAccess({
    id:            user.id,
    email:         user.email,
    institutionId: user.institution_id,
    roles:         roleNames,
  });
  return {
    accessToken,
    user: {
      id:            user.id,
      email:         user.email,
      firstName:     user.first_name,
      lastName:      user.last_name,
      avatarUrl:     user.avatar_url,
      status:        user.status,
      institutionId: user.institution_id,
      roles:         roles.map((r) => ({ id: r.id, name: r.name, label: r.label })),
      permissions:   [...new Set(roles.flatMap((r) => r.permissions ?? []))],
      lastLoginAt:   user.last_login_at,
      createdAt:     user.created_at,
    },
  };
}

// ── Redis helpers with error handling ──────────────────────────────────────
async function safeRedisCall(fn, fallback = null, ...args) {
  try {
    return await fn(...args);
  } catch (err) {
    console.warn(`Redis operation failed: ${err.message}`);
    return fallback;
  }
}

// ── Store a new refresh token ─────────────────────────────────────────────────
async function storeRefreshToken(userId, institutionId, token) {
  try {
    await redis.setex(
      keys.refresh(token),
      REFRESH_TTL_SECONDS,
      JSON.stringify({ userId, institutionId }),
    );
    await redis.sadd(keys.sessions(userId), token);
    await redis.expire(keys.sessions(userId), REFRESH_TTL_SECONDS + 60);
  } catch (err) {
    console.warn(`Failed to store refresh token for user ${userId}: ${err.message}`);
    // Do not rethrow – we want login/refresh to succeed even if Redis is down.
    // However, if refresh token isn't stored, subsequent refresh will fail.
  }
}

// ── Revoke a specific refresh token ──────────────────────────────────────────
async function revokeRefreshToken(userId, token) {
  try {
    await redis.del(keys.refresh(token));
    await redis.srem(keys.sessions(userId), token);
  } catch (err) {
    console.warn(`Failed to revoke refresh token for user ${userId}: ${err.message}`);
  }
}

// ── Revoke all sessions for a user ───────────────────────────────────────────
async function revokeAllSessions(userId) {
  try {
    const tokens = await redis.smembers(keys.sessions(userId));
    if (tokens.length) {
      await redis.del(...tokens.map(keys.refresh));
      await redis.del(keys.sessions(userId));
    }
    await redis.del(`user_perms:${userId}:*`);
  } catch (err) {
    console.warn(`Failed to revoke all sessions for user ${userId}: ${err.message}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// AUTH-01  Register
// ═════════════════════════════════════════════════════════════════════════════
exports.register = async ({ email, password, firstName, lastName }) => {
  const normEmail = email.toLowerCase().trim();

  const existing = await UserModel.findByEmailWithHash(normEmail);
  if (existing) throw ApiError.conflict('An account with this email already exists.');

  const emailDomain = normEmail.split('@')[1];
  const institution = emailDomain
    ? await InstitutionModel.findByEmailDomain(emailDomain)
    : null;

  if (!institution) {
    throw ApiError.badRequest(
      'Your email domain is not associated with any registered institution. ' +
      'Please request an invitation from your institution administrator.',
    );
  }

  const activeCount = await UserModel.countByInstitution(institution.id);
  if (activeCount >= institution.max_users) {
    throw ApiError.badRequest(
      `${institution.name} has reached its maximum user limit. ` +
      'Please contact your institution administrator.',
    );
  }

  const passwordHash = await hashPassword(password);
  const user = await UserModel.create({
    email: normEmail, passwordHash, firstName, lastName,
    institutionId: institution.id,
    status: 'pending',
  });

  await RoleModel.assignRole(user.id, 'student', institution.id, null);

  const token = randomToken();
  try {
    await redis.setex(keys.emailVerify(token), EMAIL_VERIFY_TTL, user.id);
  } catch (err) {
    console.warn(`Failed to store email verification token for ${normEmail}: ${err.message}`);
    // We'll continue; user can request resend.
  }
  await sendVerificationEmail(normEmail, token);

  await AuditModel.log({
    institutionId: institution.id,
    actorId:       user.id,
    actorEmail:    normEmail,
    action:        'user.register',
    entityType:    'User',
    entityId:      user.id,
    delta: { after: { institutionId: institution.id, role: 'student' } },
  });

  return { message: 'Registration successful. Please check your email to verify your account.' };
};

// ═════════════════════════════════════════════════════════════════════════════
// AUTH-01  Verify Email
// ═════════════════════════════════════════════════════════════════════════════
exports.verifyEmail = async (token, res) => {
  let userId = null;
  try {
    userId = await redis.get(keys.emailVerify(token));
  } catch (err) {
    console.warn(`Failed to retrieve verification token: ${err.message}`);
    throw ApiError.badRequest('Unable to verify email at this time. Please try again later.');
  }
  if (!userId) throw ApiError.badRequest('Invalid or expired verification link. Please request a new one.');

  await UserModel.update(userId, { status: 'active' });
  try {
    await redis.del(keys.emailVerify(token));
  } catch (err) {
    console.warn(`Failed to delete verification token: ${err.message}`);
  }

  await AuditModel.log({
    actorId:    userId,
    action:     'user.email_verified',
    entityType: 'User',
    entityId:   userId,
  });

  const payload = await buildAuthPayload(userId);
  const refreshToken = randomToken();
  await storeRefreshToken(userId, payload.user.institutionId, refreshToken);
  await UserModel.touchLogin(userId);
  setRefreshCookie(res, refreshToken);

  return payload;
};

// ═════════════════════════════════════════════════════════════════════════════
// AUTH-02  Login
// ═════════════════════════════════════════════════════════════════════════════
exports.login = async ({ email, password }, req, res) => {
  const user = await UserModel.findByEmailWithHash(email);

  const dummyHash = '$2a$12$invalidhashplaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  if (!user) {
    await comparePassword(password, dummyHash);
    throw ApiError.unauthorized('Invalid email or password.');
  }

  if (user.status === 'pending') {
    throw ApiError.forbidden(
      'Please verify your email address before signing in. Check your inbox for the verification link.',
    );
  }
  if (user.status === 'suspended') {
    throw ApiError.forbidden(
      'Your account has been suspended. Please contact support for assistance.',
    );
  }

  // Failed-login lockout – wrap in try-catch
  let fails = 0;
  try {
    const failKey = keys.loginFails(email);
    fails = parseInt(await redis.get(failKey) || '0', 10);
    if (fails >= MAX_LOGIN_FAILS) {
      const ttl = await redis.ttl(failKey);
      throw ApiError.badRequest(
        `Too many failed login attempts. Please try again in ${Math.ceil(ttl / 60)} minutes.`,
      );
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.warn(`Failed to check login fails for ${email}: ${err.message}`);
    // Continue without lockout (allow login)
  }

  const valid = await comparePassword(password, user.password_hash);
  if (!valid) {
    try {
      const failKey = keys.loginFails(email);
      const newCount = await redis.incr(failKey);
      if (newCount === 1) await redis.expire(failKey, FAIL_WINDOW_SECONDS);
      const remaining = MAX_LOGIN_FAILS - newCount;
      const msg = remaining > 0
        ? `Invalid email or password. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
        : 'Too many failed attempts. Account temporarily locked for 15 minutes.';
      throw ApiError.unauthorized(msg);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      console.warn(`Failed to increment login fails for ${email}: ${err.message}`);
      throw ApiError.unauthorized('Invalid email or password.');
    }
  }

  // Clear fail counter – try-catch
  try {
    await redis.del(keys.loginFails(email));
  } catch (err) {
    console.warn(`Failed to clear login fails for ${email}: ${err.message}`);
  }

  const payload      = await buildAuthPayload(user.id);
  const refreshToken = randomToken();
  await storeRefreshToken(user.id, payload.user.institutionId, refreshToken);
  await UserModel.touchLogin(user.id);
  setRefreshCookie(res, refreshToken);

  await AuditModel.log({
    institutionId: payload.user.institutionId,
    actorId:       user.id,
    actorEmail:    user.email,
    action:        'user.login',
    entityType:    'User',
    entityId:      user.id,
    ipAddress:     req.ip,
    userAgent:     req.headers['user-agent'],
  });

  return payload;
};

// ═════════════════════════════════════════════════════════════════════════════
// AUTH-06  Logout
// ═════════════════════════════════════════════════════════════════════════════
exports.logout = async (user, req, res) => {
  const token = req.cookies?.refreshToken;
  if (token) await revokeRefreshToken(user.id, token);
  clearRefreshCookie(res);

  await AuditModel.log({
    institutionId: user.institutionId,
    actorId:       user.id,
    actorEmail:    user.email,
    action:        'user.logout',
    entityType:    'User',
    entityId:      user.id,
    ipAddress:     req.ip,
  });
};

// ═════════════════════════════════════════════════════════════════════════════
// AUTH-05  Refresh Token
// ═════════════════════════════════════════════════════════════════════════════
exports.refresh = async (req, res) => {
  const token = parseRefreshToken(req);
  if (!token) throw ApiError.unauthorized('No refresh token provided. Please sign in again.');

  let stored = null;
  try {
    stored = await redis.get(keys.refresh(token));
  } catch (err) {
    console.warn(`Failed to retrieve refresh token: ${err.message}`);
    throw ApiError.unauthorized('Unable to verify session. Please sign in again.');
  }
  if (!stored) throw ApiError.unauthorized('Session expired. Please sign in again.');

  const { userId, institutionId } = JSON.parse(stored);

  await revokeRefreshToken(userId, token);

  const payload      = await buildAuthPayload(userId);
  const newRefresh   = randomToken();
  await storeRefreshToken(userId, institutionId, newRefresh);
  setRefreshCookie(res, newRefresh);

  return payload;
};

// ═════════════════════════════════════════════════════════════════════════════
// AUTH-05  Forgot Password
// ═════════════════════════════════════════════════════════════════════════════
exports.forgotPassword = async (email, req) => {
  const user = await UserModel.findByEmailWithHash(email);
  console.log('Searching for user with email:', email);
  if (!user) {
    console.log('User not found with email:', email);
    return;
  }
  console.log('User found with email:', email);

  const token = randomToken();
  try {
    await redis.setex(keys.pwdReset(token), PWD_RESET_TTL, user.id);
  } catch (err) {
    console.warn(`Failed to store password reset token for ${email}: ${err.message}`);
    return; // If Redis fails, we cannot proceed; but we still don't reveal to client.
  }
  console.log('Generated password reset token for user:', user.id);
  await sendPasswordResetEmail(email, token);

  await AuditModel.log({
    institutionId: user.institution_id,
    actorId:       user.id,
    actorEmail:    email,
    action:        'user.password_reset_requested',
    entityType:    'User',
    entityId:      user.id,
    ipAddress:     req?.ip,
  });
};

// ═════════════════════════════════════════════════════════════════════════════
// AUTH-05  Reset Password
// ═════════════════════════════════════════════════════════════════════════════
exports.resetPassword = async ({ token, password }, req) => {
  let userId = null;
  try {
    userId = await redis.get(keys.pwdReset(token));
  } catch (err) {
    console.warn(`Failed to retrieve password reset token: ${err.message}`);
    throw ApiError.badRequest('Unable to verify reset token. Please try again.');
  }
  if (!userId) throw ApiError.badRequest('Invalid or expired password reset link. Please request a new one.');

  const passwordHash = await hashPassword(password);
  await UserModel.update(userId, { status: 'active' });
  await require('../../config/database').query(
    'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
    [passwordHash, userId],
  );

  await revokeAllSessions(userId);
  try {
    await redis.del(keys.pwdReset(token));
  } catch (err) {
    console.warn(`Failed to delete password reset token: ${err.message}`);
  }

  await AuditModel.log({
    actorId:    userId,
    action:     'user.password_reset_completed',
    entityType: 'User',
    entityId:   userId,
    ipAddress:  req?.ip,
  });
};

// ═════════════════════════════════════════════════════════════════════════════
// AUTH-03  Get current user (/me)
// ═════════════════════════════════════════════════════════════════════════════
exports.getMe = async (userId) => {
  const user = await UserModel.findById(userId);
  if (!user) throw ApiError.notFound('User not found.');
  const roles = await RoleModel.getUserRolesWithPermissions(user.id, user.institution_id);
  return {
    id:            user.id,
    email:         user.email,
    firstName:     user.first_name,
    lastName:      user.last_name,
    avatarUrl:     user.avatar_url,
    bio:           user.bio,
    status:        user.status,
    institutionId: user.institution_id,
    roles:         roles.map((r) => ({ id: r.id, name: r.name, label: r.label })),
    permissions:   [...new Set(roles.flatMap((r) => r.permissions ?? []))],
    lastLoginAt:   user.last_login_at,
    createdAt:     user.created_at,
    updatedAt:     user.updated_at,
  };
};

// ═════════════════════════════════════════════════════════════════════════════
// AUTH-01  Resend verification email
// ═════════════════════════════════════════════════════════════════════════════
exports.resendVerification = async (email) => {
  const user = await UserModel.findByEmailWithHash(email);
  if (!user || user.status !== 'pending') return;
  const token = randomToken();
  try {
    await redis.setex(keys.emailVerify(token), EMAIL_VERIFY_TTL, user.id);
  } catch (err) {
    console.warn(`Failed to store verification token for ${email}: ${err.message}`);
    return;
  }
  await sendVerificationEmail(email, token);
};

// Export the keys helper
exports._keys = keys;
