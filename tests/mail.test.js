'use strict';

const request = require('supertest');
const app = require('../src/app');
const { NotificationModel } = require('../src/db/models');
const {
  makeInstitution, makeUser, makeCourse, enrollStudent, cleanup, authHeader,
} = require('./helpers');

describe('Mail — scope rules and independent per-recipient mailbox state', () => {
  let instA, instB;
  let instructorA, instructorOtherCourse, studentInA, studentOutsideA;
  let instAdminA, instAdminB;
  let courseA, otherCourseA;

  beforeAll(async () => {
    instA = await makeInstitution('Mail Test Institution A');
    instB = await makeInstitution('Mail Test Institution B');

    instructorA = await makeUser(instA.id, 'instructor');
    instructorOtherCourse = await makeUser(instA.id, 'instructor');
    studentInA = await makeUser(instA.id, 'student');
    studentOutsideA = await makeUser(instA.id, 'student');
    instAdminA = await makeUser(instA.id, 'institution_admin');
    instAdminB = await makeUser(instB.id, 'institution_admin');

    courseA = await makeCourse(instA.id, instructorA.id, { title: 'Mail Course A' });
    otherCourseA = await makeCourse(instA.id, instructorOtherCourse.id, { title: 'Mail Other Course' });

    await enrollStudent(courseA.id, studentInA.id);
    await enrollStudent(otherCourseA.id, studentOutsideA.id);
  });

  afterAll(cleanup);

  test('student can message the instructor of an enrolled course; it appears in both mailboxes', async () => {
    const sendRes = await request(app)
      .post('/api/v1/mail/messages')
      .set(authHeader(studentInA))
      .send({ to: [instructorA.id], subject: 'Question', body: 'Can I get an extension?' });

    expect(sendRes.status).toBe(201);
    const messageId = sendRes.body.data.id;

    const inbox = await request(app).get('/api/v1/mail/inbox').set(authHeader(instructorA));
    expect(inbox.body.data.messages.some((m) => m.id === messageId)).toBe(true);

    const sent = await request(app).get('/api/v1/mail/sent').set(authHeader(studentInA));
    expect(sent.body.data.messages.some((m) => m.id === messageId)).toBe(true);
  });

  test('student cannot message an instructor of an unrelated course', async () => {
    const res = await request(app)
      .post('/api/v1/mail/messages')
      .set(authHeader(studentInA))
      .send({ to: [instructorOtherCourse.id], subject: 'Hi', body: 'Hello' });

    expect(res.status).toBe(403);
  });

  test('instructor cannot message a student outside their own course', async () => {
    const res = await request(app)
      .post('/api/v1/mail/messages')
      .set(authHeader(instructorA))
      .send({ to: [studentOutsideA.id], subject: 'Hi', body: 'Hello' });

    expect(res.status).toBe(403);
  });

  test('institution_admin cannot message a user from another institution', async () => {
    const res = await request(app)
      .post('/api/v1/mail/messages')
      .set(authHeader(instAdminA))
      .send({ to: [instAdminB.id], subject: 'Hi', body: 'Hello' });

    expect(res.status).toBe(403);
  });

  test('sender deleting from Sent does not remove the message from the recipient\'s Inbox', async () => {
    const sendRes = await request(app)
      .post('/api/v1/mail/messages')
      .set(authHeader(instructorA))
      .send({ to: [studentInA.id], subject: 'Reminder', body: 'Submit your work by Friday.' });
    const messageId = sendRes.body.data.id;

    const del = await request(app)
      .delete(`/api/v1/mail/messages/${messageId}`)
      .set(authHeader(instructorA));
    expect(del.status).toBe(204);

    const senderSent = await request(app).get('/api/v1/mail/sent').set(authHeader(instructorA));
    expect(senderSent.body.data.messages.some((m) => m.id === messageId)).toBe(false);

    const recipientInbox = await request(app).get('/api/v1/mail/inbox').set(authHeader(studentInA));
    expect(recipientInbox.body.data.messages.some((m) => m.id === messageId)).toBe(true);
  });

  test('mark read/unread and archive are per-recipient, not global', async () => {
    const sendRes = await request(app)
      .post('/api/v1/mail/messages')
      .set(authHeader(instructorA))
      .send({ to: [studentInA.id], subject: 'Per-recipient test', body: 'Body text.' });
    const messageId = sendRes.body.data.id;

    await request(app).patch(`/api/v1/mail/messages/${messageId}/archive`).set(authHeader(studentInA));

    const studentArchived = await request(app).get('/api/v1/mail/archived').set(authHeader(studentInA));
    expect(studentArchived.body.data.messages.some((m) => m.id === messageId)).toBe(true);

    // Sender's own Sent-folder copy is untouched by the recipient's archive action.
    const senderSent = await request(app).get('/api/v1/mail/sent').set(authHeader(instructorA));
    expect(senderSent.body.data.messages.some((m) => m.id === messageId)).toBe(true);
  });

  test('non-recipient gets 404 accessing a message by ID directly', async () => {
    const sendRes = await request(app)
      .post('/api/v1/mail/messages')
      .set(authHeader(instructorA))
      .send({ to: [studentInA.id], subject: 'Private', body: 'Only for the recipient.' });
    const messageId = sendRes.body.data.id;

    const asOutsider = await request(app)
      .get(`/api/v1/mail/messages/${messageId}`)
      .set(authHeader(studentOutsideA));
    expect(asOutsider.status).toBe(404);
  });

  test('a message triggers an in-app notification for the recipient, not the sender', async () => {
    const recipientBefore = await NotificationModel.unreadCount(studentInA.id);
    const senderBefore = await NotificationModel.unreadCount(instructorA.id);

    await request(app)
      .post('/api/v1/mail/messages')
      .set(authHeader(instructorA))
      .send({ to: [studentInA.id], subject: 'Notify me', body: 'Ping.' });

    const recipientAfter = await NotificationModel.unreadCount(studentInA.id);
    expect(recipientAfter).toBe(recipientBefore + 1);

    // Sending doesn't generate a notification for the sender themself.
    const senderAfter = await NotificationModel.unreadCount(instructorA.id);
    expect(senderAfter).toBe(senderBefore);
  });
});

