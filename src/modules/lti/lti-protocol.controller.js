'use strict';

/**
 * Public LTI 1.3 protocol endpoints — hit directly by the LMS platform, not
 * by a logged-in SimuLearn user. Responds with browser redirects (form_post
 * launches arrive as a top-level POST, not an XHR) rather than the app's
 * normal JSON envelope, except for /jwks.json (raw JWKS document, per spec)
 * and the endpoints consumed by our own /lti/launching and /lti/deep-linking
 * frontend pages (launch-details, deep-linking/context+response, session
 * exchange), which use the normal envelope since they ARE our own JSON API.
 */

const config = require('../../config');
const ApiResponse = require('../../utils/apiResponse');
const ApiError = require('../../utils/apiError');
const { AuditModel } = require('../../db/models');
const oidcLoginSvc = require('./oidc-login.service');
const launchValidationSvc = require('./launch-validation.service');
const toolKeysSvc = require('./tool-keys.service');
const deepLinkingSvc = require('./deep-linking.service');
const provisioningSvc = require('./lti-provisioning.service');
const sessionExchangeSvc = require('./session-exchange.service');
const { extractLaunchSummary, MESSAGE_TYPES } = require('./lti-claims.mapper');
const { signLaunchToken, verifyLaunchToken } = require('../../utils/lti-launch-token');
const { LtiError } = require('./lti-errors');

function errorRedirectUrl(code) {
  return `${config.cors.origin}/lti/error?code=${encodeURIComponent(code)}`;
}

exports.login = async (req, res) => {
  const params = { ...req.query, ...req.body };
  try {
    const { redirectUrl } = await oidcLoginSvc.handleLoginInitiation(params);
    return res.redirect(302, redirectUrl);
  } catch (err) {
    const code = err instanceof LtiError ? err.code : 'INTERNAL_ERROR';
    await AuditModel.log({
      institutionId: null,
      actorId: null, actorEmail: `lti-platform:${params.iss || 'unknown'}`,
      action: 'lti.login_failed', entityType: 'LtiLaunch', entityId: null,
      delta: { issuer: params.iss ?? null, reason: err.message, errorCode: code },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.redirect(302, errorRedirectUrl(code));
  }
};

exports.launch = async (req, res) => {
  try {
    const { claims, platform, deployment, messageType } = await launchValidationSvc.validateLaunch(req.body);
    const summary = extractLaunchSummary(claims);

    const auditDelta = {
      deploymentId: summary.deploymentId, sub: summary.sub,
      contextId: summary.contextId, resourceLinkId: summary.resourceLinkId,
      messageType: summary.messageType,
    };

    let redirectPath;
    if (messageType === MESSAGE_TYPES.DEEP_LINKING_REQUEST) {
      const { token } = await deepLinkingSvc.prepareDeepLinkingSession({ claims, platform, deployment });
      redirectPath = `/lti/deep-linking?token=${encodeURIComponent(token)}`;
    } else {
      const { user, courseId, lessonId, simulationId } = await provisioningSvc.resolveResourceLinkLaunch({ claims, platform });
      const token = signLaunchToken({ purpose: 'resource_link', simulearnUserId: user.id, courseId, lessonId, simulationId });
      redirectPath = `/lti/launching?token=${encodeURIComponent(token)}`;
      auditDelta.simulearnUserId = user.id;
      auditDelta.courseId = courseId;
      auditDelta.lessonId = lessonId;
    }

    await AuditModel.log({
      institutionId: platform.institution_id,
      actorId: null, actorEmail: `lti-user:${summary.issuer}::${summary.sub}`,
      action: 'lti.launch_success', entityType: 'LtiPlatform', entityId: platform.id,
      delta: auditDelta,
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});

    return res.redirect(302, `${config.cors.origin}${redirectPath}`);
  } catch (err) {
    const code = err instanceof LtiError ? err.code : 'INTERNAL_ERROR';
    await AuditModel.log({
      institutionId: null,
      actorId: null, actorEmail: 'lti-launch:unknown',
      action: 'lti.launch_failed', entityType: 'LtiLaunch', entityId: null,
      delta: { reason: err.message, errorCode: code },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.redirect(302, errorRedirectUrl(code));
  }
};

exports.jwks = async (_req, res, next) => {
  try {
    const jwks = await toolKeysSvc.getPublicJwks();
    res.json(jwks); // raw JWKS document — LMS platforms expect the bare { keys: [...] } shape
  } catch (e) { next(e); }
};

exports.launchDetails = async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) throw ApiError.badRequest('Missing token.');
    let payload;
    try {
      payload = verifyLaunchToken(token);
    } catch {
      throw ApiError.badRequest('This launch link has expired or is invalid. Please relaunch from your LMS.');
    }
    ApiResponse.ok(res, 'Launch details', payload);
  } catch (e) { next(e); }
};

// ── Deep Linking (picker + response) ──────────────────────────────────────────

exports.deepLinkingContext = async (req, res, next) => {
  try {
    const { token, search } = req.query;
    if (!token) throw ApiError.badRequest('Missing token.');
    const ctx = await deepLinkingSvc.getPickerContext(token, search);
    ApiResponse.ok(res, 'Deep Linking context', ctx);
  } catch (e) { next(e); }
};

exports.deepLinkingResponse = async (req, res, next) => {
  try {
    const { token, selections } = req.body;
    if (!token) throw ApiError.badRequest('Missing token.');
    const result = await deepLinkingSvc.buildResponse(token, selections);
    ApiResponse.ok(res, 'Deep Linking response built', result);
  } catch (e) { next(e); }
};

// ── Session exchange (resource-link launch -> real SimuLearn login) ──────────

exports.sessionExchange = async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) throw ApiError.badRequest('Missing token.');
    const session = await sessionExchangeSvc.exchange(token);
    ApiResponse.ok(res, 'Session established', session);
  } catch (e) { next(e); }
};
