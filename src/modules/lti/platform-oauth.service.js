/**
 * Shared OAuth2 client_credentials + private_key_jwt token acquisition for
 * LMS service calls (AGS and NRPS both need this — same 1EdTech Security
 * Framework flow, different scopes). Token is cached in Redis by
 * (platform, scopes) until shortly before it expires.
 */
'use strict';

const jwt = require('jsonwebtoken');
const redis = require('../../config/redis');
const { randomToken } = require('../../utils/crypto');
const toolKeysSvc = require('./tool-keys.service');

exports.getPlatformAccessToken = async (platform, scopes) => {
  const cacheKey = `lti_oauth_token:${platform.id}:${scopes.join(',')}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) return cached;

  const { kid, privateKeyPem } = await toolKeysSvc.getActiveSigningKey();
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    { iss: platform.client_id, sub: platform.client_id, aud: platform.auth_token_url, iat: now, exp: now + 60, jti: randomToken(16) },
    privateKeyPem,
    { algorithm: 'RS256', keyid: kid },
  );

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
    scope: scopes.join(' '),
  });

  const res = await fetch(platform.auth_token_url, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OAuth token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  const ttlSeconds = Math.max(60, (json.expires_in || 3600) - 60);
  await redis.setex(cacheKey, ttlSeconds, json.access_token).catch(() => {});
  return json.access_token;
};
