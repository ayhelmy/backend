'use strict';

const request = require('supertest');
const app = require('../src/app');
const { NotificationModel } = require('../src/db/models');
const {
  makeInstitution, makeUser, cleanup, authHeader,
} = require('./helpers');

describe('Notifications — ownership scoping', () => {
  let inst, studentA, studentB, notifA;

  beforeAll(async () => {
    inst = await makeInstitution('Notif Test Institution');
    studentA = await makeUser(inst.id, 'student');
    studentB = await makeUser(inst.id, 'student');

    notifA = await NotificationModel.create({
      userId: studentA.id, type: 'system.alert', title: 'Hello A', body: 'For A only',
    });
  });

  afterAll(cleanup);

  test('student cannot read another student\'s notifications via list', async () => {
    const res = await request(app)
      .get('/api/v1/notifications')
      .set(authHeader(studentB));

    expect(res.status).toBe(200);
    const ids = res.body.data.notifications.map((n) => n.id);
    expect(ids).not.toContain(notifA.id);
  });

  test('student cannot mark another student\'s notification as read', async () => {
    const res = await request(app)
      .patch(`/api/v1/notifications/${notifA.id}/read`)
      .set(authHeader(studentB));

    expect(res.status).toBe(404);

    const stillUnread = await NotificationModel.listForUser(studentA.id, {});
    expect(stillUnread.find((n) => n.id === notifA.id)?.status).toBe('unread');
  });

  test('owner can mark their own notification as read', async () => {
    const res = await request(app)
      .patch(`/api/v1/notifications/${notifA.id}/read`)
      .set(authHeader(studentA));

    expect(res.status).toBe(200);
  });

  test('mark-all-read only touches the caller\'s own rows', async () => {
    await NotificationModel.create({ userId: studentA.id, type: 'system.alert', title: 'A-2' });
    await NotificationModel.create({ userId: studentB.id, type: 'system.alert', title: 'B-1' });

    const res = await request(app)
      .patch('/api/v1/notifications/mark-all-read')
      .set(authHeader(studentA));
    expect(res.status).toBe(200);

    const bUnread = await NotificationModel.unreadCount(studentB.id);
    expect(bUnread).toBe(1); // B-1 untouched by A's mark-all-read

    const aUnread = await NotificationModel.unreadCount(studentA.id);
    expect(aUnread).toBe(0);
  });
});

describe('Notification preferences — user scoping', () => {
  let inst, user;

  beforeAll(async () => {
    inst = await makeInstitution('Notif Prefs Test Institution');
    user = await makeUser(inst.id, 'student');
  });

  afterAll(cleanup);

  test('preferences default to sensible values on first read', async () => {
    const res = await request(app)
      .get('/api/v1/notification-preferences')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.data.emailEnabled).toBe(true);
    expect(res.body.data.preferences.grade_updates).toBe(true);
  });

  test('updating preferences persists and is scoped to the caller', async () => {
    const update = await request(app)
      .patch('/api/v1/notification-preferences')
      .set(authHeader(user))
      .send({ emailEnabled: false, preferences: { grade_updates: false } });

    expect(update.status).toBe(200);
    expect(update.body.data.emailEnabled).toBe(false);
    expect(update.body.data.preferences.grade_updates).toBe(false);
    // Untouched categories keep their defaults
    expect(update.body.data.preferences.messages).toBe(true);

    const reread = await request(app)
      .get('/api/v1/notification-preferences')
      .set(authHeader(user));
    expect(reread.body.data.emailEnabled).toBe(false);
  });
});
