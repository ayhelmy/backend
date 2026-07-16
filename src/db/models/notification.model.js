/**
 * Notification and message model.
 * SRS §4.12 NOT-01 – NOT-05 (in-app notifications).
 * SRS §4.13 MSG-01 – MSG-06 (direct and course messaging).
 */
'use strict';

const { pool } = require('../../config/database');

const NotificationModel = {
  // ------------------------------------------------------------------
  // Notifications
  // ------------------------------------------------------------------

  async create({ userId, type, title, body, referenceType, referenceId }) {
    const { rows } = await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, reference_type, reference_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [userId, type, title, body ?? null, referenceType ?? null, referenceId ?? null],
    );
    return rows[0];
  },

  async listForUser(userId, { unreadOnly = false, limit = 20, offset = 0 } = {}) {
    const params = [userId, limit, offset];
    const unread = unreadOnly ? 'AND is_read = FALSE' : '';
    const { rows } = await pool.query(
      `SELECT id, type, title, body, reference_type, reference_id,
              is_read, read_at, created_at
         FROM notifications
        WHERE user_id = $1 ${unread}
        ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      params,
    );
    return rows;
  },

  async unreadCount(userId) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM notifications
        WHERE user_id = $1 AND is_read = FALSE`,
      [userId],
    );
    return parseInt(rows[0].total, 10);
  },

  async markRead(id, userId) {
    const { rows } = await pool.query(
      `UPDATE notifications SET is_read = TRUE, read_at = NOW()
        WHERE id = $1 AND user_id = $2 AND is_read = FALSE
        RETURNING id`,
      [id, userId],
    );
    return rows[0] ?? null;
  },

  async markAllRead(userId) {
    const { rows } = await pool.query(
      `UPDATE notifications SET is_read = TRUE, read_at = NOW()
        WHERE user_id = $1 AND is_read = FALSE
        RETURNING COUNT(*)`,
      [userId],
    );
    return rows.length;
  },

  // ------------------------------------------------------------------
  // Message threads and messages
  // ------------------------------------------------------------------

  async findThreadById(threadId) {
    const { rows } = await pool.query(
      `SELECT id, subject, thread_type, course_id, created_by, created_at, updated_at
         FROM message_threads WHERE id = $1`,
      [threadId],
    );
    return rows[0] ?? null;
  },

  async createThread({ subject, threadType, courseId, createdBy }) {
    const { rows } = await pool.query(
      `INSERT INTO message_threads (subject, thread_type, course_id, created_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [subject ?? null, threadType ?? 'direct', courseId ?? null, createdBy],
    );
    return rows[0];
  },

  async addParticipant(threadId, userId) {
    await pool.query(
      `INSERT INTO thread_participants (thread_id, user_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [threadId, userId],
    );
  },

  async isParticipant(threadId, userId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM thread_participants WHERE thread_id = $1 AND user_id = $2`,
      [threadId, userId],
    );
    return rows.length > 0;
  },

  async listThreadsForUser(userId, { limit = 20, offset = 0 } = {}) {
    const { rows } = await pool.query(
      `SELECT t.id, t.subject, t.thread_type, t.course_id, t.updated_at,
              tp.last_read_at,
              (SELECT body FROM messages m
                WHERE m.thread_id = t.id AND m.deleted_at IS NULL
                ORDER BY m.created_at DESC LIMIT 1) AS last_message
         FROM thread_participants tp
         JOIN message_threads t ON t.id = tp.thread_id
        WHERE tp.user_id = $1
        ORDER BY t.updated_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    return rows;
  },

  async sendMessage({ threadId, senderId, body, attachmentUrl }) {
    const { rows } = await pool.query(
      `INSERT INTO messages (thread_id, sender_id, body, attachment_url)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [threadId, senderId, body, attachmentUrl ?? null],
    );
    // Bump thread.updated_at
    await pool.query(
      `UPDATE message_threads SET updated_at = NOW() WHERE id = $1`,
      [threadId],
    );
    return rows[0];
  },

  async listMessages(threadId, { limit = 50, offset = 0 } = {}) {
    const { rows } = await pool.query(
      `SELECT m.id, m.sender_id, m.body, m.attachment_url, m.created_at,
              u.first_name, u.last_name, u.avatar_url
         FROM messages m
         JOIN users u ON u.id = m.sender_id
        WHERE m.thread_id = $1 AND m.deleted_at IS NULL
        ORDER BY m.created_at ASC LIMIT $2 OFFSET $3`,
      [threadId, limit, offset],
    );
    return rows;
  },

  async softDeleteMessage(messageId, userId) {
    const { rows } = await pool.query(
      `UPDATE messages SET deleted_at = NOW()
        WHERE id = $1 AND sender_id = $2 AND deleted_at IS NULL
        RETURNING id`,
      [messageId, userId],
    );
    return rows[0] ?? null;
  },

  async updateLastRead(threadId, userId) {
    await pool.query(
      `UPDATE thread_participants SET last_read_at = NOW()
        WHERE thread_id = $1 AND user_id = $2`,
      [threadId, userId],
    );
  },
};

module.exports = NotificationModel;
