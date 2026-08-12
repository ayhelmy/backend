/**
 * Cryptographic utilities — token generation and password hashing.
 * Uses Node.js built-in crypto module (no extra deps required).
 */
'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

/**
 * Generate a cryptographically random URL-safe hex token.
 * @param {number} [bytes=32]  Number of random bytes (output length = bytes × 2 hex chars)
 */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Hash a plaintext password with bcrypt.
 * @param {string} plaintext
 * @returns {Promise<string>} bcrypt hash
 */
async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

/**
 * Compare a plaintext password against a stored bcrypt hash.
 * Always takes ~100ms to prevent timing attacks.
 * @param {string} plaintext
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function comparePassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash);
}

module.exports = { randomToken, hashPassword, comparePassword };
