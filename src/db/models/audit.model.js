/**
 * Audit log model — insert-only query helper.
 * SRS §4.15 AUD-01 – AUD-05; §9 audit_logs schema.
 * Table is immutable: no UPDATE or DELETE operations are exposed here.
 */
'use strict';

const { pool } = require('../../config/database');

const AuditModel = {
  /**
   * Insert an audit log entry.
   * @param {object} params
   * @param {string|null} params.institutionId
   * @param {string|null} params.actorId        — null for system/cron actions
   * @param {string|null} params.actorEmail      — denormalised snapshot
   * @param {string}      params.action          — verb.noun: "user.create"
   * @param {string}      params.entityType      — "User", "Course", etc.
   * @param {string|null} params.entityId        — UUID of the affected record
   * @param {object|null} params.delta           — { before: {…}, after: {…} }
   * @param {string|null} params.ipAddress
   * @param {string|null} params.userAgent
   */
  async log({ institutionId, actorId, actorEmail, action, entityType, entityId, delta, ipAddress, userAgent }) {
    const { rows } = await pool.query(
      `INSERT INTO audit_logs
         (institution_id, actor_id, actor_email, action, entity_type, entity_id,
          delta, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, occurred_at`,
      [institutionId ?? null, actorId ?? null, actorEmail ?? null,
       action, entityType, entityId ?? null,
       delta ? JSON.stringify(delta) : null,
       ipAddress ?? null, userAgent ?? null],
    );
    return rows[0];
  },

  async findById(id) {
    const { rows } = await pool.query(
      `SELECT id, institution_id, actor_id, actor_email, action,
              entity_type, entity_id, delta, ip_address, occurred_at
         FROM audit_logs WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async count({ institutionId, actorId, entityType, entityId, action } = {}) {
    const params = [];
    const filters = [];
    if (institutionId) filters.push(`institution_id = $${params.push(institutionId)}`);
    if (actorId)       filters.push(`actor_id = $${params.push(actorId)}`);
    if (entityType)    filters.push(`entity_type = $${params.push(entityType)}`);
    if (entityId)      filters.push(`entity_id = $${params.push(entityId)}`);
    if (action)        filters.push(`action LIKE $${params.push(action + '%')}`);
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM audit_logs ${where}`,
      params,
    );
    return parseInt(rows[0].total, 10);
  },

  async list({ institutionId, actorId, entityType, entityId, action, limit = 50, offset = 0 } = {}) {
    const params = [limit, offset];
    const filters = [];
    if (institutionId) filters.push(`institution_id = $${params.push(institutionId)}`);
    if (actorId)       filters.push(`actor_id = $${params.push(actorId)}`);
    if (entityType)    filters.push(`entity_type = $${params.push(entityType)}`);
    if (entityId)      filters.push(`entity_id = $${params.push(entityId)}`);
    if (action)        filters.push(`action LIKE $${params.push(action + '%')}`);
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT id, institution_id, actor_id, actor_email, action,
              entity_type, entity_id, delta, ip_address, occurred_at
         FROM audit_logs ${where}
         ORDER BY occurred_at DESC LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },
};

module.exports = AuditModel;
