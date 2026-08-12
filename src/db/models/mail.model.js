/**
 * Mail model — mailbox-style messaging (inbox/sent/drafts/archived/trash).
 * SRS "Messaging and Notifications" mailbox refactor (migration 054).
 * Message content lives once in mail_messages; every recipient (including
 * the sender's own Sent copy) has an independent mail_recipients row that
 * carries folder/read/archive/delete state — that's what makes folder
 * actions per-user (sender deleting from Sent never touches a recipient's Inbox).
 */
'use strict';

const { pool } = require('../../config/database');

const LIST_COLUMNS = `
  mr.id AS recipient_row_id, mr.message_id, mr.recipient_type, mr.folder,
  mr.read_at, mr.archived_at, mr.created_at AS recipient_created_at,
  m.thread_id, m.sender_id, m.subject, m.body, m.message_type, m.attachments,
  m.course_id, m.institution_id, m.parent_message_id, m.sent_at, m.created_at,
  su.first_name AS sender_first_name, su.last_name AS sender_last_name, su.avatar_url AS sender_avatar_url,
  c.title AS course_title
`;

function buildFolderFilters(filters, params) {
  const clauses = [];
  if (filters.search) {
    params.push(`%${filters.search}%`);
    clauses.push(`(m.subject ILIKE $${params.length} OR m.body ILIKE $${params.length})`);
  }
  if (filters.unreadOnly) clauses.push(`mr.read_at IS NULL`);
  if (filters.courseId) { params.push(filters.courseId); clauses.push(`m.course_id = $${params.length}`); }
  if (filters.senderId) { params.push(filters.senderId); clauses.push(`m.sender_id = $${params.length}`); }
  if (filters.dateFrom) { params.push(filters.dateFrom); clauses.push(`COALESCE(m.sent_at, m.created_at) >= $${params.length}`); }
  if (filters.dateTo)   { params.push(filters.dateTo);   clauses.push(`COALESCE(m.sent_at, m.created_at) <= $${params.length}`); }
  if (filters.hasAttachments) clauses.push(`(m.attachments IS NOT NULL AND jsonb_array_length(m.attachments) > 0)`);
  return clauses;
}

