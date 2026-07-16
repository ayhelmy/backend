'use strict';

/**
 * Cross-tenant isolation tests — grades, progress, sessions, notifications, messages.
 *
 * Ensures that tenants A and B cannot access each other's data regardless of
 * what IDs a malicious actor passes in.  All DB calls are mocked so no live
 * database is required.
 *
 * Pattern (from existing rbac-isolation.test.js):
 *   - pool.query  is jest.fn()  — return shapes are set per-test with mockResolvedValueOnce
 *   - Models are mocked as jest.fn() stubs where needed
 *   - Services are required after mocks are set up
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../src/db/models', () => ({
  CourseModel:            { findById: jest.fn() },
  GradeModel:             {
    gradebookGrid:       jest.fn(),
    listGradeItems:      jest.fn(),
    findGradeItemById:   jest.fn(),
    findGrade:           jest.fn(),
    upsertGrade:         jest.fn(),
    createGradeItem:     jest.fn(),
    weightedCourseGrade: jest.fn(),
  },
  ProgressModel:          {
    getCourseProgress:    jest.fn(),
    getLessonProgress:    jest.fn(),
    upsertLessonProgress: jest.fn(),
    recalcModuleProgress: jest.fn(),
    recalcCourseProgress: jest.fn(),
  },
  ModuleModel:            {
    findLessonById: jest.fn(),
    findById:       jest.fn(),
  },
  SessionModel:           {
    findById:          jest.fn(),
    nextAttemptNumber: jest.fn(),
    create:            jest.fn(),
    updateScormState:  jest.fn(),
    complete:          jest.fn(),
    bestScore:         jest.fn(),
  },
  NotificationModel:      {
    isParticipant:       jest.fn(),
    findThreadById:      jest.fn(),
    createThread:        jest.fn(),
    addParticipant:      jest.fn(),
    listThreadsForUser:  jest.fn(),
    listMessages:        jest.fn(),
    sendMessage:         jest.fn(),
    updateLastRead:      jest.fn(),
    listForUser:         jest.fn(),
    unreadCount:         jest.fn(),
    markRead:            jest.fn(),
    markAllRead:         jest.fn(),
    create:              jest.fn(),
  },
  AuditModel:             { log: jest.fn().mockResolvedValue(undefined) },
  SimulationModel:        {},
  UserModel:              {},
  RoleModel:              {},
  InstitutionModel:       {},
  SimulationCatalogModel: {},
}));

jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/config/redis', () => ({
  del:      jest.fn().mockResolvedValue(1),
  setex:    jest.fn().mockResolvedValue('OK'),
  smembers: jest.fn().mockResolvedValue([]),
  pipeline: jest.fn().mockReturnValue({ del: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) }),
}));

const { pool }              = require('../src/config/database');
const { CourseModel, GradeModel, ProgressModel, ModuleModel, SessionModel, NotificationModel }
                            = require('../src/db/models');
const gradesService         = require('../src/modules/grades/grades.service');
const progressService       = require('../src/modules/progress/progress.service');
const sessionsService       = require('../src/modules/simulations/sessions/sessions.service');
const notificationsService  = require('../src/modules/notifications/notifications.service');
const messagesService       = require('../src/modules/messages/messages.service');

// ── Shared fixtures ───────────────────────────────────────────────────────────

const INST_A     = 'aaaaaaaa-0000-0000-0000-000000000001';
const INST_B     = 'bbbbbbbb-0000-0000-0000-000000000002';
const COURSE_A   = 'cccccccc-0000-0000-0000-000000000010';
const COURSE_B   = 'cccccccc-0000-0000-0000-000000000020';
const SIM_A      = 'eeeeeeee-0000-0000-0000-000000000030';
const SIM_B      = 'eeeeeeee-0000-0000-0000-000000000040';
const SESSION_A  = 'ffffffff-0000-0000-0000-000000000050';
const SESSION_B  = 'ffffffff-0000-0000-0000-000000000060';
const USER_A     = 'a0000000-0000-0000-0000-000000000001';
const USER_B     = 'b0000000-0000-0000-0000-000000000002';
const THREAD_A   = 'dddddddd-0000-0000-0000-000000000070';
const THREAD_B   = 'dddddddd-0000-0000-0000-000000000080';

function actorA(overrides = {}) {
  return { id: USER_A, email: 'a@a.com', institutionId: INST_A, roles: ['institution_admin'], permissions: [], ...overrides };
}
function actorStudent(overrides = {}) {
  return { id: USER_A, email: 'student@a.com', institutionId: INST_A, roles: ['student'], permissions: [], ...overrides };
}

function courseA() {
  return { id: COURSE_A, institution_id: INST_A, instructor_id: USER_A, title: 'Course A', passing_grade: 70, deleted_at: null };
}
function courseB() {
  return { id: COURSE_B, institution_id: INST_B, instructor_id: USER_B, title: 'Course B', passing_grade: 70, deleted_at: null };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// GRADES
// ─────────────────────────────────────────────────────────────────────────────

describe('grades.service — cross-tenant isolation', () => {

  test('getGradebook returns 404 when course belongs to Institution B', async () => {
    CourseModel.findById.mockResolvedValue(courseB());

    await expect(gradesService.getGradebook(COURSE_B, {}, actorA()))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('createItem returns 404 when course belongs to Institution B', async () => {
    CourseModel.findById.mockResolvedValue(courseB());

    await expect(gradesService.createItem(COURSE_B, { title: 'X', maxPoints: 100 }, actorA()))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('getStudentGrades returns 404 when course belongs to Institution B', async () => {
    CourseModel.findById.mockResolvedValue(courseB());

    await expect(gradesService.getStudentGrades(COURSE_B, USER_A, actorA()))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('submitGrade returns 404 when course belongs to Institution B', async () => {
    CourseModel.findById.mockResolvedValue(courseB());

    await expect(gradesService.submitGrade(COURSE_B, { gradeItemId: 'x', userId: USER_A, score: 90 }, actorA()))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('student cannot view another student\'s grades in same institution', async () => {
    CourseModel.findById.mockResolvedValue(courseA());

    const studentActor = { id: USER_A, email: 's@a.com', institutionId: INST_A, roles: ['student'], permissions: [] };
    const otherStudentId = 'other-student-id';

    await expect(gradesService.getStudentGrades(COURSE_A, otherStudentId, studentActor))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  test('super_admin can access grades from any institution', async () => {
    CourseModel.findById.mockResolvedValue(courseB());
    GradeModel.listGradeItems.mockResolvedValue([]);
    GradeModel.weightedCourseGrade.mockResolvedValue(null);

    const superAdmin = { id: 'sa', email: 'sa@x.com', institutionId: INST_A, roles: ['super_admin'], permissions: [] };

    const result = await gradesService.getStudentGrades(COURSE_B, USER_B, superAdmin);
    expect(result).toHaveProperty('grades');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// PROGRESS
// ─────────────────────────────────────────────────────────────────────────────

describe('progress.service — cross-tenant isolation', () => {

  test('completeLesson blocks write when user has no active enrollment in that course', async () => {
    const lesson = { id: 'lesson-1', module_id: 'mod-1' };
    const mod    = { id: 'mod-1', course_id: COURSE_A };

    ModuleModel.findLessonById.mockResolvedValue(lesson);
    ModuleModel.findById.mockResolvedValue(mod);

    // pool.query for enrollment check — returns empty (not enrolled)
    pool.query.mockResolvedValueOnce({ rows: [] });

    await expect(progressService.completeLesson('lesson-1', USER_B))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  test('completeLesson succeeds when user is actively enrolled', async () => {
    const lesson = { id: 'lesson-1', module_id: 'mod-1' };
    const mod    = { id: 'mod-1', course_id: COURSE_A };

    ModuleModel.findLessonById.mockResolvedValue(lesson);
    ModuleModel.findById.mockResolvedValue(mod);

    // enrollment exists
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'enr-1' }] });

    ProgressModel.upsertLessonProgress.mockResolvedValue({});
    ProgressModel.recalcModuleProgress.mockResolvedValue({});
    const cpRow = { user_id: USER_A, course_id: COURSE_A, completion_pct: 50, current_grade: null, status: 'in_progress', completed_at: null, updated_at: null };
    ProgressModel.recalcCourseProgress.mockResolvedValue(cpRow);

    const result = await progressService.completeLesson('lesson-1', USER_A);
    expect(result).toMatchObject({ userId: USER_A, courseId: COURSE_A, completionPct: 50 });
  });

  test('getLessonProgress returns not_started default for unknown lesson', async () => {
    ProgressModel.getLessonProgress.mockResolvedValue(null);
    const result = await progressService.getLessonProgress('no-such-lesson', USER_A);
    expect(result.status).toBe('not_started');
  });

  test('getCourseProgress returns not_started default for unknown course', async () => {
    ProgressModel.getCourseProgress.mockResolvedValue(null);
    const result = await progressService.getCourseProgress('no-such-course', USER_A);
    expect(result.status).toBe('not_started');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SESSIONS
// ─────────────────────────────────────────────────────────────────────────────

describe('sessions.service — cross-tenant isolation', () => {

  function simB() {
    return { id: SIM_B, institution_id: INST_B, title: 'Sim B', max_score: 100, pass_score: 70, max_attempts: 3 };
  }

  test('start() returns 404 when simulation belongs to Institution B', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [simB()] }); // loadSimulation

    await expect(sessionsService.start({ simulationId: SIM_B, courseId: null, lessonId: null }, actorA()))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('getOne() returns 404 when session belongs to Institution B', async () => {
    const sessionB = { id: SESSION_B, simulation_id: SIM_B, user_id: USER_B,
                       course_id: COURSE_B, lesson_id: null, attempt_number: 1,
                       status: 'in_progress', score: null, max_score: 100, active_seconds: null,
                       started_at: new Date(), completed_at: null,
                       scorm_suspend_data: null, scorm_lesson_location: null };

    SessionModel.findById.mockResolvedValue(sessionB);

    // assertSessionAccess: not owner AND check institution_id in DB → returns INST_B
    pool.query.mockResolvedValueOnce({ rows: [{ institution_id: INST_B }] });

    await expect(sessionsService.getOne(SESSION_B, actorA()))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('complete() blocks non-owner from completing session', async () => {
    const sessionA = { id: SESSION_A, simulation_id: SIM_A, user_id: USER_B,  // owned by USER_B
                       course_id: COURSE_A, lesson_id: null, attempt_number: 1,
                       status: 'in_progress', score: null, max_score: 100, active_seconds: null,
                       started_at: new Date(), completed_at: null,
                       scorm_suspend_data: null, scorm_lesson_location: null };

    SessionModel.findById.mockResolvedValue(sessionA);
    pool.query.mockResolvedValueOnce({ rows: [{ institution_id: INST_A }] }); // institution check

    // actorA has permission to view (institution_admin) but is NOT the session owner
    await expect(sessionsService.complete(SESSION_A, actorA()))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  test('update() blocks non-owner from patching SCORM state', async () => {
    const sessionA = { id: SESSION_A, simulation_id: SIM_A, user_id: USER_B,
                       course_id: COURSE_A, status: 'in_progress', score: null, max_score: 100,
                       active_seconds: null, started_at: new Date(), completed_at: null,
                       lesson_id: null, attempt_number: 1,
                       scorm_suspend_data: null, scorm_lesson_location: null };

    SessionModel.findById.mockResolvedValue(sessionA);
    pool.query.mockResolvedValueOnce({ rows: [{ institution_id: INST_A }] });

    await expect(sessionsService.update(SESSION_A, { suspendData: '{}' }, actorA()))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  test('start() respects max_attempts limit', async () => {
    const simA = { id: SIM_A, institution_id: INST_A, title: 'Sim A', max_score: 100, pass_score: 70, max_attempts: 2 };

    pool.query
      .mockResolvedValueOnce({ rows: [simA] })       // loadSimulation
      .mockResolvedValueOnce({ rows: [{ id: 'enr' }] }) // enrollment check
      .mockResolvedValueOnce({ rows: [{ total: '2' }] }); // attempt count (at limit)

    await expect(sessionsService.start({ simulationId: SIM_A, courseId: COURSE_A, lessonId: null }, actorA()))
      .rejects.toMatchObject({ statusCode: 403 });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────

describe('notifications.service — cross-tenant isolation', () => {

  test('markRead returns 404 when notification belongs to different user', async () => {
    // NotificationModel.markRead with user_id guard will return null
    NotificationModel.markRead.mockResolvedValue(null);

    await expect(notificationsService.markRead('notif-id', USER_A))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('remove returns 404 when notification does not belong to user', async () => {
    // pool.query soft-delete returns no rows (different user_id)
    pool.query.mockResolvedValueOnce({ rows: [] });

    await expect(notificationsService.remove('notif-id', USER_A))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('list returns only current user\'s notifications', async () => {
    const rows = [
      { id: 'n1', type: 'enrollment', title: 'Enrolled', body: null,
        reference_type: null, reference_id: null, is_read: false, read_at: null, created_at: new Date() },
    ];
    NotificationModel.listForUser.mockResolvedValue(rows);
    NotificationModel.unreadCount.mockResolvedValue(1);

    const result = await notificationsService.list(USER_A, {});
    expect(result.notifications).toHaveLength(1);
    expect(NotificationModel.listForUser).toHaveBeenCalledWith(USER_A, expect.any(Object));
  });

  test('dispatch creates notification for target user only', async () => {
    NotificationModel.create.mockResolvedValue({ id: 'new-notif' });

    await notificationsService.dispatch({
      userId: USER_B, type: 'grade', title: 'Grade posted', body: 'You got 90',
    });

    expect(NotificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_B }),
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGES
// ─────────────────────────────────────────────────────────────────────────────

describe('messages.service — cross-tenant isolation', () => {

  test('getThread returns 404 when actor is not a participant', async () => {
    NotificationModel.isParticipant.mockResolvedValue(false);

    await expect(messagesService.getThread(THREAD_B, actorA()))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('listMessages returns 404 when actor is not a participant', async () => {
    NotificationModel.isParticipant.mockResolvedValue(false);

    await expect(messagesService.listMessages(THREAD_B, actorA(), {}))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('sendMessage returns 404 when actor is not a participant', async () => {
    NotificationModel.isParticipant.mockResolvedValue(false);

    await expect(messagesService.sendMessage(THREAD_B, { body: 'hello' }, actorA()))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('createThread blocks cross-institution direct thread', async () => {
    // USER_B belongs to INST_B — assertSameInstitution should reject
    pool.query
      // assertSameInstitution: returns USER_B as mismatched (not in INST_A)
      .mockResolvedValueOnce({ rows: [{ id: USER_B }] });

    await expect(messagesService.createThread(
      { threadType: 'direct', participantIds: [USER_B] },
      actorA(),
    )).rejects.toMatchObject({ statusCode: 403 });
  });

  test('createThread allows same-institution direct thread', async () => {
    // assertSameInstitution: no mismatched users
    pool.query
      .mockResolvedValueOnce({ rows: [] }); // no cross-institution users

    const threadRow = { id: THREAD_A, subject: null, thread_type: 'direct', course_id: null, updated_at: new Date() };
    NotificationModel.createThread.mockResolvedValue(threadRow);
    NotificationModel.addParticipant.mockResolvedValue(undefined);

    const result = await messagesService.createThread(
      { threadType: 'direct', participantIds: [USER_B] },
      actorA(),
    );
    expect(result).toMatchObject({ id: THREAD_A, threadType: 'direct' });
  });

  test('createThread course thread blocks non-enrolled participants', async () => {
    // Enrollment check: only 0 of 1 participants enrolled
    pool.query.mockResolvedValueOnce({ rows: [] }); // no active enrollments for USER_B

    await expect(messagesService.createThread(
      { threadType: 'course', courseId: COURSE_A, participantIds: [USER_B] },
      actorA(),
    )).rejects.toMatchObject({ statusCode: 403 });
  });

  test('participant can read messages in own thread', async () => {
    NotificationModel.isParticipant.mockResolvedValue(true);
    NotificationModel.listMessages.mockResolvedValue([
      { id: 'msg-1', sender_id: USER_A, body: 'Hello', attachment_url: null,
        created_at: new Date(), first_name: 'Alex', last_name: 'J', avatar_url: null },
    ]);
    NotificationModel.updateLastRead.mockResolvedValue(undefined);

    const result = await messagesService.listMessages(THREAD_A, actorA(), {});
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ senderId: USER_A, body: 'Hello' });
  });

});
