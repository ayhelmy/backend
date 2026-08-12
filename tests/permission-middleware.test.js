'use strict';

/**
 * Permission middleware unit tests.
 *
 * Covers authorize.js:
 *   - authorize(...roles)
 *   - requirePermission(code)
 *   - requireAnyPermission(...codes)
 *   - requireAllPermissions(...codes)
 *   - requireInstitutionScope(paramName)
 *
 * Covers scopeGuards.js:
 *   - loadCourse
 *   - requireCourseOwnership (array middleware)
 *   - requireCourseAccess(permission) (array middleware factory)
 *   - requireDepartmentScope
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/config/redis',    () => ({ del: jest.fn(), setex: jest.fn() }));

const { pool } = require('../src/config/database');

const {
  authorize,
  requirePermission,
  requireAnyPermission,
  requireAllPermissions,
  requireInstitutionScope,
} = require('../src/middleware/authorize');

const {
  loadCourse,
  requireCourseOwnership,
  requireCourseAccess,
  requireDepartmentScope,
} = require('../src/middleware/scopeGuards');

// ── Helpers ───────────────────────────────────────────────────────────────────

const INST_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const INST_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const DEPT_A = 'dddddddd-0000-0000-0000-000000000010';

function req(overrides = {}) {
  return {
    user: null,
    params: {},
    body: {},
    ...overrides,
  };
}

function user(overrides = {}) {
  return {
    id: 'user-id',
    institutionId: INST_A,
    roles: [],
    permissions: [],
    ...overrides,
  };
}

function buildCourseRow(overrides = {}) {
  return {
    id: 'course-id',
    institution_id: INST_A,
    department_id: DEPT_A,
    instructor_id: 'instructor-a',
    status: 'published',
    ...overrides,
  };
}

/**
 * Calls a single synchronous middleware and captures the next() argument.
 */
function callSync(middleware, request) {
  let result;
  middleware(request, {}, (arg) => { result = arg; });
  return result;
}

/**
 * Calls an async middleware and captures the next() argument.
 */
async function callAsync(middleware, request) {
  return new Promise((resolve) => {
    middleware(request, {}, (arg) => resolve(arg));
  });
}

/**
 * Runs an array of middlewares in sequence, stopping on error.
 */
async function runChain(middlewares, request) {
  let lastArg;
  for (const mw of middlewares) {
    let stopped = false;
    await new Promise((resolve) => {
      mw(request, {}, (arg) => {
        lastArg = arg;
        if (arg instanceof Error) stopped = true;
        resolve();
      });
    });
    if (stopped) break;
  }
  return lastArg;
}

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// 1. authorize(...roles)
// ─────────────────────────────────────────────────────────────────────────────

