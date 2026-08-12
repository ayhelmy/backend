'use strict';

/**
 * Mail service — mailbox-style messaging (SRS "Messaging and Notifications",
 * mailbox refactor). Asynchronous, email-like: no live chat, no typing
 * indicators, no presence. Every recipient (including the sender's own Sent
 * copy) has independent folder/read/archive/delete state (mail_recipients).
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('../../config');
const { pool } = require('../../config/database');
const { MailModel, CourseModel, UserModel, AuditModel } = require('../../db/models');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const ApiError = require('../../utils/apiError');
const mailAccess = require('./mail-access.service');
const eventDispatcher = require('../notifications/event-dispatcher.service');

function getMailAttachmentsDir() {
  return path.isAbsolute(config.storage.mailAttachmentsDir)
    ? config.storage.mailAttachmentsDir
    : path.resolve(__dirname, '..', '..', '..', config.storage.mailAttachmentsDir);
}

const MAX_BODY_LENGTH = 20000;
const MAX_SUBJECT_LENGTH = 255;

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(text, len) {
  if (!text) return '';
  return text.length > len ? `${text.slice(0, len)}…` : text;
}

function fullName(row, prefix = '') {
  const first = row[`${prefix}first_name`];
  const last = row[`${prefix}last_name`];
  return `${first ?? ''} ${last ?? ''}`.trim();
}

function mapListRow(row) {
  const attachments = row.attachments ?? [];
  return {
    id: row.message_id,
    threadId: row.thread_id,
    senderId: row.sender_id,
    senderName: fullName(row, 'sender_'),
    senderAvatarUrl: row.sender_avatar_url ?? null,
    subject: row.subject ?? '(no subject)',
    bodyPreview: truncate((row.body ?? '').replace(/\s+/g, ' '), 140),
    messageType: row.message_type,
    hasAttachments: Array.isArray(attachments) && attachments.length > 0,
    attachmentCount: Array.isArray(attachments) ? attachments.length : 0,
    courseId: row.course_id ?? null,
    courseTitle: row.course_title ?? null,
    isRead: row.read_at != null,
    folder: row.folder,
    recipientType: row.recipient_type,
    sentAt: row.sent_at ?? null,
    createdAt: row.created_at,
  };
}

async function assertActorCanUseCourse(actor, course) {
  if (!course) return;
  if (actor.roles?.includes('super_admin')) return;
  if (course.institution_id !== actor.institutionId) {
    throw ApiError.forbidden('You do not have access to this course.');
  }
  if (actor.roles?.includes('institution_admin')) return;
  if (actor.roles?.includes('dept_manager')) return; // institution match already checked above
  if (actor.roles?.includes('instructor')) {
    if (course.instructor_id !== actor.id) throw ApiError.forbidden('You are not the instructor of this course.');
    return;
  }
  const { rows: taRows } = await pool.query(
    `SELECT 1 FROM course_teaching_assistants WHERE course_id = $1 AND user_id = $2`,
    [course.id, actor.id],
  );
  if (taRows.length) return;

  const enrollment = await CourseModel.findEnrollment(course.id, actor.id);
  if (!enrollment || enrollment.status !== 'active') {
    throw ApiError.forbidden('You do not have access to this course.');
  }
}

/** Validates + normalizes to/cc/bcc into a deduped recipient list, course-aware. */
async function resolveAndValidateRecipients({ to = [], cc = [], bcc = [] }, actor, course) {
  const tagged = [
    ...to.map((userId) => ({ userId, type: 'to' })),
    ...cc.map((userId) => ({ userId, type: 'cc' })),
    ...bcc.map((userId) => ({ userId, type: 'bcc' })),
  ];
  if (!tagged.length) throw ApiError.badRequest('At least one recipient is required.');

  const seen = new Set();
  const deduped = tagged.filter((r) => {
    if (seen.has(r.userId)) return false;
    seen.add(r.userId);
    return true;
  });

  if (course) {
    // Course-scoped mail: every recipient must be enrolled/assigned staff on that course.
    const ids = deduped.map((r) => r.userId);
    const { rows } = await pool.query(
      `SELECT user_id FROM enrollments WHERE course_id = $1 AND user_id = ANY($2::uuid[]) AND status = 'active'
       UNION
       SELECT instructor_id AS user_id FROM courses WHERE id = $1 AND instructor_id = ANY($2::uuid[])
       UNION
       SELECT user_id FROM course_teaching_assistants WHERE course_id = $1 AND user_id = ANY($2::uuid[])`,
      [course.id, ids],
    );
    const allowed = new Set(rows.map((r) => r.user_id));
    if (!ids.every((id) => allowed.has(id))) {
      throw ApiError.forbidden('All recipients must be enrolled or assigned staff in this course.');
    }
  } else {
    for (const r of deduped) {
      const allowed = await mailAccess.canMessage(actor, r.userId);
      if (!allowed) throw ApiError.forbidden('You are not permitted to message one or more of these recipients.');
    }
  }

  return deduped;
}

