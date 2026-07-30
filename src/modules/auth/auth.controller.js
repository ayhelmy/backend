/**
 * Auth controller — thin HTTP layer; delegates to authService.
 * SRS §4.1 AUTH-01 to AUTH-08; §10.1 Auth API endpoints.
 */
'use strict';

const authService = require('./auth.service');
const ApiResponse = require('../../utils/apiResponse');

// ── Optional: enable detailed logging for debugging ──────────────────────
const DEBUG = process.env.DEBUG_AUTH === 'true' || process.env.NODE_ENV === 'development';

function log(...args) {
  if (DEBUG) console.log('[Auth Controller]', ...args);
}

exports.register = async (req, res, next) => {
  try {
    const result = await authService.register(req.body);
    ApiResponse.created(res, result.message, null);
  } catch (err) { next(err); }
};

exports.verifyEmail = async (req, res, next) => {
  try {
    // token may come from body (POST) or query string (GET link click)
    const token = req.body.token || req.query.token;
    const { accessToken, user } = await authService.verifyEmail(token, res);
    ApiResponse.ok(res, 'Email verified successfully. Welcome to Bedo SimuLearn!', { accessToken, user });
  } catch (err) { next(err); }
};

exports.login = async (req, res, next) => {
  try {
    const { accessToken, user } = await authService.login(req.body, req, res);
    ApiResponse.ok(res, 'Login successful', { accessToken, user });
  } catch (err) { next(err); }
};

exports.logout = async (req, res, next) => {
  try {
    await authService.logout(req.user, req, res);
    ApiResponse.noContent(res);
  } catch (err) { next(err); }
};

// ─── REFRESH – with detailed logging ─────────────────────────────────────
exports.refresh = async (req, res, next) => {
  try {
    log('🔍 Refresh request received');
    log('🔍 Cookies:', req.cookies);
    log('🔍 Headers (auth):', req.headers.authorization ? 'Bearer present' : 'None');

    const token = req.cookies?.refreshToken;
    log('🔍 Token from cookie:', token ? token.slice(0, 10) + '…' : 'MISSING');

    // Delegate to service – it will throw appropriate errors
    const { accessToken, user } = await authService.refresh(req, res);

    log('✅ Refresh successful for user:', user?.id || user?.email);
    ApiResponse.ok(res, 'Token refreshed', { accessToken, user });
  } catch (err) {
    // Log the error details before passing to error handler
    log('❌ Refresh failed:', err.message);
    if (err.statusCode) log('❌ Status code:', err.statusCode);
    next(err);
  }
};

exports.forgotPassword = async (req, res, next) => {
  try {
    await authService.forgotPassword(req.body.email, req);
    // Always return 200 — never reveal whether the email exists (security)
    ApiResponse.ok(res, 'If that email is registered, a reset link has been sent.');
  } catch (err) { next(err); }
};

exports.resetPassword = async (req, res, next) => {
  try {
    await authService.resetPassword(req.body, req);
    ApiResponse.ok(res, 'Password has been reset successfully. Please sign in with your new password.');
  } catch (err) { next(err); }
};

exports.me = async (req, res, next) => {
  try {
    const user = await authService.getMe(req.user.id);
    ApiResponse.ok(res, 'Current user', user);
  } catch (err) { next(err); }
};

exports.resendVerification = async (req, res, next) => {
  try {
    await authService.resendVerification(req.body.email);
    ApiResponse.ok(res, 'If your account is pending verification, a new link has been sent.');
  } catch (err) { next(err); }
};