describe('authorize()', () => {
  it('returns 401 when no user', () => {
    const err = callSync(authorize('instructor'), req());
    expect(err).toMatchObject({ status: 401 });
  });

  it('returns 403 when user lacks any listed role', () => {
    const err = callSync(authorize('instructor'), req({ user: user({ roles: ['student'] }) }));
    expect(err).toMatchObject({ status: 403 });
  });

  it('passes when user has one of the listed roles', () => {
    const err = callSync(authorize('instructor', 'institution_admin'), req({ user: user({ roles: ['instructor'] }) }));
    expect(err).toBeUndefined();
  });

  it('passes when user has role stored as object with .name', () => {
    const err = callSync(authorize('instructor'), req({ user: user({ roles: [{ name: 'instructor' }] }) }));
    expect(err).toBeUndefined();
  });

  it('passes with multiple allowed roles (OR semantics)', () => {
    const err = callSync(authorize('super_admin', 'institution_admin'), req({ user: user({ roles: ['institution_admin'] }) }));
    expect(err).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. requirePermission(code)
// ─────────────────────────────────────────────────────────────────────────────

describe('requirePermission()', () => {
  it('returns 401 when no user', () => {
    const err = callSync(requirePermission('courses.create'), req());
    expect(err).toMatchObject({ status: 401 });
  });

  it('returns 403 when user lacks the permission', () => {
    const err = callSync(requirePermission('courses.create'), req({ user: user({ permissions: ['courses.view_own'] }) }));
    expect(err).toMatchObject({ status: 403 });
  });

  it('includes the missing permission code in the error message', () => {
    const err = callSync(requirePermission('grades.override'), req({ user: user({ permissions: [] }) }));
    expect(err.message).toContain('grades.override');
  });

  it('passes when user has the required permission', () => {
    const err = callSync(requirePermission('courses.create'), req({ user: user({ permissions: ['courses.create'] }) }));
    expect(err).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. requireAnyPermission(...codes)
// ─────────────────────────────────────────────────────────────────────────────

describe('requireAnyPermission()', () => {
  it('returns 401 when no user', () => {
    const err = callSync(requireAnyPermission('a', 'b'), req());
    expect(err).toMatchObject({ status: 401 });
  });

  it('returns 403 when user has none of the listed permissions', () => {
    const err = callSync(
      requireAnyPermission('users.view_institution', 'users.view_all'),
      req({ user: user({ permissions: ['courses.view_own'] }) }),
    );
    expect(err).toMatchObject({ status: 403 });
  });

  it('passes when user has exactly one of the permissions', () => {
    const err = callSync(
      requireAnyPermission('users.view_institution', 'users.view_all'),
      req({ user: user({ permissions: ['users.view_institution'] }) }),
    );
    expect(err).toBeUndefined();
  });

  it('passes when user has multiple listed permissions', () => {
    const err = callSync(
      requireAnyPermission('a', 'b', 'c'),
      req({ user: user({ permissions: ['b', 'c'] }) }),
    );
    expect(err).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. requireAllPermissions(...codes)
// ─────────────────────────────────────────────────────────────────────────────

describe('requireAllPermissions()', () => {
  it('returns 401 when no user', () => {
    const err = callSync(requireAllPermissions('a', 'b'), req());
    expect(err).toMatchObject({ status: 401 });
  });

  it('returns 403 when user is missing any one permission', () => {
    const err = callSync(
      requireAllPermissions('courses.create', 'courses.publish'),
      req({ user: user({ permissions: ['courses.create'] }) }),
    );
    expect(err).toMatchObject({ status: 403 });
  });

  it('includes missing permission codes in error message', () => {
    const err = callSync(
      requireAllPermissions('courses.create', 'grades.override'),
      req({ user: user({ permissions: ['courses.create'] }) }),
    );
    expect(err.message).toContain('grades.override');
  });

  it('passes when user has all listed permissions', () => {
    const err = callSync(
      requireAllPermissions('courses.create', 'courses.publish'),
      req({ user: user({ permissions: ['courses.create', 'courses.publish'] }) }),
    );
    expect(err).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. requireInstitutionScope(paramName)
// ─────────────────────────────────────────────────────────────────────────────

describe('requireInstitutionScope()', () => {
  it('returns 401 when no user', () => {
    const err = callSync(requireInstitutionScope(), req({ params: { id: INST_A } }));
    expect(err).toMatchObject({ status: 401 });
  });

  it('super_admin bypasses institution check', () => {
    const err = callSync(
      requireInstitutionScope(),
      req({ params: { id: INST_B }, user: user({ roles: ['super_admin'], institutionId: INST_A }) }),
    );
    expect(err).toBeUndefined();
  });

  it('returns 403 when user accesses different institution', () => {
    const err = callSync(
      requireInstitutionScope(),
      req({ params: { id: INST_B }, user: user({ institutionId: INST_A }) }),
    );
    expect(err).toMatchObject({ status: 403 });
  });

  it('passes when institution param matches user institution', () => {
    const err = callSync(
      requireInstitutionScope(),
      req({ params: { id: INST_A }, user: user({ institutionId: INST_A }) }),
    );
    expect(err).toBeUndefined();
  });

  it('uses custom param name', () => {
    const err = callSync(
      requireInstitutionScope('institutionId'),
      req({ params: { institutionId: INST_B }, user: user({ institutionId: INST_A }) }),
    );
    expect(err).toMatchObject({ status: 403 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. loadCourse (async middleware)
// ─────────────────────────────────────────────────────────────────────────────

describe('loadCourse()', () => {
  it('returns 404 when course not found in DB', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const request = req({ params: { id: 'x' }, user: user() });

    const err = await callAsync(loadCourse, request);
    expect(err).toMatchObject({ status: 404 });
  });

  it('returns 404 (not 403) for cross-institution course', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourseRow({ institution_id: INST_B })] });
    const request = req({ params: { id: 'course-b' }, user: user({ roles: ['instructor'], institutionId: INST_A }) });

    const err = await callAsync(loadCourse, request);
    expect(err.status).toBe(404);
  });

  it('does NOT reveal institution mismatch in error message', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourseRow({ institution_id: INST_B })] });
    const request = req({ params: { id: 'course-b' }, user: user({ roles: ['instructor'] }) });

    const err = await callAsync(loadCourse, request);
    const msg = err.message.toLowerCase();
    expect(msg).not.toContain('institution');
    expect(msg).not.toContain('different');
    expect(msg).not.toContain('belong');
  });

  it('passes for super_admin regardless of institution', async () => {
    const c = buildCourseRow({ institution_id: INST_B });
    pool.query.mockResolvedValueOnce({ rows: [c] });
    const request = req({ params: { id: 'course-b' }, user: user({ roles: ['super_admin'], institutionId: INST_A }) });

    const err = await callAsync(loadCourse, request);
    expect(err).toBeUndefined();
    expect(request.course).toEqual(c);
  });

  it('reads courseId param as fallback (mergeParams)', async () => {
    const c = buildCourseRow();
    pool.query.mockResolvedValueOnce({ rows: [c] });
    const request = req({ params: { courseId: 'course-id' }, user: user({ roles: ['student'] }) });

    const err = await callAsync(loadCourse, request);
    expect(err).toBeUndefined();
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['course-id']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. requireCourseOwnership (array)
// ─────────────────────────────────────────────────────────────────────────────

describe('requireCourseOwnership', () => {
  it('is an array of middlewares', () => {
    expect(Array.isArray(requireCourseOwnership)).toBe(true);
    expect(requireCourseOwnership.length).toBe(2);
  });

  it('returns 404 for missing course', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const request = req({ params: { id: 'nope' }, user: user({ roles: ['instructor'] }) });

    const err = await runChain(requireCourseOwnership, request);
    expect(err).toMatchObject({ status: 404 });
  });

  it('allows super_admin across institutions', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourseRow({ institution_id: INST_B })] });
    const request = req({ params: { id: 'cross' }, user: user({ roles: ['super_admin'] }) });

    const err = await runChain(requireCourseOwnership, request);
    expect(err).toBeUndefined();
  });

  it('allows institution_admin within own institution', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourseRow()] });
    const request = req({ params: { id: 'course-id' }, user: user({ roles: ['institution_admin'] }) });

    const err = await runChain(requireCourseOwnership, request);
    expect(err).toBeUndefined();
  });

  it('allows course instructor', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourseRow({ instructor_id: 'my-id' })] });
    const request = req({ params: { id: 'course-id' }, user: user({ id: 'my-id', roles: ['instructor'] }) });

    const err = await runChain(requireCourseOwnership, request);
    expect(err).toBeUndefined();
  });

  it('blocks instructor who does not own the course', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourseRow({ instructor_id: 'other-id' })] });
    const request = req({ params: { id: 'course-id' }, user: user({ id: 'my-id', roles: ['instructor'] }) });

    const err = await runChain(requireCourseOwnership, request);
    expect(err).toMatchObject({ status: 403 });
  });

  it('blocks student (not a course-write role)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourseRow()] });
    const request = req({ params: { id: 'course-id' }, user: user({ roles: ['student'] }) });

    const err = await runChain(requireCourseOwnership, request);
    expect(err).toMatchObject({ status: 403 });
  });

  it('blocks teaching_assistant (not a course-write role)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourseRow()] });
    const request = req({ params: { id: 'course-id' }, user: user({ roles: ['teaching_assistant'] }) });

    const err = await runChain(requireCourseOwnership, request);
    expect(err).toMatchObject({ status: 403 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. requireCourseAccess(permission) (array factory)
// ─────────────────────────────────────────────────────────────────────────────

describe('requireCourseAccess()', () => {
  it('returns an array of middlewares', () => {
    const chain = requireCourseAccess('grades.view_course');
    expect(Array.isArray(chain)).toBe(true);
  });

  it('super_admin bypasses all checks', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourseRow({ institution_id: INST_B })] });
    const request = req({
      params: { courseId: 'c' },
      user: user({ roles: ['super_admin'], permissions: [] }),
    });

    const err = await runChain(requireCourseAccess('grades.view_course'), request);
    expect(err).toBeUndefined();
  });

  it('blocks actor with no matching role (default case)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourseRow()] });
    const request = req({
      params: { courseId: 'c' },
      user: user({ roles: ['guest'], permissions: [] }),
    });

    const err = await runChain(requireCourseAccess(), request);
    expect(err).toMatchObject({ status: 403 });
  });

  it('blocks when requiredPermission is missing from user permissions', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildCourseRow({ instructor_id: 'actor-id' })] });
    const request = req({
      params: { courseId: 'c' },
      user: user({ id: 'actor-id', roles: ['instructor'], permissions: [] }),
    });

    const err = await runChain(requireCourseAccess('grades.override'), request);
    expect(err).toMatchObject({ status: 403 });
  });

  it('passes with no permission argument for enrolled student', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [buildCourseRow()] })  // loadCourse
      .mockResolvedValueOnce({ rows: [{ '1': '1' }] });     // enrollment check

    const request = req({
      params: { courseId: 'course-id' },
      user: user({ id: 'student-id', roles: ['student'], permissions: [] }),
    });

    const err = await runChain(requireCourseAccess(), request);
    expect(err).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. requireDepartmentScope