function assertBodyLimits(body, subject) {
  if (subject && subject.length > MAX_SUBJECT_LENGTH) throw ApiError.badRequest('Subject is too long.');
  if (body && body.length > MAX_BODY_LENGTH) throw ApiError.badRequest('Message body is too long.');
}

async function notifyRecipients(message, recipients, actor, course) {
  const recipientIds = recipients.map((r) => r.userId).filter((id) => id !== actor.id);
  if (!recipientIds.length) return;
  const sender = await UserModel.findById(actor.id);
  eventDispatcher.emit('message.new', {
    recipientIds,
    senderId: actor.id,
    institutionId: message.institution_id,
    courseId: message.course_id,
    data: {
      senderName: `${sender?.first_name ?? ''} ${sender?.last_name ?? ''}`.trim(),
      subject: message.subject || '(no subject)',
      messageId: message.id,
      courseTitle: course?.title ?? null,
    },
  });
}

// ── Folder listing ────────────────────────────────────────────────────────────

exports.list = async (folder, actor, q) => {
  const { page, limit, offset } = parsePagination(q);
  const filters = {
    search: q.search,
    unreadOnly: q.unread_only === 'true' || q.unread_only === true,
    courseId: q.course_id,
    senderId: q.sender_id,
    dateFrom: q.date_from,
    dateTo: q.date_to,
    hasAttachments: q.has_attachments === 'true' || q.has_attachments === true,
  };

  const [rows, total] = await Promise.all([
    MailModel.listFolder(actor.id, folder, filters, { limit, offset }),
    MailModel.countFolder(actor.id, folder, filters),
  ]);

  const items = rows.map(mapListRow);

  // Sent/Draft folders show the recipient list instead of (or in addition to) the sender.
  if ((folder === 'sent' || folder === 'draft') && items.length) {
    const nameMap = await MailModel.getRecipientNamesForMessages(items.map((i) => i.id));
    for (const item of items) {
      const names = nameMap.get(item.id);
      item.recipients = names
        ? [...names.to, ...names.cc].map((u) => `${u.firstName} ${u.lastName}`.trim())
        : [];
    }
  }

  return { messages: items, meta: buildPaginationMeta(total, page, limit) };
};

exports.unreadCount = async (actor) => ({ unreadCount: await MailModel.unreadCount(actor.id) });

exports.folderCounts = async (actor) => MailModel.folderCounts(actor.id);

// ── Message detail ────────────────────────────────────────────────────────────