const MailModel = {
  // ── Threads ───────────────────────────────────────────────────────────────

  async findThreadById(threadId) {
    const { rows } = await pool.query(`SELECT * FROM mail_threads WHERE id = $1`, [threadId]);
    return rows[0] ?? null;
  },

  async createThread({ subject, threadType, institutionId, courseId, createdBy }) {
    const { rows } = await pool.query(
      `INSERT INTO mail_threads (subject, thread_type, institution_id, course_id, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [subject ?? null, threadType ?? 'direct', institutionId, courseId ?? null, createdBy],
    );
    return rows[0];
  },

  async findCourseThreadByType(courseId, threadType) {
    const { rows } = await pool.query(
      `SELECT * FROM mail_threads WHERE course_id = $1 AND thread_type = $2 LIMIT 1`,
      [courseId, threadType],
    );
    return rows[0] ?? null;
  },

  async touchThread(threadId) {
    await pool.query(`UPDATE mail_threads SET updated_at = NOW() WHERE id = $1`, [threadId]);
  },

  // ── Folder listing ────────────────────────────────────────────────────────

  async listFolder(userId, folder, filters = {}, { limit = 20, offset = 0 } = {}) {
    const params = [userId, folder];
    const clauses = buildFolderFilters(filters, params);
    const where = clauses.length ? `AND ${clauses.join(' AND ')}` : '';
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT ${LIST_COLUMNS}
         FROM mail_recipients mr
         JOIN mail_messages m ON m.id = mr.message_id
         LEFT JOIN users su ON su.id = m.sender_id
         LEFT JOIN courses c ON c.id = m.course_id
        WHERE mr.user_id = $1 AND mr.folder = $2 AND mr.deleted_at IS NULL ${where}
        ORDER BY COALESCE(m.sent_at, m.created_at) DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows;
  },

  async countFolder(userId, folder, filters = {}) {
    const params = [userId, folder];
    const clauses = buildFolderFilters(filters, params);
    const where = clauses.length ? `AND ${clauses.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total
         FROM mail_recipients mr
         JOIN mail_messages m ON m.id = mr.message_id
        WHERE mr.user_id = $1 AND mr.folder = $2 AND mr.deleted_at IS NULL ${where}`,
      params,
    );
    return parseInt(rows[0].total, 10);
  },

  async folderCounts(userId) {
    const { rows } = await pool.query(
      `SELECT folder,
              COUNT(*)::INTEGER AS total,
              COUNT(*) FILTER (WHERE read_at IS NULL)::INTEGER AS unread
         FROM mail_recipients
        WHERE user_id = $1 AND deleted_at IS NULL
        GROUP BY folder`,
      [userId],
    );
    const base = { inbox: 0, sent: 0, draft: 0, archived: 0, trash: 0 };
    const unread = { inbox: 0 };
    for (const r of rows) {
      base[r.folder] = r.total;
      if (r.folder === 'inbox') unread.inbox = r.unread;
    }
    return { counts: base, unreadInbox: unread.inbox };
  },

  async unreadCount(userId) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM mail_recipients
        WHERE user_id = $1 AND folder = 'inbox' AND read_at IS NULL AND deleted_at IS NULL`,
      [userId],
    );
    return parseInt(rows[0].total, 10);
  },

  // ── Single message access ────────────────────────────────────────────────

  /** The caller's own mailbox row for a message — the access-check primitive. */
  async getMailboxRow(messageId, userId) {
    const { rows } = await pool.query(
      `SELECT * FROM mail_recipients WHERE message_id = $1 AND user_id = $2`,
      [messageId, userId],
    );
    return rows[0] ?? null;
  },

  async getMessageById(messageId) {
    const { rows } = await pool.query(`SELECT * FROM mail_messages WHERE id = $1`, [messageId]);
    return rows[0] ?? null;
  },

  /** All recipient rows for a message (excludes the sender's own Sent copy), joined with user names. */
  async getRecipientsForMessage(messageId) {
    const { rows } = await pool.query(
      `SELECT mr.user_id, mr.recipient_type, u.first_name, u.last_name, u.email
         FROM mail_recipients mr
         JOIN users u ON u.id = mr.user_id
        WHERE mr.message_id = $1 AND mr.recipient_type IS NOT NULL
        ORDER BY mr.recipient_type, u.first_name`,
      [messageId],
    );
    return rows;
  },

  /** Names for To/Cc/Bcc across a batch of messages (for Sent-folder list rendering). */
  async getRecipientNamesForMessages(messageIds) {
    if (!messageIds.length) return new Map();
    const { rows } = await pool.query(
      `SELECT mr.message_id, mr.user_id, mr.recipient_type, u.first_name, u.last_name
         FROM mail_recipients mr
         JOIN users u ON u.id = mr.user_id
        WHERE mr.message_id = ANY($1::uuid[]) AND mr.recipient_type IS NOT NULL`,
      [messageIds],
    );
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.message_id)) map.set(r.message_id, { to: [], cc: [], bcc: [] });
      map.get(r.message_id)[r.recipient_type].push({ userId: r.user_id, firstName: r.first_name, lastName: r.last_name });
    }
    return map;
  },

  /** Messages in a thread the given user has mailbox access to (BCC/participant privacy preserved). */
  async listThreadHistory(threadId, userId) {
    const { rows } = await pool.query(
      `SELECT m.*, su.first_name AS sender_first_name, su.last_name AS sender_last_name, su.avatar_url AS sender_avatar_url
         FROM mail_messages m
         JOIN mail_recipients mr ON mr.message_id = m.id AND mr.user_id = $2
         LEFT JOIN users su ON su.id = m.sender_id
        WHERE m.thread_id = $1
        ORDER BY COALESCE(m.sent_at, m.created_at) ASC`,
      [threadId, userId],
    );
    return rows;
  },

  /** All messages in a thread, unfiltered by per-user mailbox state — used for
   *  broadcast content (course announcements) where anyone with course access
   *  should see the full history, not just messages addressed to them. */
  async listMessagesInThread(threadId, { limit = 50, offset = 0 } = {}) {
    const { rows } = await pool.query(
      `SELECT m.*, su.first_name, su.last_name, su.avatar_url
         FROM mail_messages m
         LEFT JOIN users su ON su.id = m.sender_id
        WHERE m.thread_id = $1
        ORDER BY COALESCE(m.sent_at, m.created_at) ASC
        LIMIT $2 OFFSET $3`,
      [threadId, limit, offset],
    );
    return rows;
  },

  async countMessagesInThread(threadId) {
    const { rows } = await pool.query(`SELECT COUNT(*) AS total FROM mail_messages WHERE thread_id = $1`, [threadId]);
    return parseInt(rows[0].total, 10);
  },

  // ── Compose / send ────────────────────────────────────────────────────────

  /**
   * Creates a message and fans out mail_recipients rows: one 'sent' row for
   * the sender, one 'inbox' row per recipient. `recipients` = [{ userId, type }].
   */
  async createMessage(data, recipients) {
    const {
      threadId, institutionId, courseId, senderId, subject, body,
      parentMessageId, messageType, attachments,
    } = data;

    const { rows: [message] } = await pool.query(
      `INSERT INTO mail_messages
         (thread_id, institution_id, course_id, sender_id, subject, body,
          parent_message_id, message_type, attachments, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW())
       RETURNING *`,
      [threadId, institutionId, courseId ?? null, senderId, subject ?? null, body,
       parentMessageId ?? null, messageType ?? 'normal',
       attachments ? JSON.stringify(attachments) : null],
    );

    await pool.query(
      `INSERT INTO mail_recipients (message_id, user_id, recipient_type, folder, read_at)
       VALUES ($1, $2, NULL, 'sent', NOW())`,
      [message.id, senderId],
    );

    for (const r of recipients) {
      await pool.query(
        `INSERT INTO mail_recipients (message_id, user_id, recipient_type, folder)
         VALUES ($1, $2, $3, 'inbox')
         ON CONFLICT (message_id, user_id) DO NOTHING`,
        [message.id, r.userId, r.type],
      );
    }

    await this.touchThread(threadId);
    return message;
  },

  // ── Drafts ────────────────────────────────────────────────────────────────

  async createDraft(data) {
    const {
      threadId, institutionId, courseId, senderId, subject, body,
      parentMessageId, messageType, attachments, draftRecipients,
    } = data;

    const { rows: [draft] } = await pool.query(
      `INSERT INTO mail_messages
         (thread_id, institution_id, course_id, sender_id, subject, body,
          parent_message_id, message_type, attachments, draft_recipients, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NULL)
       RETURNING *`,
      [threadId, institutionId, courseId ?? null, senderId, subject ?? null, body ?? '',
       parentMessageId ?? null, messageType ?? 'normal',
       attachments ? JSON.stringify(attachments) : null,
       JSON.stringify(draftRecipients ?? { to: [], cc: [], bcc: [] })],
    );

    await pool.query(
      `INSERT INTO mail_recipients (message_id, user_id, recipient_type, folder)
       VALUES ($1, $2, NULL, 'draft')`,
      [draft.id, senderId],
    );

    return draft;
  },

  async updateDraft(messageId, senderId, fields) {
    const allowed = ['subject', 'body', 'course_id', 'attachments', 'draft_recipients'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        params.push(key === 'attachments' || key === 'draft_recipients' ? JSON.stringify(fields[key]) : fields[key]);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (!sets.length) return this.getMessageById(messageId);
    sets.push(`updated_at = NOW()`);
    params.push(messageId, senderId);
    const { rows } = await pool.query(
      `UPDATE mail_messages SET ${sets.join(', ')}
        WHERE id = $${params.length - 1} AND sender_id = $${params.length} AND sent_at IS NULL
        RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  },

  async deleteDraft(messageId, senderId) {
    const { rows } = await pool.query(
      `DELETE FROM mail_messages WHERE id = $1 AND sender_id = $2 AND sent_at IS NULL RETURNING id`,
      [messageId, senderId],
    );
    return rows[0] ?? null;
  },

  /** Promotes a draft to sent: stamps sent_at, flips the author's row to 'sent', fans out real recipients. */
  async sendDraft(messageId, senderId, recipients) {
    const { rows: [message] } = await pool.query(
      `UPDATE mail_messages SET sent_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND sender_id = $2 AND sent_at IS NULL
        RETURNING *`,
      [messageId, senderId],
    );
    if (!message) return null;

    await pool.query(
      `UPDATE mail_recipients SET folder = 'sent', read_at = NOW(), updated_at = NOW()
        WHERE message_id = $1 AND user_id = $2`,
      [messageId, senderId],
    );

    for (const r of recipients) {
      await pool.query(
        `INSERT INTO mail_recipients (message_id, user_id, recipient_type, folder)
         VALUES ($1, $2, $3, 'inbox')
         ON CONFLICT (message_id, user_id) DO NOTHING`,
        [messageId, r.userId, r.type],
      );
    }

    await this.touchThread(message.thread_id);
    return message;
  },

  // ── Per-recipient mailbox actions ────────────────────────────────────────

  async setRead(messageId, userId, isRead) {
    const { rows } = await pool.query(
      `UPDATE mail_recipients SET read_at = $3, updated_at = NOW()
        WHERE message_id = $1 AND user_id = $2 RETURNING id`,
      [messageId, userId, isRead ? new Date() : null],
    );
    return rows[0] ?? null;
  },

  async setArchived(messageId, userId) {
    const { rows } = await pool.query(
      `UPDATE mail_recipients SET folder = 'archived', archived_at = NOW(), updated_at = NOW()
        WHERE message_id = $1 AND user_id = $2 AND folder IN ('inbox','sent') RETURNING id`,
      [messageId, userId],
    );
    return rows[0] ?? null;
  },

  async restore(messageId, userId) {
    const { rows } = await pool.query(
      `UPDATE mail_recipients SET folder = 'inbox', archived_at = NULL, deleted_at = NULL, updated_at = NOW()
        WHERE message_id = $1 AND user_id = $2 AND folder IN ('archived','trash') RETURNING id`,
      [messageId, userId],
    );
    return rows[0] ?? null;
  },

  /** First call moves to Trash (soft, per-user); a second call on an already-trashed row purges it. */
  async moveToTrashOrPurge(messageId, userId) {
    const { rows: [current] } = await pool.query(
      `SELECT folder FROM mail_recipients WHERE message_id = $1 AND user_id = $2`,
      [messageId, userId],
    );
    if (!current) return null;

    if (current.folder !== 'trash') {
      const { rows } = await pool.query(
        `UPDATE mail_recipients SET folder = 'trash', deleted_at = NOW(), updated_at = NOW()
          WHERE message_id = $1 AND user_id = $2 RETURNING id`,
        [messageId, userId],
      );
      return { action: 'trashed', row: rows[0] };
    }

    const { rows } = await pool.query(
      `DELETE FROM mail_recipients WHERE message_id = $1 AND user_id = $2 RETURNING id`,
      [messageId, userId],
    );
    return { action: 'purged', row: rows[0] };
  },

  // ── Attachments (normalized table, mirrors the JSONB summary on the message) ─

  async addAttachment({ messageId, fileName, fileUrl, fileType, fileSize, uploadedBy }) {
    const { rows } = await pool.query(
      `INSERT INTO message_attachments (message_id, file_name, file_url, file_type, file_size, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [messageId, fileName, fileUrl, fileType ?? null, fileSize ?? null, uploadedBy],
    );
    return rows[0];
  },
};

module.exports = MailModel;
