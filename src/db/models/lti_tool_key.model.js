/**
 * LTI tool signing-key model — query helpers for lti_tool_keys.
 * private_key_encrypted is included in row reads (services need it to
 * decrypt for signing) but must never be forwarded to a controller response —
 * see tool-keys.service.js's listKeysForAdmin, which strips it.
 */
'use strict';

const { pool } = require('../../config/database');

const LtiToolKeyModel = {
  async insert({ keyName, kid, publicJwk, privateKeyEncrypted, privateKeyFingerprint }) {
    const { rows } = await pool.query(
      `INSERT INTO lti_tool_keys (key_name, kid, public_jwk, private_key_encrypted, private_key_fingerprint)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [keyName ?? null, kid, JSON.stringify(publicJwk), privateKeyEncrypted, privateKeyFingerprint],
    );
    return rows[0];
  },

  async listAll() {
    const { rows } = await pool.query(`SELECT * FROM lti_tool_keys ORDER BY created_at DESC`);
    return rows;
  },

  async findActive() {
    const { rows } = await pool.query(
      `SELECT * FROM lti_tool_keys WHERE status = 'active' ORDER BY created_at DESC`,
    );
    return rows;
  },

  async findByKid(kid) {
    const { rows } = await pool.query(`SELECT * FROM lti_tool_keys WHERE kid = $1`, [kid]);
    return rows[0] ?? null;
  },

  async markRetired(id) {
    const { rows } = await pool.query(
      `UPDATE lti_tool_keys SET status = 'retired', rotated_at = NOW() WHERE id = $1 RETURNING *`,
      [id],
    );
    return rows[0] ?? null;
  },
};

module.exports = LtiToolKeyModel;