exports.getDetail = async (messageId, actor) => {
  const mailboxRow = await MailModel.getMailboxRow(messageId, actor.id);
  if (!mailboxRow) throw ApiError.notFound('Message not found.');

  const message = await MailModel.getMessageById(messageId);
  if (!message) throw ApiError.notFound('Message not found.');

  const isSender = message.sender_id === actor.id;
  const [recipients, sender, course, thread] = await Promise.all([
    MailModel.getRecipientsForMessage(messageId),
    UserModel.findById(message.sender_id),
    message.course_id ? CourseModel.findById(message.course_id) : null,
    MailModel.listThreadHistory(message.thread_id, actor.id),
  ]);

  let to = recipients.filter((r) => r.recipient_type === 'to');
  let cc = recipients.filter((r) => r.recipient_type === 'cc');
  let bcc = recipients.filter((r) => r.recipient_type === 'bcc');

  // Drafts have no mail_recipients rows yet — their intended recipients live
  // in draft_recipients until Send fans them out for real.
  if (!message.sent_at && message.draft_recipients) {
    const draftIds = [
      ...(message.draft_recipients.to ?? []),
      ...(message.draft_recipients.cc ?? []),
      ...(message.draft_recipients.bcc ?? []),
    ];
    if (draftIds.length) {
      const { rows: users } = await pool.query(
        `SELECT id, first_name, last_name FROM users WHERE id = ANY($1::uuid[])`, [draftIds],
      );
      const byId = new Map(users.map((u) => [u.id, u]));
      const toRef = (id) => ({ user_id: id, first_name: byId.get(id)?.first_name ?? '', last_name: byId.get(id)?.last_name ?? '' });
      to = (message.draft_recipients.to ?? []).map(toRef);
      cc = (message.draft_recipients.cc ?? []).map(toRef);
      bcc = (message.draft_recipients.bcc ?? []).map(toRef);
    }
  }

  // Mark read on open (only meaningful for the current recipient's own copy).
  if (mailboxRow.folder === 'inbox' && !mailboxRow.read_at) {
    await MailModel.setRead(messageId, actor.id, true);
  }

  return {
    id: message.id,
    threadId: message.thread_id,
    subject: message.subject ?? '(no subject)',
    body: message.body,
    messageType: message.message_type,
    attachments: message.attachments ?? [],
    courseId: message.course_id ?? null,
    courseTitle: course?.title ?? null,
    parentMessageId: message.parent_message_id ?? null,
    sentAt: message.sent_at,
    createdAt: message.created_at,
    sender: sender ? { id: sender.id, firstName: sender.first_name, lastName: sender.last_name, avatarUrl: sender.avatar_url } : null,
    to: to.map((r) => ({ userId: r.user_id, firstName: r.first_name, lastName: r.last_name })),
    cc: cc.map((r) => ({ userId: r.user_id, firstName: r.first_name, lastName: r.last_name })),
    // Bcc is only ever revealed to the sender — never to other recipients.
    bcc: isSender ? bcc.map((r) => ({ userId: r.user_id, firstName: r.first_name, lastName: r.last_name })) : undefined,
    folder: mailboxRow.folder,
    isRead: true,
    isSender,
    thread: thread.map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      senderName: fullName(m, 'sender_'),
      subject: m.subject,
      body: m.body,
      messageType: m.message_type,
      sentAt: m.sent_at,
      createdAt: m.created_at,
    })),
  };
};

// ── Compose / send ────────────────────────────────────────────────────────────

exports.compose = async (body, actor) => {
  assertBodyLimits(body.body, body.subject);
  const course = body.courseId ? await CourseModel.findById(body.courseId) : null;
  if (body.courseId && !course) throw ApiError.badRequest('Course not found.');
  if (course) await assertActorCanUseCourse(actor, course);

  const recipients = await resolveAndValidateRecipients(
    { to: body.to ?? [], cc: body.cc ?? [], bcc: body.bcc ?? [] }, actor, course,
  );

  const thread = await MailModel.createThread({
    subject: body.subject ?? null,
    threadType: course ? 'course' : 'direct',
    institutionId: actor.institutionId,
    courseId: course?.id ?? null,
    createdBy: actor.id,
  });

  const message = await MailModel.createMessage({
    threadId: thread.id,
    institutionId: actor.institutionId,
    courseId: course?.id ?? null,
    senderId: actor.id,
    subject: body.subject ?? null,
    body: body.body,
    messageType: 'normal',
    attachments: body.attachments ?? null,
  }, recipients);

  await notifyRecipients(message, recipients, actor, course);

  return exports.getDetail(message.id, actor);
};

// ── Drafts ────────────────────────────────────────────────────────────────────

exports.saveDraft = async (body, actor) => {
  const course = body.courseId ? await CourseModel.findById(body.courseId) : null;
  if (course) await assertActorCanUseCourse(actor, course);

  const thread = await MailModel.createThread({
    subject: body.subject ?? null,
    threadType: course ? 'course' : 'direct',
    institutionId: actor.institutionId,
    courseId: course?.id ?? null,
    createdBy: actor.id,
  });

  const draft = await MailModel.createDraft({
    threadId: thread.id,
    institutionId: actor.institutionId,
    courseId: course?.id ?? null,
    senderId: actor.id,
    subject: body.subject ?? null,
    body: body.body ?? '',
    attachments: body.attachments ?? null,
    draftRecipients: { to: body.to ?? [], cc: body.cc ?? [], bcc: body.bcc ?? [] },
  });

  return draft;
};

