'use strict';

/**
 * NotificationEventDispatcher — the single entry point every domain service
 * calls to raise a notification event. Replaces the old notifyAsync()
 * placeholder in courses.service.js.
 *
 * emit() is fire-and-forget from the caller's perspective (never throws,
 * never blocks the calling transaction) but awaiting it is still safe/cheap
 * since the DB insert is a single bulk statement.
 */

const { pool } = require('../../config/database');
const { NotificationModel, NotificationPreferenceModel } = require('../../db/models');
const { render } = require('./notification-templates');
const { sendNotificationEmail } = require('./email-notification.service');
const logger = require('../../utils/logger');

const EMAILABLE_PRIORITIES = ['high', 'urgent'];

async function loadPreferences(userIds) {
  if (!userIds.length) return new Map();
  const { rows } = await pool.query(
    `SELECT * FROM notification_preferences WHERE user_id = ANY($1::uuid[])`,
    [userIds],
  );
  const map = new Map(rows.map((r) => [r.user_id, r]));
  // Users without a row yet get the defaults (lazily persisted on first
  // preferences read/write, not here — avoid extra writes on the hot path).
  return map;
}

function prefsAllow(pref, category) {
  if (!pref) return true; // no row yet => defaults, which are all-enabled
  if (!pref.in_app_enabled) return false;
  return pref.preferences?.[category] !== false;
}

function emailAllowed(pref, category, priority) {
  if (!EMAILABLE_PRIORITIES.includes(priority)) return false;
  if (!pref) return true;
  if (!pref.email_enabled) return false;
  return pref.preferences?.[category] !== false;
}

/**
 * @param {string} eventName
 * @param {object} opts
 * @param {string[]} opts.recipientIds
 * @param {string|null} [opts.senderId]
 * @param {string|null} [opts.institutionId]
 * @param {string|null} [opts.departmentId]
 * @param {string|null} [opts.courseId]
 * @param {string|null} [opts.moduleId]
 * @param {string|null} [opts.lessonId]
 * @param {object} [opts.data] — template variables (also stored on the row for the frontend)
 */
async function emit(eventName, opts) {
  try {
    const {
      recipientIds = [], senderId = null, institutionId = null, departmentId = null,
      courseId = null, moduleId = null, lessonId = null, data = {},
    } = opts;

    const recipients = [...new Set(recipientIds)].filter((id) => id && id !== senderId);
    if (!recipients.length) return;

    const rendered = render(eventName, data);
    const prefsMap = await loadPreferences(recipients);

    const eligible = recipients.filter((id) => prefsAllow(prefsMap.get(id), rendered.category));
    if (!eligible.length) return;

    const rows = await NotificationModel.createMany(eligible.map((userId) => ({
      userId,
      type: rendered.type,
      title: rendered.title,
      body: rendered.body,
      referenceType: courseId ? 'course' : null,
      referenceId: courseId ?? null,
      institutionId, departmentId, courseId, moduleId, lessonId, senderId,
      priority: rendered.priority,
      channel: 'in_app',
      data: { ...data, actionUrl: rendered.actionUrl },
    })));

    // Never hit the real SMTP relay from automated test runs.
    const emailRecipients = process.env.NODE_ENV === 'test'
      ? []
      : eligible.filter((id) => emailAllowed(prefsMap.get(id), rendered.category, rendered.priority));
    if (emailRecipients.length) {
      setImmediate(() => {
        pool.query(`SELECT id, email FROM users WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`, [emailRecipients])
          .then(({ rows: users }) => Promise.all(users.map((u) =>
            sendNotificationEmail(u, { title: rendered.title, body: rendered.body, actionUrl: rendered.actionUrl }),
          )))
          .catch((err) => logger.error('Notification email dispatch failed', { eventName, error: err.message }));
      });
    }

    return rows;
  } catch (err) {
    // Notifications must never break the calling business transaction.
    logger.error('Notification dispatch failed', { eventName, error: err.message });
  }
}

module.exports = { emit };
