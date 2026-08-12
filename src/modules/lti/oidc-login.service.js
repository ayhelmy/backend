/**
 * LTI 1.3 OIDC third-party-initiated login — SRS §11.2/14.2.
 * Handles GET/POST /lti/login: resolves the platform, mints state+nonce
 * (stored in Redis, single-use, short TTL — mirrors the email_verify/
 * pwd_reset token pattern in auth.service.js), and returns the redirect URL
 * to the platform's authorization endpoint.
 *
 * deployment_id is NOT validated here — per the LTI Core spec it's an
 * optional login-initiation parameter, and the authoritative deployment_id
 * only arrives signed inside the id_token at /lti/launch. This service just
 * remembers the hint (if sent) for logging; launch-validation.service.js does
 * the real check.
 */
'use strict';

const { LtiPlatformModel } = require('../../db/models');
const redis = require('../../config/redis');
const config = require('../../config');
const { randomToken } = require('../../utils/crypto');
const { LtiError, LTI_ERROR_CODES } = require('./lti-errors');

async function resolvePlatformForLogin(issuer, clientId) {
  if (clientId) {
    const platform = await LtiPlatformModel.findByIssuerAndClientId(issuer, clientId);
    return (platform && platform.status === 'active') ? platform : null;
  }
  // No client_id sent — only safe to proceed if this issuer maps to exactly one registration.
  const candidates = await LtiPlatformModel.findAllByIssuer(issuer);
  return candidates.length === 1 ? candidates[0] : null;
}

exports.handleLoginInitiation = async ({ iss, login_hint: loginHint, target_link_uri: targetLinkUri, lti_message_hint: messageHint, client_id: clientId, lti_deployment_id: deploymentHint }) => {
  if (!iss || !loginHint || !targetLinkUri) {
    throw new LtiError(LTI_ERROR_CODES.INVALID_REQUEST, 'Missing iss, login_hint, or target_link_uri.');
  }

  const platform = await resolvePlatformForLogin(iss, clientId);
  if (!platform) throw new LtiError(LTI_ERROR_CODES.UNKNOWN_PLATFORM);

  const state = randomToken(32);
  const nonce = randomToken(32);

  await redis.setex(
    `lti_state:${state}`,
    config.lti.stateTtlSeconds,
    JSON.stringify({
      nonce,
      platformId: platform.id,
      deploymentHint: deploymentHint ?? null,
      targetLinkUri,
      loginHint,
      createdAt: Date.now(),
    }),
  );

  const redirectUri = `${config.lti.toolBaseUrl}/api/${config.apiVersion}/lti/launch`;

  const authUrl = new URL(platform.auth_login_url);
  authUrl.searchParams.set('scope', 'openid');
  authUrl.searchParams.set('response_type', 'id_token');
  authUrl.searchParams.set('client_id', platform.client_id);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('login_hint', loginHint);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('response_mode', 'form_post');
  authUrl.searchParams.set('nonce', nonce);
  authUrl.searchParams.set('prompt', 'none');
  if (messageHint) authUrl.searchParams.set('lti_message_hint', messageHint);

  return { redirectUrl: authUrl.toString() };
};