exports.updateDraft = async (draftId, body, actor) => {
  const fields = {};
  if (body.subject !== undefined) fields.subject = body.subject;
  if (body.body !== undefined) fields.body = body.body;
  if (body.courseId !== undefined) fields.course_id = body.courseId;
  if (body.attachments !== undefined) fields.attachments = body.attachments;
  if (body.to !== undefined || body.cc !== undefined || body.bcc !== undefined) {
    const existing = await MailModel.getMessageById(draftId);
    if (!existing) throw ApiError.notFound('Draft not found.');
    fields.draft_recipients = {
      to: body.to ?? existing.draft_recipients?.to ?? [],
      cc: body.cc ?? existing.draft_recipients?.cc ?? [],
      bcc: body.bcc ?? existing.draft_recipients?.bcc ?? [],
    };
  }
  assertBodyLimits(fields.body, fields.subject);

  const updated = await MailModel.updateDraft(draftId, actor.id, fields);
  if (!updated) throw ApiError.notFound('Draft not found or already sent.');
  return updated;
};

exports.deleteDraft = async (draftId, actor) => {
  const deleted = await MailModel.deleteDraft(draftId, actor.id);
  if (!deleted) throw ApiError.notFound('Draft not found or already sent.');
};

exports.sendDraft = async (draftId, actor) => {
  const draft = await MailModel.getMessageById(draftId);
  if (!draft || draft.sender_id !== actor.id) throw ApiError.notFound('Draft not found.');
  if (draft.sent_at) throw ApiError.badRequest('This draft has already been sent.');

  assertBodyLimits(draft.body, draft.subject);
  const course = draft.course_id ? await CourseModel.findById(draft.course_id) : null;
  const recipients = await resolveAndValidateRecipients(draft.draft_recipients ?? {}, actor, course);

  const sent = await MailModel.sendDraft(draftId, actor.id, recipients);
  if (!sent) throw ApiError.badRequest('This draft has already been sent.');

  await notifyRecipients(sent, recipients, actor, course);

  return exports.getDetail(sent.id, actor);
};

// ── Reply / Reply-all / Forward ───────────────────────────────────────────────

async function replyBase(messageId, body, actor, { includeAll }) {
  const mailboxRow = await MailModel.getMailboxRow(messageId, actor.id);
  if (!mailboxRow) throw ApiError.notFound('Message not found.');

  const original = await MailModel.getMessageById(messageId);
  if (!original) throw ApiError.notFound('Message not found.');

  const recipientRows = await MailModel.getRecipientsForMessage(messageId);
  const toIds = new Set();
  if (original.sender_id !== actor.id) toIds.add(original.sender_id);
  if (includeAll) {
    for (const r of recipientRows) {
      if (r.recipient_type !== 'bcc' && r.user_id !== actor.id) toIds.add(r.user_id);
    }
  }
  if (!toIds.size) throw ApiError.badRequest('No recipients to reply to.');

  const course = original.course_id ? await CourseModel.findById(original.course_id) : null;
  const recipients = await resolveAndValidateRecipients({ to: [...toIds] }, actor, course);

  assertBodyLimits(body.body, original.subject);
  const subject = original.subject?.startsWith('Re: ') ? original.subject : `Re: ${original.subject ?? ''}`;

  const message = await MailModel.createMessage({
    threadId: original.thread_id,
    institutionId: original.institution_id,
    courseId: original.course_id,
    senderId: actor.id,
    subject,
    body: body.body,
    parentMessageId: original.id,
    messageType: 'reply',
    attachments: body.attachments ?? null,
  }, recipients);

  await notifyRecipients(message, recipients, actor, course);
  return exports.getDetail(message.id, actor);
}

exports.reply = (messageId, body, actor) => replyBase(messageId, body, actor, { includeAll: false });
exports.replyAll = (messageId, body, actor) => replyBase(messageId, body, actor, { includeAll: true });

