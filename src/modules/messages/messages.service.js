'use strict';

/**
 * Messages service — SRS §4.13 MSG-01 to MSG-06.
 * Tenant isolation: participants must share the same institution.
 * Thread access: only participants may read/send in a thread.
 */

const { NotificationModel } = require('../../db/models');
const { parsePagination }   = require('../../utils/pagination');
const ApiError              = require('../../utils/apiError');
const { pool }              = require('../../config/database');

// ── Mappers ───────────────────────────────────────────────────────────────────

function mapThread(row) {
  if (!row) return null;
  return {
    id:          row.id,
    subject:     row.subject     ?? null,
    threadType:  row.thread_type,
    courseId:    row.course_id   ?? null,
    lastMessage: row.last_message ?? null,
    lastReadAt:  row.last_read_at ?? null,
    updatedAt:   row.updated_at,
  };
}

function mapMessage(row) {
  if (!row) return null;
  return {
    id:            row.id,
    senderId:      row.sender_id,
    senderName:    `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
    avatarUrl:     row.avatar_url  ?? null,
    body:          row.body,
    attachmentUrl: row.attachment_url ?? null,
    createdAt:     row.created_at,
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function requireParticipant(threadId, userId) {
  const isIn = await NotificationModel.isParticipant(threadId, userId);
  if (!isIn) throw ApiError.notFound('Thread not found.');
}

async function assertSameInstitution(userIds, institutionId) {
  const { rows } = await pool.query(
    `SELECT id FROM users
      WHERE id = ANY($1::uuid[])
        AND (institution_id != $2 OR institution_id IS NULL)
        AND deleted_at IS NULL`,
    [userIds, institutionId],
  );
  if (rows.length > 0) throw ApiError.forbidden('All participants must belong to the same institution.');
}

// ── listThreads — MSG-01 ──────────────────────────────────────────────────────

exports.listThreads = async (actor, q) => {
  const { limit, offset } = parsePagination(q);
  const rows = await NotificationModel.listThreadsForUser(actor.id, { limit, offset });
  return rows.map(mapThread);
};

// ── createThread — MSG-02 ─────────────────────────────────────────────────────

exports.createThread = async (body, actor) => {
  const { subject, threadType = 'direct', courseId, participantIds = [] } = body;

  const allParticipants = [...new Set([actor.id, ...participantIds])];

  // Course thread — everyone must be enrolled (and in-institution implicitly)
  if (courseId) {
    const { rows } = await pool.query(
      `SELECT user_id FROM enrollments
        WHERE course_id = $1 AND user_id = ANY($2::uuid[]) AND status = 'active'`,
      [courseId, participantIds],
    );
    if (rows.length !== participantIds.length) {
      throw ApiError.forbidden('All participants must be active enrollees in this course.');
    }
  } else {
    // Direct thread — all must be in the same institution
    await assertSameInstitution(participantIds, actor.institutionId);
  }

  const thread = await NotificationModel.createThread({
    subject:    subject ?? null,
    threadType,
    courseId:   courseId ?? null,
    createdBy:  actor.id,
  });

  // Add all participants
  await Promise.all(allParticipants.map((uid) => NotificationModel.addParticipant(thread.id, uid)));

  return mapThread(thread);
};

// ── getThread — MSG-03 ────────────────────────────────────────────────────────

exports.getThread = async (threadId, actor) => {
  await requireParticipant(threadId, actor.id);
  const thread = await NotificationModel.findThreadById(threadId);
  if (!thread) throw ApiError.notFound('Thread not found.');
  return mapThread(thread);
};

// ── listMessages — MSG-04 ─────────────────────────────────────────────────────

exports.listMessages = async (threadId, actor, q) => {
  await requireParticipant(threadId, actor.id);

  const { limit, offset } = parsePagination(q);
  const rows = await NotificationModel.listMessages(threadId, { limit, offset });

  // Update read cursor
  await NotificationModel.updateLastRead(threadId, actor.id);

  return rows.map(mapMessage);
};

// ── sendMessage — MSG-05 ──────────────────────────────────────────────────────

exports.sendMessage = async (threadId, body, actor) => {
  await requireParticipant(threadId, actor.id);

  const message = await NotificationModel.sendMessage({
    threadId,
    senderId:      actor.id,
    body:          body.body,
    attachmentUrl: body.attachmentUrl ?? null,
  });

  return mapMessage({
    ...message,
    first_name: actor.firstName ?? null,
    last_name:  actor.lastName  ?? null,
    avatar_url: actor.avatarUrl ?? null,
  });
};
