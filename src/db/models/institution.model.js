/**
 * Institution model — query helpers for the institutions table.
 * SRS §4.4 INST-01 – INST-07; §9 institutions schema.
 */
'use strict';

const { pool } = require('../../config/database');

const InstitutionModel = {
  async findById(id) {
    const { rows } = await pool.query(
      `SELECT id, name, slug, domain, logo_url, primary_color, timezone, locale,
              subscription_plan, max_users, max_storage_gb, status, settings,
              created_at, updated_at
         FROM institutions WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  },

  async findBySlug(slug) {
    const { rows } = await pool.query(
      `SELECT * FROM institutions WHERE slug = $1 AND deleted_at IS NULL`,
      [slug],
    );
    return rows[0] ?? null;
  },

  /**
   * Find institution by email domain — checks the multi-domain table first (INST-04),
   * then falls back to the primary domain column (AUTH-03).
   * Both active-only; returns first match.
   */
  async findByEmailDomain(emailDomain) {
    const { rows } = await pool.query(
      `SELECT DISTINCT
              i.id, i.name, i.slug, i.domain, i.logo_url, i.primary_color,
              i.timezone, i.locale, i.subscription_plan, i.max_users,
              i.max_storage_gb, i.status, i.settings, i.created_at, i.updated_at
         FROM institutions i
         LEFT JOIN institution_domains d ON d.institution_id = i.id
        WHERE i.deleted_at IS NULL
          AND i.status = 'active'
          AND (d.domain = $1 OR i.domain = $1)
        LIMIT 1`,
      [emailDomain],
    );
    return rows[0] ?? null;
  },

  async list({ limit = 20, offset = 0, status } = {}) {
    const params = [limit, offset];
    const statusClause = status ? `AND status = $${params.push(status)}` : '';
    const { rows } = await pool.query(
      `SELECT id, name, slug, domain, logo_url, primary_color, status,
              subscription_plan, max_users, created_at
         FROM institutions WHERE deleted_at IS NULL ${statusClause}
         ORDER BY name LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },

  async create({ name, slug, domain, primaryColor, timezone, locale, subscriptionPlan, maxUsers, maxStorageGb, settings }) {
    const { rows } = await pool.query(
      `INSERT INTO institutions
         (name, slug, domain, primary_color, timezone, locale,
          subscription_plan, max_users, max_storage_gb, settings)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [name, slug, domain ?? null, primaryColor ?? '#0057B7', timezone ?? 'UTC',
       locale ?? 'en', subscriptionPlan ?? 'trial', maxUsers ?? 100,
       maxStorageGb ?? 5, settings ?? {}],
    );
    return rows[0];
  },

  async update(id, fields) {
    const allowed = [
      'name','domain','logo_url','primary_color','timezone','locale',
      'subscription_plan','max_users','max_storage_gb','status','settings',
    ];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        params.push(key === 'settings' ? JSON.stringify(fields[key]) : fields[key]);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (sets.length === 0) return this.findById(id);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE institutions SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} AND deleted_at IS NULL
        RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  },

  async softDelete(id) {
    const { rows } = await pool.query(
      `UPDATE institutions SET deleted_at = NOW(), status = 'suspended', updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [id],
    );
    return rows[0] ?? null;
  },

  // Allowed registration domains (institution_domains table)
  async getDomains(institutionId) {
    const { rows } = await pool.query(
      `SELECT id, domain, is_primary, created_at
         FROM institution_domains WHERE institution_id = $1 ORDER BY is_primary DESC, domain`,
      [institutionId],
    );
    return rows;
  },

  async addDomain(institutionId, domain, isPrimary = false) {
    const { rows } = await pool.query(
      `INSERT INTO institution_domains (institution_id, domain, is_primary)
       VALUES ($1, $2, $3)
       ON CONFLICT (institution_id, domain) DO UPDATE SET is_primary = EXCLUDED.is_primary
       RETURNING *`,
      [institutionId, domain, isPrimary],
    );
    return rows[0];
  },

  async removeDomain(institutionId, domain) {
    const { rows } = await pool.query(
      `DELETE FROM institution_domains WHERE institution_id = $1 AND domain = $2 RETURNING id`,
      [institutionId, domain],
    );
    return rows[0] ?? null;
  },
};

module.exports = InstitutionModel;