exports.forward = async (messageId, body, actor) => {
  const mailboxRow = await MailModel.getMailboxRow(messageId, actor.id);
  if (!mailboxRow) throw ApiError.notFound('Message not found.');

  const original = await MailModel.getMessageById(messageId);
  if (!original) throw ApiError.notFound('Message not found.');

  const course = body.courseId ? await CourseModel.findById(body.courseId) : (original.course_id ? await CourseModel.findById(original.course_id) : null);
  if (course) await assertActorCanUseCourse(actor, course);

  const recipients = await resolveAndValidateRecipients(
    { to: body.to ?? [], cc: body.cc ?? [], bcc: body.bcc ?? [] }, actor, course,
  );

  const subject = original.subject?.startsWith('Fwd: ') ? original.subject : `Fwd: ${original.subject ?? ''}`;
  assertBodyLimits(body.body, subject);

  const thread = await MailModel.createThread({
    subject,
    threadType: course ? 'course' : 'direct',
    institutionId: actor.institutionId,
    courseId: course?.id ?? null,
    createdBy: actor.id,
  });

  const message = await MailModel.createMessage({
    threadId: thread.id,
    institutionId: actor.institutionId,
    courseId: course?.id ?? null,
    senderId: actor.id,
    subject,
    body: body.body,
    parentMessageId: original.id,
    messageType: 'forward',
    attachments: body.attachments ?? null,
  }, recipients);

  await notifyRecipients(message, recipients, actor, course);
  return exports.getDetail(message.id, actor);
};

// ── Mailbox actions (per-recipient) ───────────────────────────────────────────

exports.markRead = async (messageId, actor) => {
  const result = await MailModel.setRead(messageId, actor.id, true);
  if (!result) throw ApiError.notFound('Message not found.');
  return { id: messageId };
};

exports.markUnread = async (messageId, actor) => {
  const result = await MailModel.setRead(messageId, actor.id, false);
  if (!result) throw ApiError.notFound('Message not found.');
  return { id: messageId };
};

exports.archive = async (messageId, actor) => {
  const result = await MailModel.setArchived(messageId, actor.id);
  if (!result) throw ApiError.notFound('Message not found or cannot be archived from its current folder.');
  return { id: messageId };
};

exports.restore = async (messageId, actor) => {
  const result = await MailModel.restore(messageId, actor.id);
  if (!result) throw ApiError.notFound('Message not found or not archived/trashed.');
  return { id: messageId };
};

exports.remove = async (messageId, actor) => {
  const result = await MailModel.moveToTrashOrPurge(messageId, actor.id);
  if (!result?.row) throw ApiError.notFound('Message not found.');
  if (result.action === 'purged') {
    await AuditModel.log({
      institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
      action: 'mail.purge', entityType: 'MailMessage', entityId: messageId, delta: null,
    });
  }
  return result;
};

// ── Recipient selector ────────────────────────────────────────────────────────

// ── Attachment upload ──────────────────────────────────────────────────────────

exports.uploadAttachment = async (file, serverUrl) => {
  const dir = getMailAttachmentsDir();
  fs.mkdirSync(dir, { recursive: true });

  const ext = path.extname(file.originalname).toLowerCase();
  const destName = `${crypto.randomUUID()}${ext}`;
  fs.copyFileSync(file.path, path.join(dir, destName));
  fs.unlinkSync(file.path);

  return {
    fileUrl:  `${serverUrl}${config.storage.mailAttachmentsUrlPrefix}/${destName}`,
    fileName: file.originalname,
    fileType: file.mimetype,
    fileSize: file.size,
  };
};

exports.listRecipients = async (actor, q) => {
  const page = Number(q.page) > 0 ? Number(q.page) : 1;
  const limit = Number(q.limit) > 0 ? Math.min(Number(q.limit), 100) : 20;
  const rows = await mailAccess.listMessageableUsers(actor, {
    courseId: q.course_id, search: q.search, role: q.role,
    departmentId: q.department_id, academicYearId: q.academic_year_id, semesterTermId: q.semester_term_id,
    page, limit,
  });
  return rows.map((r) => ({
    id: r.id, firstName: r.first_name, lastName: r.last_name, email: r.email, avatarUrl: r.avatar_url ?? null,
  }));
};
