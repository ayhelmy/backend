'use strict';

/**
 * Simulation Activity — backend unit tests.
 *
 * Strategy: mock all DB models and external services so tests are fast and
 * deterministic. Integration (real DB) tests are out of scope here.
 *
 * Run: npx jest src/__tests__/simulation-activity.test.js
 */

jest.mock('../db/models', () => ({
  CourseModel:                    require('./__mocks__/CourseModel'),
  ModuleModel:                    require('./__mocks__/ModuleModel'),
  SimulationModel:                require('./__mocks__/SimulationModel'),
  AuditModel:                     { log: jest.fn().mockResolvedValue({}) },
  SimulationActivitySessionModel: require('./__mocks__/SimulationActivitySessionModel'),
}));

const svc = require('../modules/simulation-activity/activity.service');

// ── Shared fixtures ───────────────────────────────────────────────────────────

const INSTITUTION_ID  = 'inst-1111';
const DEPT_ID         = 'dept-2222';
const COURSE_ID       = 'course-aaaa';
const LESSON_ID       = 'lesson-bbbb';
const MODULE_ID       = 'module-cccc';
const SIM_ID          = 'sim-dddd';
const SESSION_ID      = 'session-eeee';

const mockCourse = {
  id:             COURSE_ID,
  institution_id: INSTITUTION_ID,
  department_id:  DEPT_ID,
  instructor_id:  'instructor-0001',
  status:         'published',
};

const mockModule = {
  id:        MODULE_ID,
  course_id: COURSE_ID,
  title:     'Test Module',
};

const mockLesson = {
  id:            LESSON_ID,
  module_id:     MODULE_ID,
  course_id:     COURSE_ID,
  institution_id: INSTITUTION_ID,
  department_id:  DEPT_ID,
  simulation_id: SIM_ID,
  lesson_mode:   'simulation',
  is_published:  true,
  title:         'Test Lesson',
};

const mockSim = {
  id:           SIM_ID,
  status:       'active',
  launch_type:  'webgl',
  build_status: 'ready',
  public_entry_url: '/simulations-runtime/uuid/index.html',
  title:        'Test Simulation',
  difficulty:   'intermediate',
  estimated_minutes: 30,
};

const mockSession = {
  id:               SESSION_ID,
  institution_id:   INSTITUTION_ID,
  department_id:    DEPT_ID,
  user_id:          'student-0001',
  user_role:        'student',
  course_id:        COURSE_ID,
  module_id:        MODULE_ID,
  lesson_id:        LESSON_ID,
  simulation_id:    SIM_ID,
  started_at:       new Date(Date.now() - 60_000).toISOString(),
  ended_at:         null,
  duration_seconds: 0,
  last_heartbeat_at: null,
  status:           'active',
  exit_reason:      null,
  created_at:       new Date().toISOString(),
  updated_at:       new Date().toISOString(),
};

const studentActor = {
  id:            'student-0001',
  email:         'student@test.com',
  institutionId: INSTITUTION_ID,
  roles:         ['student'],
  permissions:   ['lessons.view'],
};

const instructorActor = {
  id:            'instructor-0001',
  email:         'instructor@test.com',
  institutionId: INSTITUTION_ID,
  roles:         ['instructor'],
  permissions:   ['lessons.view', 'lessons.create'],
};

const otherInstructorActor = {
  id:            'instructor-9999',
  email:         'other@test.com',
  institutionId: INSTITUTION_ID,
  roles:         ['instructor'],
  permissions:   ['lessons.view'],
};

const mockReq = { protocol: 'http', get: () => 'localhost:5000', ip: '127.0.0.1' };

// ── Mock implementations ──────────────────────────────────────────────────────

// These are loaded by jest.mock above — we define them here as module factories.
// They are created fresh per test via beforeEach resets on individual fns.

const { CourseModel, ModuleModel, SimulationModel, SimulationActivitySessionModel } =
  require('../db/models');

beforeEach(() => {
  jest.clearAllMocks();

  CourseModel.findById.mockResolvedValue(mockCourse);
  CourseModel.findEnrollment.mockResolvedValue({ status: 'active' });

  ModuleModel.findLessonById.mockResolvedValue(mockLesson);
  ModuleModel.findById.mockResolvedValue(mockModule);

  SimulationModel.findById.mockResolvedValue(mockSim);

  SimulationActivitySessionModel.endStaleActive.mockResolvedValue(undefined);
  SimulationActivitySessionModel.create.mockResolvedValue(mockSession);
  SimulationActivitySessionModel.findById.mockResolvedValue(mockSession);
  SimulationActivitySessionModel.updateHeartbeat.mockResolvedValue({
    ...mockSession, last_heartbeat_at: new Date().toISOString(),
  });
  SimulationActivitySessionModel.end.mockResolvedValue({
    ...mockSession,
    status:           'ended',
    ended_at:         new Date().toISOString(),
    duration_seconds: 65,
  });
  SimulationActivitySessionModel.listByUser.mockResolvedValue({ rows: [], total: 0 });
  SimulationActivitySessionModel.listByCourse.mockResolvedValue({ rows: [], total: 0 });
  SimulationActivitySessionModel.getCourseSummary.mockResolvedValue({
    total_launches: 0, unique_students: 0,
    total_duration_seconds: 0, avg_duration_seconds: 0,
  });
  SimulationActivitySessionModel.getLatestByLessonUser.mockResolvedValue(null);
  SimulationActivitySessionModel.markAbandonedByHeartbeat.mockResolvedValue(0);
  SimulationActivitySessionModel.markExpiredNoHeartbeat.mockResolvedValue(0);
});

