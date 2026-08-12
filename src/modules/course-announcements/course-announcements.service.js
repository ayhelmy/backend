'use strict';

/**
 * Course announcements — instructor-authored, course-wide messages that
 * fan out a notification to every enrolled student and assigned TA.
 * Reuses the mail schema (a dedicated thread_type='announcement' thread
 * per course, message_type='announcement') instead of a parallel table.
 */

const { MailModel, CourseModel, UserModel } = require('../../db/models');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const ApiError = require('../../utils/apiError');
const eventDispatcher = require('../notifications/event-dispatcher.service');
const recipientResolver = require('../notifications/recipient-resolver.service');

function mapMessage(row) {
  return {
    id:          row.id,
    threadId:    row.thread_id,
    senderId:    row.sender_id,
    senderName:  `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
    avatarUrl:   row.avatar_url ?? null,
    subject:     row.subject ?? null,
    body:        row.body,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at ?? null,
  };
}

async function getOrCreateAnnouncementThread(courseId, course, actor) {
  const existing = await MailModel.findCourseThreadByType(courseId, 'announcement');
  if (existing) return existing;
  return MailModel.createThread({
    subject:       `${course.title} — Announcements`,
    threadType:    'announcement',
    institutionId: course.institution_id,
    courseId,
    createdBy:     actor.id,
  });
}

// ── create — instructor/admin posts an announcement ───────────────────────────

exports.create = async (courseId, body, actor) => {
  const course = await CourseModel.findById(courseId);
  if (!course) throw ApiError.notFound('Course not found.');

  const thread = await getOrCreateAnnouncementThread(courseId, course, actor);

  const [recipientIds, senderProfile] = await Promise.all([
    recipientResolver.courseParticipants(courseId).then((ids) => ids.filter((id) => id !== actor.id)),
    UserModel.findById(actor.id),
  ]);

  const message = await MailModel.createMessage({
    threadId:      thread.id,
    institutionId: course.institution_id,
    courseId,
    senderId:      actor.id,
    subject:       thread.subject,
    body:          body.body,
    messageType:   'announcement',
  }, recipientIds.map((userId) => ({ userId, type: 'to' })));

  eventDispatcher.emit('course_announcement.posted', {
    recipientIds,
    senderId: actor.id,
    institutionId: course.institution_id,
    departmentId: course.department_id ?? null,
    courseId,
    data: {
      senderName: `${senderProfile?.first_name ?? ''} ${senderProfile?.last_name ?? ''}`.trim(),
      subject: thread.subject,
      messagePreview: body.body.slice(0, 120),
      courseTitle: course.title,
    },
  });

  return mapMessage({
    ...message,
    first_name: senderProfile?.first_name ?? null,
    last_name:  senderProfile?.last_name  ?? null,
    avatar_url: senderProfile?.avatar_url ?? null,
  });
};

// ── list — anyone with course read access ─────────────────────────────────────

exports.list = async (courseId, q) => {
  const thread = await MailModel.findCourseThreadByType(courseId, 'announcement');
  if (!thread) return { announcements: [], meta: buildPaginationMeta(0, 1, 20) };

  const { page, limit, offset } = parsePagination(q);
  const [rows, total] = await Promise.all([
    MailModel.listMessagesInThread(thread.id, { limit, offset }),
    MailModel.countMessagesInThread(thread.id),
  ]);

  return { announcements: rows.map(mapMessage), meta: buildPaginationMeta(total, page, limit) };
};
