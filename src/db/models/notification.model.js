/**
 * Notification model.
 * SRS §4.12 NOT-01 – NOT-05 (in-app notifications), extended (migration 053)
 * with tenant/course scoping, priority, channel, and status.
 */
'use strict';

const { pool } = require('../../config/database');

const NotificationModel = {
  async create({
    userId, type, title, body, referenceType, referenceId,
    institutionId, departmentId, courseId, moduleId, lessonId, senderId,
    priority, channel, data,
  }) {
    const { rows } = await pool.query(
      `INSERT INTO notifications
         (user_id, type, title, body, reference_type, reference_id,
          institution_id, department_id, course_id, module_id, lesson_id, sender_id,
          priority, channel, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [userId, type, title, body ?? null, referenceType ?? null, referenceId ?? null,
       institutionId ?? null, departmentId ?? null, courseId ?? null, moduleId ?? null,
       lessonId ?? null, senderId ?? null,
       priority ?? 'normal', channel ?? 'in_app', data ? JSON.stringify(data) : null],
    );
    return rows[0];
  },

  /** Bulk-insert one notification per recipient in a single round trip. */
  async createMany(rowsIn) {
    if (!rowsIn.length) return [];
    const cols = ['user_id', 'type', 'title', 'body', 'reference_type', 'reference_id',
      'institution_id', 'department_id', 'course_id', 'module_id', 'lesson_id', 'sender_id',
      'priority', 'channel', 'data'];
    const params = [];
    const valuesSql = rowsIn.map((r) => {
      const vals = [
        r.userId, r.type, r.title, r.body ?? null, r.referenceType ?? null, r.referenceId ?? null,
        r.institutionId ?? null, r.departmentId ?? null, r.courseId ?? null, r.moduleId ?? null,
        r.lessonId ?? null, r.senderId ?? null,
        r.priority ?? 'normal', r.channel ?? 'in_app', r.data ? JSON.stringify(r.data) : null,
      ];
      const placeholders = vals.map((v) => `$${params.push(v)}`);
      return `(${placeholders.join(',')})`;
    }).join(',');

    const { rows } = await pool.query(
      `INSERT INTO notifications (${cols.join(', ')}) VALUES ${valuesSql} RETURNING *`,
      params,
    );
    return rows;
  },

  async listForUser(userId, { status, type, priority, limit = 20, offset = 0 } = {}) {
    const params = [userId];
    const filters = [`user_id = $1`];
    if (status)   filters.push(`status = $${params.push(status)}`);
    if (type)     filters.push(`type = $${params.push(type)}`);
    if (priority) filters.push(`priority = $${params.push(priority)}`);
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT id, type, title, body, reference_type, reference_id,
              institution_id, department_id, course_id, module_id, lesson_id, sender_id,
              priority, channel, data, status, is_read, read_at, created_at, updated_at
         FROM notifications
        WHERE ${filters.join(' AND ')}
        ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows;
  },

  async count(userId, { status, type, priority } = {}) {
    const params = [userId];
    const filters = [`user_id = $1`];
    if (status)   filters.push(`status = $${params.push(status)}`);
    if (type)     filters.push(`type = $${params.push(type)}`);
    if (priority) filters.push(`priority = $${params.push(priority)}`);
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM notifications WHERE ${filters.join(' AND ')}`,
      params,
    );
    return parseInt(rows[0].total, 10);
  },

  async unreadCount(userId) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM notifications WHERE user_id = $1 AND status = 'unread'`,
      [userId],
    );
    return parseInt(rows[0].total, 10);
  },

  async markRead(id, userId) {
    const { rows } = await pool.query(
      `UPDATE notifications SET status = 'read', is_read = TRUE, read_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND user_id = $2 AND status = 'unread'
        RETURNING id`,
      [id, userId],
    );
    return rows[0] ?? null;
  },

  async markAllRead(userId) {
    const { rows } = await pool.query(
      `UPDATE notifications SET status = 'read', is_read = TRUE, read_at = NOW(), updated_at = NOW()
        WHERE user_id = $1 AND status = 'unread'
        RETURNING id`,
      [userId],
    );
    return rows.length;
  },

  async archive(id, userId) {
    const { rows } = await pool.query(
      `UPDATE notifications SET status = 'archived', updated_at = NOW()
        WHERE id = $1 AND user_id = $2 AND status != 'archived'
        RETURNING id`,
      [id, userId],
    );
    return rows[0] ?? null;
  },

  async remove(id, userId) {
    const { rows } = await pool.query(
      `DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId],
    );
    return rows[0] ?? null;
  },
};

module.exports = NotificationModel;
