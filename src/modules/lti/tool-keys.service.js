/**
 * Tool signing-key management — SimuLearn's own RSA keypair(s) used to sign
 * JWTs sent to LMS platforms and to publish a public JWKS. Rotation never
 * deletes a key: retired keys stay in the JWKS response so platforms with a
 * cached JWKS can still verify pre-rotation signatures.
 */
'use strict';

const crypto = require('crypto');
const { LtiToolKeyModel, AuditModel } = require('../../db/models');
const { encryptPrivateKeyPem, decryptPrivateKeyPem } = require('../../utils/lti-key-crypto');
const ApiError = require('../../utils/apiError');

function mapKeyForAdmin(row) {
  return {
    id:          row.id,
    keyName:     row.key_name,
    kid:         row.kid,
    fingerprint: row.private_key_fingerprint,
    status:      row.status,
    createdAt:   row.created_at,
    rotatedAt:   row.rotated_at,
  };
}

function buildKeyMaterial() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const kid = crypto.randomUUID();
  const publicKeyObject = crypto.createPublicKey(publicKey);
  const jwk = publicKeyObject.export({ format: 'jwk' });
  const publicJwk = { ...jwk, use: 'sig', alg: 'RS256', kid };

  const fingerprint = crypto.createHash('sha256')
    .update(publicKeyObject.export({ type: 'spki', format: 'der' }))
    .digest('hex');

  return {
    kid,
    publicJwk,
    privateKeyEncrypted: encryptPrivateKeyPem(privateKey),
    privateKeyFingerprint: fingerprint,
  };
}

/** Generates and persists a new active signing key. Does not retire any existing key. */
exports.generateKeyPair = async (actor, { keyName } = {}) => {
  const material = buildKeyMaterial();
  const row = await LtiToolKeyModel.insert({ keyName: keyName ?? null, ...material });

  await AuditModel.log({
    institutionId: null,
    actorId: actor?.id ?? null, actorEmail: actor?.email ?? 'system',
    action: 'lti_key.generate', entityType: 'LtiKey', entityId: row.id,
    delta: { after: { kid: row.kid } },
  });

  return mapKeyForAdmin(row);
};

/** Retires all currently-active keys and generates a fresh one. */
exports.rotateKey = async (actor) => {
  const activeKeys = await LtiToolKeyModel.findActive();
  const retiredKids = [];
  for (const key of activeKeys) {
    await LtiToolKeyModel.markRetired(key.id);
    retiredKids.push(key.kid);
  }

  const material = buildKeyMaterial();
  const row = await LtiToolKeyModel.insert(material);

  await AuditModel.log({
    institutionId: null,
    actorId: actor?.id ?? null, actorEmail: actor?.email ?? 'system',
    action: 'lti_key.rotate', entityType: 'LtiKey', entityId: row.id,
    delta: { before: { retiredKids }, after: { kid: row.kid } },
  });

  return mapKeyForAdmin(row);
};

/** Internal use only — decrypts and returns the active signing key material. */
exports.getActiveSigningKey = async () => {
  const [active] = await LtiToolKeyModel.findActive();
  if (!active) throw ApiError.internal('No active LTI signing key. Generate one from LTI settings.');
  return { kid: active.kid, privateKeyPem: decryptPrivateKeyPem(active.private_key_encrypted) };
};

/** Public JWKS document — includes retired keys so cached platform JWKS still verify. */
exports.getPublicJwks = async () => {
  const rows = await LtiToolKeyModel.listAll();
  return { keys: rows.map((r) => r.public_jwk) };
};

exports.listKeysForAdmin = async () => {
  const rows = await LtiToolKeyModel.listAll();
  return rows.map(mapKeyForAdmin);
};
