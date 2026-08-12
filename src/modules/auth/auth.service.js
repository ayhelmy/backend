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
function setRefreshCookie(req, res, token) {
  const isHttps = req.secure;
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure:   isHttps,
    // SameSite=None is required for cookies to survive a cross-site fetch —
    // browsers treat scheme+port as part of "site", so a local HTTPS backend
    // paired with an HTTP frontend (or any cross-origin deployment) needs it.
    // Production keeps Strict when not otherwise cross-site — real deployments
    // should put frontend+backend under the same registrable domain so this
    // stronger CSRF protection still applies.
    sameSite: config.env === 'production' ? 'strict' : (isHttps ? 'none' : 'lax'),
    path:     '/',
    maxAge:   REFRESH_TTL_SECONDS * 1000,
  });
}

function clearRefreshCookie(req, res) {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    path:     '/',
    secure:   req.secure,
    sameSite: config.env === 'production' ? 'strict' : (req.secure ? 'none' : 'lax'),
  });
}

// ── Shared: build auth response payload ──────────────────────────────────────
async function buildAuthPayload(userId, accessTokenTtl) {
  const user  = await UserModel.findById(userId);
  if (!user) throw ApiError.unauthorized('User not found');
  const roles = await RoleModel.getUserRolesWithPermissions(user.id, user.institution_id);
  const roleNames = roles.map((r) => r.name);
  const accessToken = signAccess({
    id:            user.id,
    email:         user.email,
    institutionId: user.institution_id,
    roles:         roleNames,
  }, accessTokenTtl);
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

// ── Store a new refresh token ─────────────────────────────────────────────────
async function storeRefreshToken(userId, institutionId, token) {
  await redis.setex(
    keys.refresh(token),
    REFRESH_TTL_SECONDS,
    JSON.stringify({ userId, institutionId }),
  );
  await redis.sadd(keys.sessions(userId), token);
  // keep session set TTL in sync
  await redis.expire(keys.sessions(userId), REFRESH_TTL_SECONDS + 60);
}

// ── Revoke a specific refresh token ──────────────────────────────────────────
async function revokeRefreshToken(userId, token) {
  await redis.del(keys.refresh(token));
  await redis.srem(keys.sessions(userId), token);
}

// ── Revoke all sessions for a user (password reset, account suspension) ───────
async function revokeAllSessions(userId) {
  const tokens = await redis.smembers(keys.sessions(userId));
  if (tokens.length) {
    await redis.del(...tokens.map(keys.refresh));
    await redis.del(keys.sessions(userId));
  }
  // Invalidate cached permissions
  await redis.del(`user_perms:${userId}:*`);
}

// ═════════════════════════════════════════════════════════════════════════════
// AUTH-01  Register
// SRS §4.1 AUTH-01, §4.4 INST-04:
//   Email domain is looked up against institution_domains + institutions.domain.
//   Unrecognised domains are rejected — the platform is institution-only.
//   Recognised domains get institution_id set and 'student' role auto-assigned.
// ═════════════════════════════════════════════════════════════════════════════
exports.register = async ({ email, password, firstName, lastName }) => {
  const normEmail = email.toLowerCase().trim();

  const existing = await UserModel.findByEmailWithHash(normEmail);
  if (existing) throw ApiError.conflict('An account with this email already exists.');

  // ── Resolve institution from email domain (INST-04) ───────────────────────
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

  // Subscription user-cap check (SRS §4.4 INST-01)
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

  // Auto-assign 'student' role for all self-registered users (SRS AUTH-01)
  await RoleModel.assignRole(user.id, 'student', institution.id, null);

  const token = randomToken();
  await redis.setex(keys.emailVerify(token), EMAIL_VERIFY_TTL, user.id);
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
exports.verifyEmail = async (token, req, res) => {
  const userId = await redis.get(keys.emailVerify(token));
  if (!userId) throw ApiError.badRequest('Invalid or expired verification link. Please request a new one.');

  await UserModel.update(userId, { status: 'active' });
  await redis.del(keys.emailVerify(token));

  await AuditModel.log({
    actorId:    userId,
    action:     'user.email_verified',
    entityType: 'User',
    entityId:   userId,
  });

  // Auto-login on verification (issue tokens so user lands on dashboard)
  const payload = await buildAuthPayload(userId);
  const refreshToken = randomToken();
  await storeRefreshToken(userId, payload.user.institutionId, refreshToken);
  await UserModel.touchLogin(userId);
  setRefreshCookie(req, res, refreshToken);

  return payload;
};

// ═════════════════════════════════════════════════════════════════════════════
// AUTH-02  Login
// ═════════════════════════════════════════════════════════════════════════════
exports.login = async ({ email, password }, req, res) => {
  const user = await UserModel.findByEmailWithHash(email);

  // Unified 401 for non-existent accounts (timing safe: bcrypt compare below)
  const dummyHash = '$2a$12$invalidhashplaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  if (!user) {
    await comparePassword(password, dummyHash); // constant-time dummy compare
    throw ApiError.unauthorized('Invalid email or password.');
  }

  // Status gates (AUTH-08)
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

  // Failed-login lockout (AUTH-08)
  const failKey = keys.loginFails(email);
  const fails   = parseInt(await redis.get(failKey) || '0', 10);
  if (fails >= MAX_LOGIN_FAILS) {
    const ttl = await redis.ttl(failKey);
    throw ApiError.badRequest(
      `Too many failed login attempts. Please try again in ${Math.ceil(ttl / 60)} minutes.`,
    );
  }

  const valid = await comparePassword(password, user.password_hash);
  if (!valid) {
    const newCount = await redis.incr(failKey);
    if (newCount === 1) await redis.expire(failKey, FAIL_WINDOW_SECONDS);
    const remaining = MAX_LOGIN_FAILS - newCount;
    const msg = remaining > 0
      ? `Invalid email or password. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
      : 'Too many failed attempts. Account temporarily locked for 15 minutes.';
    throw ApiError.unauthorized(msg);
  }

  // Success — clear fail counter
  await redis.del(failKey);

  const payload      = await buildAuthPayload(user.id);
  const refreshToken = randomToken();
  await storeRefreshToken(user.id, payload.user.institutionId, refreshToken);
  await UserModel.touchLogin(user.id);
  setRefreshCookie(req, res, refreshToken);

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
  clearRefreshCookie(req, res);

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
  const token = req.cookies?.refreshToken;
  if (!token) throw ApiError.unauthorized('No refresh token. Please sign in again.');

  const stored = await redis.get(keys.refresh(token));
  if (!stored) throw ApiError.unauthorized('Session expired. Please sign in again.');

  const { userId, institutionId } = JSON.parse(stored);

  // Token rotation — invalidate old token immediately
  await revokeRefreshToken(userId, token);

  const payload      = await buildAuthPayload(userId);
  const newRefresh   = randomToken();
  await storeRefreshToken(userId, institutionId, newRefresh);
  setRefreshCookie(req, res, newRefresh);

  return payload;
};

// ═════════════════════════════════════════════════════════════════════════════
// AUTH-05  Forgot Password
// ═════════════════════════════════════════════════════════════════════════════
exports.forgotPassword = async (email, req) => {
  // Always return success — never reveal whether email exists (security)
  const user = await UserModel.findByEmailWithHash(email);
  console.log('Searching for user with email:', email);
  if (!user) {
    console.log('User not found with email:', email);
    return;
  }
  console.log('User found with email:', email);

  const token = randomToken();
  await redis.setex(keys.pwdReset(token), PWD_RESET_TTL, user.id);
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
  const userId = await redis.get(keys.pwdReset(token));
  if (!userId) throw ApiError.badRequest('Invalid or expired password reset link. Please request a new one.');

  const passwordHash = await hashPassword(password);
  await UserModel.update(userId, { status: 'active' }); // re-activate if suspended
  await require('../../config/database').query(
    'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
    [passwordHash, userId],
  );

  // Invalidate all active sessions (force re-login on all devices)
  await revokeAllSessions(userId);
  await redis.del(keys.pwdReset(token));

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
// AUTH-01  Resend verification email (bonus: needed for expired links)
// ═════════════════════════════════════════════════════════════════════════════
exports.resendVerification = async (email) => {
  const user = await UserModel.findByEmailWithHash(email);
  if (!user || user.status !== 'pending') return; // silent
  const token = randomToken();
  await redis.setex(keys.emailVerify(token), EMAIL_VERIFY_TTL, user.id);
  await sendVerificationEmail(email, token);
};

// ═════════════════════════════════════════════════════════════════════════════
// LTI session issuance — mints a real SimuLearn access token for a user who
// was provisioned/resolved via a validated LTI launch (see
// modules/lti/session-exchange.service.js). Deliberately issues NO refresh
// cookie: an LTI-launched session lives inside a (possibly third-party-iframe)
// LMS context where a cross-site refresh cookie is fragile (SameSite/Secure),
// and a bounded-lifetime access token is itself "bound to the launch" per the
// LTI security guidance — expiry just means "relaunch from the LMS".
// ═════════════════════════════════════════════════════════════════════════════
exports.issueLtiSession = async (userId) => {
  const payload = await buildAuthPayload(userId, config.lti.sessionTokenTtl);
  await UserModel.touchLogin(userId);
  return payload;
};

// Export the keys helper for use in permission cache invalidation
exports._keys = keys;
