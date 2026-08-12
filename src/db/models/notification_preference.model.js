/**
 * Notification preference model — one row per user, lazily created on first
 * read/write (same lazy-upsert pattern used elsewhere, e.g. grade_items).
 */
'use strict';

const { pool } = require('../../config/database');

const DEFAULT_PREFERENCES = {
  messages: true,
  course_announcements: true,
  enrollment_updates: true,
  quiz_updates: true,
  grade_updates: true,
  simulation_updates: true,
  system_alerts: true,
};

const NotificationPreferenceModel = {
  DEFAULT_PREFERENCES,

  async getByUser(userId) {
    const { rows } = await pool.query(
      `SELECT * FROM notification_preferences WHERE user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  },

  async ensureForUser(userId, institutionId) {
    const existing = await this.getByUser(userId);
    if (existing) return existing;
    const { rows } = await pool.query(
      `INSERT INTO notification_preferences (user_id, institution_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING *`,
      [userId, institutionId ?? null],
    );
    return rows[0];
  },

  async upsert(userId, institutionId, {
    emailEnabled, inAppEnabled, pushEnabled, digestFrequency, preferences,
  }) {
    await this.ensureForUser(userId, institutionId);
    const fields = [];
    const params = [];
    if (emailEnabled    !== undefined) { params.push(emailEnabled);    fields.push(`email_enabled = $${params.length}`); }
    if (inAppEnabled    !== undefined) { params.push(inAppEnabled);    fields.push(`in_app_enabled = $${params.length}`); }
    if (pushEnabled     !== undefined) { params.push(pushEnabled);     fields.push(`push_enabled = $${params.length}`); }
    if (digestFrequency !== undefined) { params.push(digestFrequency); fields.push(`digest_frequency = $${params.length}`); }
    if (preferences     !== undefined) {
      params.push(JSON.stringify({ ...DEFAULT_PREFERENCES, ...preferences }));
      fields.push(`preferences = $${params.length}`);
    }
    fields.push(`updated_at = NOW()`);
    params.push(userId);

    const { rows } = await pool.query(
      `UPDATE notification_preferences SET ${fields.join(', ')} WHERE user_id = $${params.length} RETURNING *`,
      params,
    );
    return rows[0];
  },
};

module.exports = NotificationPreferenceModel;