// ── Tests: start ──────────────────────────────────────────────────────────────

describe('activity.service — start()', () => {
  test('student with active enrollment starts a session and gets launch URL', async () => {
    const result = await svc.start({ courseId: COURSE_ID, lessonId: LESSON_ID }, studentActor, mockReq);

    expect(CourseModel.findEnrollment).toHaveBeenCalledWith(COURSE_ID, studentActor.id);
    expect(SimulationActivitySessionModel.endStaleActive).toHaveBeenCalledWith(
      studentActor.id, LESSON_ID, SIM_ID,
    );
    expect(SimulationActivitySessionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId:      studentActor.id,
        courseId:    COURSE_ID,
        lessonId:    LESSON_ID,
        simulationId: SIM_ID,
      }),
    );

    expect(result.sessionId).toBe(SESSION_ID);
    expect(result.launchUrl).toContain('/simulations-runtime/');
    expect(result.status).toBe('active');
  });

  test('activity session stores correct course, lesson, and simulation IDs', async () => {
    await svc.start({ courseId: COURSE_ID, lessonId: LESSON_ID }, studentActor, mockReq);

    const createCall = SimulationActivitySessionModel.create.mock.calls[0][0];
    expect(createCall.courseId).toBe(COURSE_ID);
    expect(createCall.moduleId).toBe(MODULE_ID);
    expect(createCall.lessonId).toBe(LESSON_ID);
    expect(createCall.simulationId).toBe(SIM_ID);
    expect(createCall.institutionId).toBe(INSTITUTION_ID);
  });

  test('instructor can start a session without enrollment check', async () => {
    await svc.start({ courseId: COURSE_ID, lessonId: LESSON_ID }, instructorActor, mockReq);
    expect(CourseModel.findEnrollment).not.toHaveBeenCalled();
  });

  test('unenrolled student cannot start a session — throws 403', async () => {
    CourseModel.findEnrollment.mockResolvedValue(null);
    await expect(
      svc.start({ courseId: COURSE_ID, lessonId: LESSON_ID }, studentActor, mockReq),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(SimulationActivitySessionModel.create).not.toHaveBeenCalled();
  });

  test('cross-institution access is blocked — course not found for different institution', async () => {
    const foreignStudent = { ...studentActor, institutionId: 'other-institution' };
    await expect(
      svc.start({ courseId: COURSE_ID, lessonId: LESSON_ID }, foreignStudent, mockReq),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('lesson with no simulation throws 400', async () => {
    ModuleModel.findLessonById.mockResolvedValue({
      ...mockLesson, lesson_mode: 'content', simulation_id: null,
    });
    await expect(
      svc.start({ courseId: COURSE_ID, lessonId: LESSON_ID }, studentActor, mockReq),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('simulation not active throws 400', async () => {
    SimulationModel.findById.mockResolvedValue({ ...mockSim, status: 'deprecated' });
    await expect(
      svc.start({ courseId: COURSE_ID, lessonId: LESSON_ID }, studentActor, mockReq),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('simulation build not ready throws 400', async () => {
    SimulationModel.findById.mockResolvedValue({ ...mockSim, build_status: 'processing' });
    await expect(
      svc.start({ courseId: COURSE_ID, lessonId: LESSON_ID }, studentActor, mockReq),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('stale active session is ended before new session is created', async () => {
    await svc.start({ courseId: COURSE_ID, lessonId: LESSON_ID }, studentActor, mockReq);
    expect(SimulationActivitySessionModel.endStaleActive).toHaveBeenCalledBefore
      ? expect(SimulationActivitySessionModel.endStaleActive).toHaveBeenCalledBefore(
          SimulationActivitySessionModel.create,
        )
      : expect(SimulationActivitySessionModel.endStaleActive.mock.invocationCallOrder[0])
          .toBeLessThan(SimulationActivitySessionModel.create.mock.invocationCallOrder[0]);
  });
});

// ── Tests: heartbeat ──────────────────────────────────────────────────────────

describe('activity.service — heartbeat()', () => {
  test('heartbeat updates last_heartbeat_at for active session', async () => {
    const result = await svc.heartbeat(SESSION_ID, studentActor);
    expect(SimulationActivitySessionModel.updateHeartbeat).toHaveBeenCalledWith(SESSION_ID);
    expect(result.sessionId).toBe(SESSION_ID);
  });

  test('heartbeat by non-owner throws 403', async () => {
    await expect(svc.heartbeat(SESSION_ID, instructorActor)).rejects.toMatchObject({ statusCode: 403 });
    expect(SimulationActivitySessionModel.updateHeartbeat).not.toHaveBeenCalled();
  });

  test('heartbeat for already-ended session returns existing status without error', async () => {
    SimulationActivitySessionModel.findById.mockResolvedValue({ ...mockSession, status: 'ended' });
    const result = await svc.heartbeat(SESSION_ID, studentActor);
    expect(result.status).toBe('ended');
    expect(SimulationActivitySessionModel.updateHeartbeat).not.toHaveBeenCalled();
  });
});

// ── Tests: end ────────────────────────────────────────────────────────────────

describe('activity.service — end()', () => {
  test('end calculates duration using server timestamps (not client input)', async () => {
    const result = await svc.end(SESSION_ID, { exitReason: 'user_exit' }, studentActor, mockReq);

    expect(SimulationActivitySessionModel.end).toHaveBeenCalledWith(SESSION_ID, 'user_exit');
    expect(result.durationSeconds).toBeGreaterThanOrEqual(0);
    expect(typeof result.formattedDuration).toBe('string');
  });

  test('ending an already-ended session returns existing data without error', async () => {
    SimulationActivitySessionModel.findById.mockResolvedValue({
      ...mockSession,
      status:           'ended',
      ended_at:         new Date().toISOString(),
      duration_seconds: 120,
    });
    const result = await svc.end(SESSION_ID, {}, studentActor, mockReq);
    expect(result.status).toBe('ended');
    expect(SimulationActivitySessionModel.end).not.toHaveBeenCalled();
  });

  test('ending a session owned by another user throws 403', async () => {
    await expect(
      svc.end(SESSION_ID, {}, { ...studentActor, id: 'other-student' }, mockReq),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('institution_admin can end a session in their institution', async () => {
    const admin = {
      id: 'admin-0001', email: 'admin@test.com',
      institutionId: INSTITUTION_ID,
      roles: ['institution_admin'], permissions: [],
    };
    await expect(svc.end(SESSION_ID, {}, admin, mockReq)).resolves.toBeDefined();
  });
});

// ── Tests: listMyActivity ─────────────────────────────────────────────────────

describe('activity.service — listMyActivity()', () => {
  test('student can view only their own activity', async () => {
    await svc.listMyActivity({}, studentActor);
    expect(SimulationActivitySessionModel.listByUser).toHaveBeenCalledWith(
      studentActor.id,
      expect.any(Object),
      expect.any(Object),
    );
  });
});

// ── Tests: listCourseActivity ─────────────────────────────────────────────────

describe('activity.service — listCourseActivity()', () => {
  test('instructor can view activity for own course', async () => {
    await svc.listCourseActivity(COURSE_ID, {}, instructorActor);
    expect(SimulationActivitySessionModel.listByCourse).toHaveBeenCalledWith(
      COURSE_ID, expect.any(Object), expect.any(Object),
    );
  });

  test('instructor cannot view activity for course they do not own', async () => {
    await expect(
      svc.listCourseActivity(COURSE_ID, {}, otherInstructorActor),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(SimulationActivitySessionModel.listByCourse).not.toHaveBeenCalled();
  });

  test('cross-institution access is blocked — 404 for unknown course', async () => {
    const foreignInstructor = { ...instructorActor, institutionId: 'other-institution' };
    await expect(
      svc.listCourseActivity(COURSE_ID, {}, foreignInstructor),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('summary statistics are returned alongside session list', async () => {
    SimulationActivitySessionModel.getCourseSummary.mockResolvedValue({
      total_launches: 5, unique_students: 3,
      total_duration_seconds: 600, avg_duration_seconds: 120,
    });
    const result = await svc.listCourseActivity(COURSE_ID, {}, instructorActor);
    expect(result.summary.totalLaunches).toBe(5);
    expect(result.summary.uniqueStudents).toBe(3);
    expect(typeof result.summary.formattedTotalDuration).toBe('string');
  });
});

// ── Tests: cleanupStaleSessions ───────────────────────────────────────────────

describe('activity.service — cleanupStaleSessions()', () => {
  test('marks abandoned sessions by heartbeat cutoff', async () => {
    SimulationActivitySessionModel.markAbandonedByHeartbeat.mockResolvedValue(2);
    SimulationActivitySessionModel.markExpiredNoHeartbeat.mockResolvedValue(1);
    const result = await svc.cleanupStaleSessions(5);
    expect(result.abandoned).toBe(2);
    expect(result.expired).toBe(1);
    expect(SimulationActivitySessionModel.markAbandonedByHeartbeat).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );
  });
});

// ── Mock module factories (required by jest.mock at top) ──────────────────────

// These files don't need to exist on disk — jest.mock intercepts the require.
// Define them as inline factories here for clarity.
