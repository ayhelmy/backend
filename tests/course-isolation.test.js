'use strict';

/**
 * Course-level access control tests.
 *
 * Covers:
 *   - loadCourse middleware (institution scope + 404 vs 403 distinction)
 *   - requireCourseAccess middleware (role-based access per course)
 *   - requireCourseOwnership middleware (instructor/admin only writes)
 *   - courses.service: enroll rules, update ownership, remove access, assertInstitution
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../src/db/models', () => ({
  CourseModel:  {},
  UserModel:    {},
  RoleModel:    {},
  AuditModel:   { log: jest.fn().mockResolvedValue(undefined) },
  InstitutionModel: {},
}));
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/config/redis', () => ({
  del:      jest.fn().mockResolvedValue(1),
  setex:    jest.fn().mockResolvedValue('OK'),
  smembers: jest.fn().mockResolvedValue([]),
}));

const { CourseModel, RoleModel } = require('../src/db/models');
const { pool }                   = require('../src/config/database');
const coursesService             = require('../src/modules/courses/courses.service');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const INST_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const INST_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const DEPT_A = 'dddddddd-0000-0000-0000-000000000010';

function actor(overrides = {}) {
  return {
    id: 'actor-id',
    email: 'actor@a.com',
    institutionId: INST_A,
    roles: [],
    permissions: [],
    ...overrides,
  };
}

function buildCourse(overrides = {}) {
  return {
    id: 'course-id',
    title: 'Test Course',
    status: 'published',
    institution_id: INST_A,
    instructor_id: 'instructor-a',
    department_id: DEPT_A,
    enrollment_type: 'open',
    enrollment_cap: null,
    visibility: 'institution',
    ...overrides,
  };
}

function mockResponse() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

/** Runs a middleware array or single middleware and returns the next() arg */
async function runMiddleware(middlewareOrArray, req) {
  const middlewares = Array.isArray(middlewareOrArray)
    ? middlewareOrArray
    : [middlewareOrArray];

  const res = mockResponse();
  let nextArg;
  let stopped = false;

  for (const mw of middlewares) {
    if (stopped) break;
    await new Promise((resolve) => {
      mw(req, res, (arg) => {
        nextArg = arg;
        if (arg instanceof Error) stopped = true;
        resolve();
      });
    });
  }
  return nextArg;
}

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// 1. loadCourse middleware
// ─────────────────────────────────────────────────────────────────────────────

