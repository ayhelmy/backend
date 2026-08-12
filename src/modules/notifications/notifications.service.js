'use strict';

/**
 * Notifications service — SRS §4.12 NOT-01 to NOT-05.
 * All notifications are user-scoped — no cross-user access allowed.
 * Automatic notifications are raised via event-dispatcher.service.js; this
 * file is the read/manage-own API surface plus a thin dispatch() for
 * single-recipient ad-hoc notifications.
 */

const { NotificationModel } = require('../../db/models');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const ApiError = require('../../utils/apiError');

function mapNotification(row) {
  if (!row) return null;
  return {
    id:            row.id,
    type:          row.type,
    title:         row.title,
    body:          row.body           ?? null,
    referenceType: row.reference_type ?? null,
    referenceId:   row.reference_id   ?? null,
    institutionId: row.institution_id ?? null,
    departmentId:  row.department_id  ?? null,
    courseId:      row.course_id      ?? null,
    moduleId:      row.module_id      ?? null,
    lessonId:      row.lesson_id      ?? null,
    senderId:      row.sender_id      ?? null,
    priority:      row.priority,
    channel:       row.channel,
    data:          row.data           ?? null,
    status:        row.status,
    isRead:        row.is_read,
    readAt:        row.read_at        ?? null,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at     ?? null,
  };
}

// ── list — NOT-01 / NOT-03 (badge count) ─────────────────────────────────────

exports.list = async (userId, q) => {
  const { page, limit, offset } = parsePagination(q);
  const filters = { status: q.status, type: q.type, priority: q.priority };

  const [rows, total, unreadCount] = await Promise.all([
    NotificationModel.listForUser(userId, { ...filters, limit, offset }),
    NotificationModel.count(userId, filters),
    NotificationModel.unreadCount(userId),
  ]);

  return {
    notifications: rows.map(mapNotification),
    unreadCount,
    meta: buildPaginationMeta(total, page, limit),
  };
};

// ── unreadCount — powers the header bell badge without fetching the list ────

exports.unreadCount = async (userId) => ({ unreadCount: await NotificationModel.unreadCount(userId) });

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

// ── archive — NOT-05 ──────────────────────────────────────────────────────────

exports.archive = async (id, userId) => {
  const result = await NotificationModel.archive(id, userId);
  if (!result) throw ApiError.notFound('Notification not found or already archived.');
  return { id };
};

// ── remove — NOT-05 (soft: archives, matching "archive per current policy") ──

exports.remove = async (id, userId) => {
  const result = await NotificationModel.archive(id, userId) ?? await NotificationModel.remove(id, userId);
  if (!result) throw ApiError.notFound('Notification not found.');
};

// ── dispatch — single-recipient ad-hoc notification (no template lookup) ─────

exports.dispatch = async ({ userId, type, title, body, referenceType, referenceId, priority, data }) => {
  if (!userId || !type || !title) return null;
  return NotificationModel.create({
    userId, type, title, body: body ?? null,
    referenceType: referenceType ?? null,
    referenceId:   referenceId   ?? null,
    priority:      priority      ?? 'normal',
    data:          data          ?? null,
  });
};
