/**
 * Encryption at rest for LTI tool signing-key private material.
 * AES-256-GCM, key = sha256(config.lti.keyEncryptionSecret).
 * Stored format: "v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>".
 * Kept separate from utils/crypto.js (bcrypt/token concerns) since this is
 * reversible encryption, not hashing.
 */
'use strict';

const crypto = require('crypto');
const config = require('../config');

const ALGORITHM = 'aes-256-gcm';
const FORMAT_VERSION = 'v1';

function deriveKey() {
  return crypto.createHash('sha256').update(config.lti.keyEncryptionSecret).digest();
}

/**
 * Encrypt a PEM-encoded private key for storage in lti_tool_keys.private_key_encrypted.
 * @param {string} pem
 * @returns {string} "v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>"
 */
function encryptPrivateKeyPem(pem) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(pem, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/**
 * Decrypt a value produced by encryptPrivateKeyPem.
 * @param {string} encrypted
 * @returns {string} PEM-encoded private key
 */
function decryptPrivateKeyPem(encrypted) {
  const [version, ivB64, authTagB64, ciphertextB64] = encrypted.split(':');
  if (version !== FORMAT_VERSION) {
    throw new Error(`Unsupported LTI key encryption format: ${version}`);
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

module.exports = { encryptPrivateKeyPem, decryptPrivateKeyPem };