describe('loadCourse middleware', () => {
  const { loadCourse } = require('../src/middleware/scopeGuards');

  it('returns 404 for non-existent course', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const req = { params: { id: 'missing' }, user: actor() };

    const err = await runMiddleware(loadCourse, req);
    expect(err).toMatchObject({ status: 404 });
  });

  it('returns 404 (not 403) for cross-institution course', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourse({ institution_id: INST_B })] });
    const req = { params: { id: 'course-b' }, user: actor({ roles: ['institution_admin'] }) };

    const err = await runMiddleware(loadCourse, req);
    expect(err.status).toBe(404);
    expect(err.message).not.toContain('institution');
  });

  it('super_admin can load course from any institution', async () => {
    const c = buildCourse({ institution_id: INST_B });
    pool.query.mockResolvedValueOnce({ rows: [c] });
    const req = { params: { id: 'course-b' }, user: actor({ roles: ['super_admin'] }) };

    const err = await runMiddleware(loadCourse, req);
    expect(err).toBeUndefined();
    expect(req.course).toEqual(c);
  });

  it('populates req.course for valid course in own institution', async () => {
    const c = buildCourse();
    pool.query.mockResolvedValueOnce({ rows: [c] });
    const req = { params: { id: 'course-id' }, user: actor({ roles: ['instructor'] }) };

    const err = await runMiddleware(loadCourse, req);
    expect(err).toBeUndefined();
    expect(req.course).toEqual(c);
  });

  it('supports courseId param (mergeParams for grade routes)', async () => {
    const c = buildCourse();
    pool.query.mockResolvedValueOnce({ rows: [c] });
    const req = { params: { courseId: 'course-id' }, user: actor({ roles: ['instructor'] }) };

    const err = await runMiddleware(loadCourse, req);
    expect(err).toBeUndefined();
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['course-id']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. requireCourseOwnership middleware
// ─────────────────────────────────────────────────────────────────────────────

describe('requireCourseOwnership middleware', () => {
  const { requireCourseOwnership } = require('../src/middleware/scopeGuards');

  it('allows the course instructor', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourse({ instructor_id: 'instructor-a' })] });
    const req = { params: { id: 'course-id' }, user: actor({ id: 'instructor-a', roles: ['instructor'] }) };

    const err = await runMiddleware(requireCourseOwnership, req);
    expect(err).toBeUndefined();
  });

  it('blocks a different instructor (403)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourse({ instructor_id: 'instructor-b' })] });
    const req = { params: { id: 'course-id' }, user: actor({ id: 'instructor-a', roles: ['instructor'] }) };

    const err = await runMiddleware(requireCourseOwnership, req);
    expect(err).toMatchObject({ status: 403 });
  });

  it('allows institution_admin regardless of instructor', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourse({ instructor_id: 'someone-else' })] });
    const req = { params: { id: 'course-id' }, user: actor({ roles: ['institution_admin'] }) };

    const err = await runMiddleware(requireCourseOwnership, req);
    expect(err).toBeUndefined();
  });

  it('allows super_admin across institutions', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourse({ institution_id: INST_B })] });
    const req = { params: { id: 'course-b' }, user: actor({ roles: ['super_admin'] }) };

    const err = await runMiddleware(requireCourseOwnership, req);
    expect(err).toBeUndefined();
  });

  it('returns 404 (not 403) for cross-institution course', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourse({ institution_id: INST_B })] });
    const req = { params: { id: 'course-b' }, user: actor({ id: 'instructor-a', roles: ['instructor'] }) };

    const err = await runMiddleware(requireCourseOwnership, req);
    expect(err.status).toBe(404);
  });

  it('blocks student from write operations', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourse()] });
    const req = { params: { id: 'course-id' }, user: actor({ roles: ['student'], permissions: [] }) };

    const err = await runMiddleware(requireCourseOwnership, req);
    expect(err).toMatchObject({ status: 403 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. requireCourseAccess middleware
// ─────────────────────────────────────────────────────────────────────────────

describe('requireCourseAccess middleware', () => {
  const { requireCourseAccess } = require('../src/middleware/scopeGuards');

  it('allows instructor who owns the course with required permission', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourse({ instructor_id: 'instructor-a' })] });
    const req = {
      params: { courseId: 'course-id' },
      user: actor({ id: 'instructor-a', roles: ['instructor'], permissions: ['grades.view_course'] }),
    };

    const err = await runMiddleware(requireCourseAccess('grades.view_course'), req);
    expect(err).toBeUndefined();
  });

  it('blocks instructor missing required permission', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourse({ instructor_id: 'instructor-a' })] });
    const req = {
      params: { courseId: 'course-id' },
      user: actor({ id: 'instructor-a', roles: ['instructor'], permissions: [] }),
    };

    const err = await runMiddleware(requireCourseAccess('grades.view_course'), req);
    expect(err).toMatchObject({ status: 403 });
  });

  it('blocks instructor accessing another instructor course', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourse({ instructor_id: 'instructor-b' })] });
    const req = {
      params: { courseId: 'course-id' },
      user: actor({ id: 'instructor-a', roles: ['instructor'], permissions: ['grades.view_course'] }),
    };

    const err = await runMiddleware(requireCourseAccess('grades.view_course'), req);
    expect(err).toMatchObject({ status: 403 });
  });

  it('allows enrolled student (active status)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [buildCourse()] })              // loadCourse
      .mockResolvedValueOnce({ rows: [{ '1': '1' }] });              // enrollment check

    const req = {
      params: { courseId: 'course-id' },
      user: actor({ id: 'student-id', roles: ['student'], permissions: ['grades.view_own'] }),
    };

    const err = await runMiddleware(requireCourseAccess(), req);
    expect(err).toBeUndefined();
  });

  it('blocks non-enrolled student', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [buildCourse()] })  // loadCourse
      .mockResolvedValueOnce({ rows: [] });               // no enrollment

    const req = {
      params: { courseId: 'course-id' },
      user: actor({ id: 'student-id', roles: ['student'], permissions: ['grades.view_own'] }),
    };

    const err = await runMiddleware(requireCourseAccess(), req);
    expect(err).toMatchObject({ status: 403 });
  });

  it('allows assigned TA to access course', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [buildCourse()] })         // loadCourse
      .mockResolvedValueOnce({ rows: [{ '1': '1' }] });          // TA assignment

    const req = {
      params: { courseId: 'course-id' },
      user: actor({ id: 'ta-id', roles: ['teaching_assistant'], permissions: ['grades.view_course'] }),
    };

    const err = await runMiddleware(requireCourseAccess('grades.view_course'), req);
    expect(err).toBeUndefined();
  });

  it('blocks unassigned TA', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [buildCourse()] })  // loadCourse
      .mockResolvedValueOnce({ rows: [] });               // not assigned as TA

    const req = {
      params: { courseId: 'course-id' },
      user: actor({ id: 'ta-id', roles: ['teaching_assistant'], permissions: ['grades.view_course'] }),
    };

    const err = await runMiddleware(requireCourseAccess('grades.view_course'), req);
    expect(err).toMatchObject({ status: 403 });
  });

  it('allows institution_admin in own institution without enrollment', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourse()] }); // loadCourse only

    const req = {
      params: { courseId: 'course-id' },
      user: actor({ roles: ['institution_admin'], permissions: ['grades.view_course'] }),
    };

    const err = await runMiddleware(requireCourseAccess('grades.view_course'), req);
    expect(err).toBeUndefined();
    expect(pool.query).toHaveBeenCalledTimes(1); // no enrollment/TA check for admin
  });

  it('blocks institution_admin accessing cross-institution course (404)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourse({ institution_id: INST_B })] });

    const req = {
      params: { courseId: 'course-b-id' },
      user: actor({ roles: ['institution_admin'], permissions: ['grades.view_course'] }),
    };

    const err = await runMiddleware(requireCourseAccess('grades.view_course'), req);
    expect(err.status).toBe(404);
  });

  it('allows dept_manager whose department owns the course', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [buildCourse({ department_id: DEPT_A })] }) // loadCourse
      .mockResolvedValueOnce({ rows: [{ '1': '1' }] });                            // user_departments check

    const req = {
      params: { courseId: 'course-id' },
      user: actor({ roles: ['dept_manager'], permissions: ['grades.view_department'] }),
    };

    const err = await runMiddleware(requireCourseAccess('grades.view_department'), req);
    expect(err).toBeUndefined();
  });

  it('blocks dept_manager from different department', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [buildCourse({ department_id: DEPT_A })] }) // loadCourse
      .mockResolvedValueOnce({ rows: [] });                                        // not in dept

    const req = {
      params: { courseId: 'course-id' },
      user: actor({ roles: ['dept_manager'], permissions: ['grades.view_department'] }),
    };

    const err = await runMiddleware(requireCourseAccess('grades.view_department'), req);
    expect(err).toMatchObject({ status: 403 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. courses.service — assertInstitution (404 not 403)
// ─────────────────────────────────────────────────────────────────────────────

describe('courses.service — cross-institution isolation', () => {
  it('getOne returns 404 (not 403) for cross-institution', async () => {
    CourseModel.findById = jest.fn().mockResolvedValue(buildCourse({ institution_id: INST_B }));

    const err = await coursesService.getOne('course-b-id', actor({ roles: ['institution_admin'] }))
      .catch(e => e);

    expect(err.status).toBe(404);
    expect(err.message).not.toMatch(/different institution/i);
  });

  it('super_admin accesses cross-institution course without error', async () => {
    CourseModel.findById = jest.fn().mockResolvedValue(buildCourse({ institution_id: INST_B }));

    await expect(coursesService.getOne('course-b-id', actor({ roles: ['super_admin'], permissions: ['courses.view_all'] })))
      .resolves.toBeDefined();
  });

  it('listEnrollments blocks cross-institution (404)', async () => {
    CourseModel.findById = jest.fn().mockResolvedValue(buildCourse({ institution_id: INST_B }));

    const err = await coursesService.listEnrollments('course-b-id', {}, actor({ roles: ['institution_admin'] }))
      .catch(e => e);

    expect(err.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. courses.service — enrollment rules
// ─────────────────────────────────────────────────────────────────────────────

describe('courses.service — enrollment rules', () => {
  it('student can self-enroll in open course', async () => {
    const c = buildCourse({ enrollment_type: 'open', status: 'published' });
    CourseModel.findById       = jest.fn().mockResolvedValue(c);
    CourseModel.findEnrollment = jest.fn().mockResolvedValue(null);
    CourseModel.enroll         = jest.fn().mockResolvedValue({ id: 'e1', status: 'active' });
    pool.query.mockResolvedValueOnce({ rows: [{ total: '0' }] });

    const result = await coursesService.enroll('course-id', {}, actor({ id: 'student-id', roles: ['student'] }));
    expect(result.status).toBe('active');
  });

  it('blocks enrollment in cross-institution course', async () => {
    const c = buildCourse({ institution_id: INST_B, enrollment_type: 'open', status: 'published' });
    CourseModel.findById = jest.fn().mockResolvedValue(c);

    await expect(coursesService.enroll('course-b-id', {}, actor({ id: 'student-id', roles: ['student'] })))
      .rejects.toMatchObject({ status: 403 });
  });

  it('blocks double-enrollment', async () => {
    const c = buildCourse({ enrollment_type: 'open', status: 'published' });
    CourseModel.findById       = jest.fn().mockResolvedValue(c);
    CourseModel.findEnrollment = jest.fn().mockResolvedValue({ id: 'e1', status: 'active' });

    await expect(coursesService.enroll('course-id', {}, actor({ id: 'student-id', roles: ['student'] })))
      .rejects.toMatchObject({ status: 409 });
  });

  it('blocks enrollment when capacity is full', async () => {
    const c = buildCourse({ enrollment_type: 'open', status: 'published', enrollment_cap: 2 });
    CourseModel.findById       = jest.fn().mockResolvedValue(c);
    CourseModel.findEnrollment = jest.fn().mockResolvedValue(null);
    pool.query.mockResolvedValueOnce({ rows: [{ total: '2' }] });

    await expect(coursesService.enroll('course-id', {}, actor({ id: 'student-id', roles: ['student'] })))
      .rejects.toMatchObject({ status: 409 });
  });

  it('approval_required creates pending enrollment', async () => {
    const c = buildCourse({ enrollment_type: 'approval_required', status: 'published' });
    CourseModel.findById       = jest.fn().mockResolvedValue(c);
    CourseModel.findEnrollment = jest.fn().mockResolvedValue(null);
    CourseModel.enroll         = jest.fn().mockResolvedValue({ id: 'e1', status: 'pending' });
    pool.query.mockResolvedValueOnce({ rows: [{ total: '0' }] });

    const result = await coursesService.enroll('course-id', {}, actor({ id: 'student-id', roles: ['student'] }));
    expect(result.status).toBe('pending');
  });

  it('invite_only blocks uninvited student', async () => {
    const c = buildCourse({ enrollment_type: 'invite_only', status: 'published' });
    CourseModel.findById       = jest.fn().mockResolvedValue(c);
    CourseModel.findEnrollment = jest.fn().mockResolvedValue(null);

    await expect(coursesService.enroll('course-id', {}, actor({ id: 'student-id', roles: ['student'] })))
      .rejects.toMatchObject({ status: 403 });
  });

  it('blocks enrollment in draft course', async () => {
    const c = buildCourse({ status: 'draft', enrollment_type: 'open' });
    CourseModel.findById = jest.fn().mockResolvedValue(c);

    await expect(coursesService.enroll('course-id', {}, actor({ id: 'student-id', roles: ['student'] })))
      .rejects.toMatchObject({ status: 403 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. courses.service — update/remove ownership
// ─────────────────────────────────────────────────────────────────────────────

describe('courses.service — update & remove ownership', () => {
  it('instructor can update own course', async () => {
    const c = buildCourse({ instructor_id: 'instructor-a' });
    CourseModel.findById = jest.fn().mockResolvedValue(c);
    CourseModel.update   = jest.fn().mockResolvedValue({ ...c, title: 'Updated' });

    const result = await coursesService.update('course-id', { title: 'Updated' }, actor({
      id: 'instructor-a',
      roles: ['instructor'],
      permissions: ['courses.update_own'],
    }));
    expect(result.title).toBe('Updated');
  });

  it('instructor cannot update another instructor course', async () => {
    CourseModel.findById = jest.fn().mockResolvedValue(buildCourse({ instructor_id: 'instructor-b' }));

    await expect(coursesService.update('course-id', { title: 'Hacked' }, actor({
      id: 'instructor-a',
      roles: ['instructor'],
      permissions: ['courses.update_own'],
    }))).rejects.toMatchObject({ status: 403 });
  });

  it('instructor cannot remove a course (no delete permission)', async () => {
    CourseModel.findById = jest.fn().mockResolvedValue(buildCourse({ instructor_id: 'instructor-a' }));

    await expect(coursesService.remove('course-id', actor({
      id: 'instructor-a',
      roles: ['instructor'],
      permissions: ['courses.update_own'],
    }))).rejects.toMatchObject({ status: 403 });
  });

  it('institution_admin can remove course in own institution', async () => {
    const c = buildCourse();
    CourseModel.findById   = jest.fn().mockResolvedValue(c);
    CourseModel.softDelete = jest.fn().mockResolvedValue(undefined);

    await expect(coursesService.remove('course-id', actor({
      roles: ['institution_admin'],
      permissions: ['courses.update_all'],
    }))).resolves.toBeUndefined();
  });
});
