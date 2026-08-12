/**
 * LTI 1.3 launch (id_token) validation — SRS §11.3/11.4, §18.1.
 * Validates everything required before the launch can be trusted:
 * state/nonce (replay protection), JWT signature via the platform's JWKS,
 * iss/aud/azp/exp/iat, deployment_id, message_type, version, and required
 * claims — then upserts the lti_users/lti_contexts/lti_resource_links
 * identity stubs (see migration 057) and returns the parsed claims.
 */
'use strict';

const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const { LtiPlatformModel, LtiIdentityModel } = require('../../db/models');
const redis = require('../../config/redis');
const { LtiError, LTI_ERROR_CODES } = require('./lti-errors');
const { CLAIMS, MESSAGE_TYPES } = require('./lti-claims.mapper');

// One JWKS client per platform JWKS URL, reused across requests for real caching.
const jwksClientsByUrl = new Map();

function getJwksClientFor(jwksUrl) {
  if (!jwksClientsByUrl.has(jwksUrl)) {
    jwksClientsByUrl.set(jwksUrl, jwksClient({
      jwksUri: jwksUrl,
      cache: true,
      cacheMaxAge: 10 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    }));
  }
  return jwksClientsByUrl.get(jwksUrl);
}

function getSigningPublicKey(client, kid) {
  return new Promise((resolve, reject) => {
    client.getSigningKey(kid, (err, key) => {
      if (err) return reject(err);
      resolve(key.getPublicKey());
    });
  });
}

exports.validateLaunch = async ({ id_token: idToken, state }) => {
  if (!idToken || !state) {
    throw new LtiError(LTI_ERROR_CODES.INVALID_REQUEST, 'Missing id_token or state.');
  }

  // ── State/nonce lookup — single-use, deleted immediately (replay protection) ──
  const stateKey = `lti_state:${state}`;
  const stateRaw = await redis.get(stateKey);
  if (!stateRaw) throw new LtiError(LTI_ERROR_CODES.STATE_EXPIRED);
  await redis.del(stateKey);
  const stateData = JSON.parse(stateRaw);

  // ── Decode header/payload without trusting them yet ──
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded) throw new LtiError(LTI_ERROR_CODES.CLAIM_VALIDATION_FAILED, 'Malformed id_token.');
  const { kid } = decoded.header;

  // ── Resolve platform via the state we minted (not the token's claimed iss) ──
  const platform = await LtiPlatformModel.findById(stateData.platformId);
  if (!platform || platform.status !== 'active' || platform.issuer !== decoded.payload.iss) {
    throw new LtiError(LTI_ERROR_CODES.UNKNOWN_PLATFORM);
  }

  // ── Signature verification against the platform's JWKS ──
  let publicKey;
  try {
    publicKey = await getSigningPublicKey(getJwksClientFor(platform.jwks_url), kid);
  } catch {
    throw new LtiError(LTI_ERROR_CODES.JWKS_FETCH_FAILED);
  }

  let claims;
  try {
    claims = jwt.verify(idToken, publicKey, {
      algorithms: ['RS256'],
      issuer: platform.issuer,
      audience: platform.client_id,
      clockTolerance: 5,
    });
  } catch {
    throw new LtiError(LTI_ERROR_CODES.SIGNATURE_INVALID);
  }

  // ── LTI-specific claim validation ──
  if (claims.nonce !== stateData.nonce) {
    throw new LtiError(LTI_ERROR_CODES.NONCE_MISMATCH);
  }
  if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp && claims.azp !== platform.client_id) {
    throw new LtiError(LTI_ERROR_CODES.CLAIM_VALIDATION_FAILED, 'azp does not match client_id.');
  }

  const deploymentIdClaim = claims[CLAIMS.DEPLOYMENT_ID];
  if (!deploymentIdClaim) throw new LtiError(LTI_ERROR_CODES.CLAIM_VALIDATION_FAILED, 'Missing deployment_id claim.');
  const deployment = await LtiPlatformModel.findDeployment(platform.id, deploymentIdClaim);
  if (!deployment) throw new LtiError(LTI_ERROR_CODES.UNKNOWN_DEPLOYMENT);

  const messageType = claims[CLAIMS.MESSAGE_TYPE];
  if (messageType !== MESSAGE_TYPES.RESOURCE_LINK_REQUEST && messageType !== MESSAGE_TYPES.DEEP_LINKING_REQUEST) {
    throw new LtiError(LTI_ERROR_CODES.UNSUPPORTED_MESSAGE_TYPE, `Message type '${messageType}' is not supported yet.`);
  }
  if (claims[CLAIMS.VERSION] !== '1.3.0') {
    throw new LtiError(LTI_ERROR_CODES.CLAIM_VALIDATION_FAILED, 'Unsupported LTI version.');
  }

  // ── Upsert identity stubs (SRS §11.5–11.7 mapping rules) ──
  const context = claims[CLAIMS.CONTEXT] || {};
  await LtiIdentityModel.upsertUser({ platformId: platform.id, issuer: claims.iss, subject: claims.sub });
  if (context.id) {
    await LtiIdentityModel.upsertContext({
      platformId: platform.id, issuer: claims.iss, contextId: context.id,
      contextLabel: context.label, contextTitle: context.title,
      nrpsContextMembershipsUrl: claims[CLAIMS.NRPS]?.context_memberships_url,
    });
  }

  if (messageType === MESSAGE_TYPES.RESOURCE_LINK_REQUEST) {
    const resourceLink = claims[CLAIMS.RESOURCE_LINK];
    if (!resourceLink?.id) {
      throw new LtiError(LTI_ERROR_CODES.CLAIM_VALIDATION_FAILED, 'Missing resource_link.id claim.');
    }
    await LtiIdentityModel.upsertResourceLink({
      platformId: platform.id, issuer: claims.iss, contextId: context.id ?? null,
      resourceLinkId: resourceLink.id, title: resourceLink.title,
    });
  }

  return { claims, platform, deployment, messageType };
};
