'use strict';

/**
 * Shared test fixtures for messaging/notifications integration tests.
 * Creates real rows via the actual model layer (no mocking — this codebase
 * has no ORM to mock against, and DB-validated scope checks are exactly
 * what these tests exercise), then tears everything down afterward so the
 * dev database used by `npm test` is left clean.
 */

const { v4: uuid } = require('uuid');
const { pool } = require('../src/config/database');
const { InstitutionModel, UserModel, RoleModel, CourseModel } = require('../src/db/models');
const { signAccess } = require('../src/utils/jwt');

const created = {
  institutionIds: [],
  userIds: [],
  courseIds: [],
};

async function makeInstitution(name) {
  const inst = await InstitutionModel.create({ name, slug: `test-${uuid()}` });
  created.institutionIds.push(inst.id);
  return inst;
}

async function makeUser(institutionId, role, overrides = {}) {
  const email = overrides.email ?? `test-${uuid()}@example.com`;
  const user = await UserModel.create({
    email,
    passwordHash: 'x',
    firstName: overrides.firstName ?? role,
    lastName: overrides.lastName ?? 'Tester',
    institutionId,
    status: 'active',
  });
  created.userIds.push(user.id);
  if (role) await RoleModel.assignRole(user.id, role, institutionId);
  const token = signAccess({ id: user.id, email: user.email, institutionId, roles: role ? [role] : [] });
  return { ...user, token, roles: role ? [role] : [] };
}

async function makeCourse(institutionId, instructorId, overrides = {}) {
  const course = await CourseModel.create({
    institutionId,
    instructorId,
    title: overrides.title ?? `Test Course ${uuid()}`,
    code: overrides.code ?? `T-${uuid().slice(0, 8)}`,
    createdBy: instructorId,
  });
  created.courseIds.push(course.id);
  return course;
}

async function enrollStudent(courseId, userId) {
  return CourseModel.enroll({ courseId, userId, role: 'student', status: 'active' });
}

async function assignTA(courseId, userId) {
  await pool.query(
    `INSERT INTO course_teaching_assistants (course_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [courseId, userId],
  );
}

async function cleanup() {
  // Children first — FKs are a mix of CASCADE/SET NULL, so be explicit rather
  // than relying on cascade order across tables created in this test run.
  if (created.userIds.length) {
    await pool.query(`DELETE FROM notifications WHERE user_id = ANY($1::uuid[]) OR sender_id = ANY($1::uuid[])`, [created.userIds]);
    await pool.query(`DELETE FROM notification_preferences WHERE user_id = ANY($1::uuid[])`, [created.userIds]);
    await pool.query(`DELETE FROM mail_messages WHERE sender_id = ANY($1::uuid[])`, [created.userIds]);
  }
  if (created.courseIds.length) {
    await pool.query(`DELETE FROM mail_threads WHERE course_id = ANY($1::uuid[])`, [created.courseIds]);
    await pool.query(`DELETE FROM course_teaching_assistants WHERE course_id = ANY($1::uuid[])`, [created.courseIds]);
    await pool.query(`DELETE FROM enrollments WHERE course_id = ANY($1::uuid[])`, [created.courseIds]);
    await pool.query(`DELETE FROM courses WHERE id = ANY($1::uuid[])`, [created.courseIds]);
  }
  if (created.userIds.length) {
    await pool.query(`DELETE FROM mail_threads WHERE created_by = ANY($1::uuid[])`, [created.userIds]);
    await pool.query(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [created.userIds]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [created.userIds]);
  }
  if (created.institutionIds.length) {
    await pool.query(`DELETE FROM institutions WHERE id = ANY($1::uuid[])`, [created.institutionIds]);
  }
  created.institutionIds = [];
  created.userIds = [];
  created.courseIds = [];
}

function authHeader(user) {
  return { Authorization: `Bearer ${user.token}` };
}

module.exports = { makeInstitution, makeUser, makeCourse, enrollStudent, assignTA, cleanup, authHeader };
