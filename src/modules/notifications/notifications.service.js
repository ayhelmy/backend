'use strict';

/**
 * Notifications service — SRS §4.12 NOT-01 to NOT-05.
 * All notifications are user-scoped — no cross-user access allowed.
 * dispatch() is called internally by other services (enrollment, grade, publish, etc.)
 */

const { NotificationModel } = require('../../db/models');
const { parsePagination }   = require('../../utils/pagination');
const ApiError              = require('../../utils/apiError');

function mapNotification(row) {
  if (!row) return null;
  return {
    id:            row.id,
    type:          row.type,
    title:         row.title,
    body:          row.body           ?? null,
    referenceType: row.reference_type ?? null,
    referenceId:   row.reference_id   ?? null,
    isRead:        row.is_read,
    readAt:        row.read_at        ?? null,
    createdAt:     row.created_at,
  };
}

// ── list — NOT-01 / NOT-03 (badge count) ─────────────────────────────────────

exports.list = async (userId, q) => {
  const { limit, offset } = parsePagination(q);
  const unreadOnly = q.unread === 'true' || q.unread === true;

  const [rows, unreadCount] = await Promise.all([
    NotificationModel.listForUser(userId, { unreadOnly, limit, offset }),
    NotificationModel.unreadCount(userId),
  ]);

  return {
    notifications: rows.map(mapNotification),
    unreadCount,
  };
};

// ── markRead — NOT-04 ─────────────────────────────────────────────────────────

exports.markRead = async (id, userId) => {
  const result = await NotificationModel.markRead(id, userId);
  if (!result) throw ApiError.notFound('Notification not found or already read.');
  return { id };
};

// ── markAllRead — NOT-04 ──────────────────────────────────────────────────────

exports.markAllRead = async (userId) => {
  const count = await NotificationModel.markAllRead(userId);
  return { marked: count };
};

// ── remove — NOT-05 ───────────────────────────────────────────────────────────

exports.remove = async (id, userId) => {
  const { pool } = require('../../config/database');
  const { rows } = await pool.query(
    `UPDATE notifications SET deleted_at = NOW()
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
      RETURNING id`,
    [id, userId],
  );
  if (!rows.length) throw ApiError.notFound('Notification not found.');
};

// ── dispatch — internal helper for other services ─────────────────────────────

exports.dispatch = async ({ userId, type, title, body, referenceType, referenceId }) => {
  if (!userId || !type || !title) return null;
  return NotificationModel.create({
    userId, type, title, body: body ?? null,
    referenceType: referenceType ?? null,
    referenceId:   referenceId   ?? null,
  });
};