// ─────────────────────────────────────────────────────────────────────────────

describe('requireDepartmentScope()', () => {
  it('super_admin always passes', async () => {
    const request = req({ params: { id: DEPT_A }, user: user({ roles: ['super_admin'] }) });
    const err = await callAsync(requireDepartmentScope, request);
    expect(err).toBeUndefined();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('institution_admin can access dept in own institution', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ '1': '1' }] });
    const request = req({ params: { id: DEPT_A }, user: user({ roles: ['institution_admin'] }) });

    const err = await callAsync(requireDepartmentScope, request);
    expect(err).toBeUndefined();
  });

  it('institution_admin gets 404 for dept in different institution', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const request = req({ params: { id: DEPT_A }, user: user({ roles: ['institution_admin'] }) });

    const err = await callAsync(requireDepartmentScope, request);
    expect(err).toMatchObject({ status: 404 });
  });

  it('dept_manager can access own department', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ '1': '1' }] });
    const request = req({ params: { id: DEPT_A }, user: user({ id: 'dm-id', roles: ['dept_manager'] }) });

    const err = await callAsync(requireDepartmentScope, request);
    expect(err).toBeUndefined();
  });

  it('dept_manager gets 403 for unassigned department', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const request = req({ params: { id: DEPT_A }, user: user({ id: 'dm-id', roles: ['dept_manager'] }) });

    const err = await callAsync(requireDepartmentScope, request);
    expect(err).toMatchObject({ status: 403 });
  });

  it('other roles get 403', async () => {
    const request = req({ params: { id: DEPT_A }, user: user({ roles: ['instructor'] }) });
    const err = await callAsync(requireDepartmentScope, request);
    expect(err).toMatchObject({ status: 403 });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('reads deptId param as fallback', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ '1': '1' }] });
    const request = req({ params: { deptId: DEPT_A }, user: user({ roles: ['institution_admin'] }) });

    const err = await callAsync(requireDepartmentScope, request);
    expect(err).toBeUndefined();
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [DEPT_A, INST_A]);
  });
});
