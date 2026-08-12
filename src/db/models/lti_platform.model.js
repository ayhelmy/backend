/**
 * LTI platform + deployment model — query helpers for lti_platforms /
 * lti_deployments. Mirrors institution.model.js's institutions +
 * institution_domains pairing: one institution can register multiple LMS
 * platforms, and one platform registration can have multiple deployment_ids.
 */
'use strict';

const { pool } = require('../../config/database');

const LtiPlatformModel = {
  async findById(id) {
    const { rows } = await pool.query(
      `SELECT * FROM lti_platforms WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async findByIssuerAndClientId(issuer, clientId) {
    const { rows } = await pool.query(
      `SELECT * FROM lti_platforms WHERE issuer = $1 AND client_id = $2`,
      [issuer, clientId],
    );
    return rows[0] ?? null;
  },

  /** Used by OIDC login initiation when the LMS omits client_id (single-registration issuers only). */
  async findAllByIssuer(issuer) {
    const { rows } = await pool.query(
      `SELECT * FROM lti_platforms WHERE issuer = $1 AND status = 'active'`,
      [issuer],
    );
    return rows;
  },

  async list({ institutionId, search, limit = 20, offset = 0 } = {}) {
    const params = [];
    const filters = [];
    if (institutionId) filters.push(`institution_id = $${params.push(institutionId)}`);
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      const idx = params.length;
      filters.push(`(LOWER(platform_name) LIKE $${idx} OR LOWER(issuer) LIKE $${idx})`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT * FROM lti_platforms ${where}
        ORDER BY platform_name
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows;
  },

  async count({ institutionId, search } = {}) {
    const params = [];
    const filters = [];
    if (institutionId) filters.push(`institution_id = $${params.push(institutionId)}`);
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      const idx = params.length;
      filters.push(`(LOWER(platform_name) LIKE $${idx} OR LOWER(issuer) LIKE $${idx})`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows } = await pool.query(`SELECT COUNT(*) FROM lti_platforms ${where}`, params);
    return parseInt(rows[0].count, 10);
  },

  async create({ institutionId, platformName, issuer, clientId, authLoginUrl, authTokenUrl, jwksUrl, createdBy }) {
    const { rows } = await pool.query(
      `INSERT INTO lti_platforms
         (institution_id, platform_name, issuer, client_id, auth_login_url, auth_token_url, jwks_url, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [institutionId, platformName, issuer, clientId, authLoginUrl, authTokenUrl, jwksUrl, createdBy ?? null],
    );
    return rows[0];
  },

  async update(id, fields) {
    const allowed = ['platform_name', 'issuer', 'client_id', 'auth_login_url', 'auth_token_url', 'jwks_url', 'allowed_scopes', 'role_mapping'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        params.push((key === 'allowed_scopes' || key === 'role_mapping') ? JSON.stringify(fields[key]) : fields[key]);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (!sets.length) return this.findById(id);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE lti_platforms SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  },

  async setStatus(id, status) {
    const { rows } = await pool.query(
      `UPDATE lti_platforms SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, status],
    );
    return rows[0] ?? null;
  },

  // ── Deployments ───────────────────────────────────────────────────────────

  async listDeployments(platformId) {
    const { rows } = await pool.query(
      `SELECT * FROM lti_deployments WHERE platform_id = $1 ORDER BY created_at`,
      [platformId],
    );
    return rows;
  },

  async findDeployment(platformId, deploymentId) {
    const { rows } = await pool.query(
      `SELECT * FROM lti_deployments WHERE platform_id = $1 AND deployment_id = $2 AND status = 'active'`,
      [platformId, deploymentId],
    );
    return rows[0] ?? null;
  },

  async addDeployment(platformId, deploymentId, label) {
    const { rows } = await pool.query(
      `INSERT INTO lti_deployments (platform_id, deployment_id, label)
       VALUES ($1, $2, $3)
       ON CONFLICT (platform_id, deployment_id) DO UPDATE SET label = EXCLUDED.label, status = 'active'
       RETURNING *`,
      [platformId, deploymentId, label ?? null],
    );
    return rows[0];
  },

  async removeDeployment(platformId, deploymentId) {
    const { rows } = await pool.query(
      `UPDATE lti_deployments SET status = 'inactive'
        WHERE platform_id = $1 AND deployment_id = $2 RETURNING id`,
      [platformId, deploymentId],
    );
    return rows[0] ?? null;
  },
};

module.exports = LtiPlatformModel;