describe('Mail — Bcc privacy and reply-all recipients', () => {
  let inst, sender, toUser, ccUser, bccUser;
  let messageId;

  beforeAll(async () => {
    inst = await makeInstitution('Mail Bcc Test Institution');
    sender = await makeUser(inst.id, 'institution_admin');
    toUser = await makeUser(inst.id, 'institution_admin');
    ccUser = await makeUser(inst.id, 'institution_admin');
    bccUser = await makeUser(inst.id, 'institution_admin');

    const res = await request(app)
      .post('/api/v1/mail/messages')
      .set(authHeader(sender))
      .send({ to: [toUser.id], cc: [ccUser.id], bcc: [bccUser.id], subject: 'Team update', body: 'See details below.' });
    messageId = res.body.data.id;
  });

  afterAll(cleanup);

  test('Bcc is visible to the sender', async () => {
    const res = await request(app).get(`/api/v1/mail/messages/${messageId}`).set(authHeader(sender));
    expect(res.body.data.bcc.map((r) => r.userId)).toContain(bccUser.id);
  });

  test('Bcc is hidden from a To recipient', async () => {
    const res = await request(app).get(`/api/v1/mail/messages/${messageId}`).set(authHeader(toUser));
    expect(res.body.data.bcc).toBeUndefined();
    expect(res.body.data.to.map((r) => r.userId)).toContain(toUser.id);
  });

  test('reply-all includes sender + To/Cc minus the actor, excludes Bcc', async () => {
    const res = await request(app)
      .post(`/api/v1/mail/messages/${messageId}/reply-all`)
      .set(authHeader(ccUser))
      .send({ body: 'Replying to everyone.' });

    expect(res.status).toBe(201);
    const replyId = res.body.data.id;

    const senderInbox = await request(app).get('/api/v1/mail/inbox').set(authHeader(sender));
    expect(senderInbox.body.data.messages.some((m) => m.id === replyId)).toBe(true);

    const toUserInbox = await request(app).get('/api/v1/mail/inbox').set(authHeader(toUser));
    expect(toUserInbox.body.data.messages.some((m) => m.id === replyId)).toBe(true);

    // The Bcc'd user was never visible to ccUser, so reply-all can't have included them.
    const bccInbox = await request(app).get('/api/v1/mail/inbox').set(authHeader(bccUser));
    expect(bccInbox.body.data.messages.some((m) => m.id === replyId)).toBe(false);
  });
});
