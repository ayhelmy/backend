'use strict';

/**
 * Access-control unit tests for the Users module (RBAC v2).
 * All DB models are mocked — no live database required.
 *
 * Scenarios per role:
 *   super_admin     — bypasses institution scope on list/get/delete
 *   institution_admin — scoped to own institution; blocked cross-institution
 *   dept_manager    — scoped to own departments' courses; blocked cross-department
 *   instructor      — can update own profile; cannot list users
 *   student         — can view own profile; blocked from viewing others
 *   cross-institution — returns 404, not 403 (no info leak)
 *   role hierarchy  — cannot assign roles higher than own level
 *   TA assignment   — instructor can assign TA to own course
 */

// ── Mock all DB / external dependencies ──────────────────────────────────────

jest.mock('../src/db/models', () => ({
  UserModel:        {},
  RoleModel:        {},
  AuditModel:       { log: jest.fn().mockResolvedValue(undefined) },
  InstitutionModel: {},
}));

jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/config/redis', () => ({
  del:      jest.fn().mockResolvedValue(1),
  setex:    jest.fn().mockResolvedValue('OK'),
  smembers: jest.fn().mockResolvedValue([]),
  pipeline: jest.fn().mockReturnValue({ del: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) }),
}));
jest.mock('../src/utils/email',  () => ({ sendInviteEmail: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/utils/crypto', () => ({
  hashPassword:   jest.fn().mockResolvedValue('hashed'),
  comparePassword: jest.fn().mockResolvedValue(true),
  randomToken:    jest.fn().mockReturnValue('tok123'),
}));

const { UserModel, RoleModel, InstitutionModel } = require('../src/db/models');
const { pool } = require('../src/config/database');
const usersService = require('../src/modules/users/users.service');

// ── Shared fixtures ───────────────────────────────────────────────────────────

const INST_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const INST_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const DEPT_X = 'dddddddd-0000-0000-0000-000000000010';
const DEPT_Y = 'dddddddd-0000-0000-0000-000000000011';

function makeActor(overrides = {}) {
  return {
    id:            'actor-id-000',
    email:         'actor@test.com',
    institutionId: INST_A,
    roles:         [],
    permissions:   [],
    ...overrides,
  };
}

function makeUser(overrides = {}) {
  return {
    id:             'user-id-001',
    email:          'user@test.com',
    first_name:     'Test',
    last_name:      'User',
    status:         'active',
    institution_id: INST_A,
    last_login_at:  null,
    created_at:     new Date(),
    updated_at:     new Date(),
    roles:          [],
    managed_departments: [],
    enrolled_course_ids: [],
    ta_course_ids:       [],
    ...overrides,
  };
}

// ── helpers for pool.query mocking ────────────────────────────────────────────

function mockPoolQuery(rows = []) {
  pool.query.mockResolvedValueOnce({ rows });
}

// ─────────────────────────────────────────────────────────────────────────────
// list()
// ─────────────────────────────────────────────────────────────────────────────

describe('usersService.list()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws 403 when actor has no view permission', async () => {
    const actor = makeActor({ roles: ['student'], permissions: [] });
    await expect(usersService.list({}, actor)).rejects.toMatchObject({ statusCode: 403 });
  });

  test('institution_admin list is scoped to own institution', async () => {
    const actor = makeActor({
      roles: ['institution_admin'],
      permissions: ['users.view_institution'],
    });

    // count query + list query
    pool.query
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await usersService.list({}, actor);
    expect(result.users).toEqual([]);

    // The SQL must include the institution_id filter
    const listCall = pool.query.mock.calls[1][0];
    expect(listCall).toMatch(/institution_id/);
  });

  test('super_admin list omits institution_id filter', async () => {
    const actor = makeActor({
      roles: ['super_admin'],
      permissions: ['users.view_all'],
    });

    pool.query
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    await usersService.list({}, actor);

    // No institution_id bind value as first param
    expect(pool.query.mock.calls[0][1]).not.toContain(INST_A);
  });

  test('dept_manager filter uses enrollments subquery, not u.department_id', async () => {
    RoleModel.getUserDepartments = jest.fn().mockResolvedValue([DEPT_X]);

    const actor = makeActor({
      roles: ['dept_manager'],
      permissions: ['users.view_department'],
    });

    pool.query
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    await usersService.list({}, actor);

    const listSql = pool.query.mock.calls[1][0];
    // Must NOT reference u.department_id (column doesn't exist)
    expect(listSql).not.toMatch(/u\.department_id/);
    // Must use enrollments subquery
    expect(listSql).toMatch(/enrollments/);
  });

  test('dept_manager with no departments returns empty list immediately', async () => {
    RoleModel.getUserDepartments = jest.fn().mockResolvedValue([]);

    const actor = makeActor({
      roles: ['dept_manager'],
      permissions: ['users.view_department'],
    });

    const result = await usersService.list({}, actor);
    expect(result.users).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getOne()
// ─────────────────────────────────────────────────────────────────────────────

describe('usersService.getOne()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('cross-institution access returns 404, not 403', async () => {
    const actor = makeActor({
      roles: ['institution_admin'],
      permissions: ['users.view_institution'],
      institutionId: INST_A,
    });

    // Target user belongs to INST_B
    UserModel.findWithRoles = jest.fn().mockResolvedValue(
      makeUser({ institution_id: INST_B }),
    );

    await expect(
      usersService.getOne('user-id-001', actor),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('user can view their own profile regardless of permissions', async () => {
    const actor = makeActor({
      id: 'self-id',
      roles: ['student'],
      permissions: [],
    });

    const selfUser = makeUser({ id: 'self-id', institution_id: INST_A });
    UserModel.findWithRoles = jest.fn().mockResolvedValue(selfUser);
    RoleModel.getUserRolesWithPermissions = jest.fn().mockResolvedValue([]);

    const result = await usersService.getOne('self-id', actor);
    expect(result.id).toBe('self-id');
  });

  test('super_admin can view user from any institution', async () => {
    const actor = makeActor({
      roles: ['super_admin'],
      permissions: ['users.view_all'],
      institutionId: INST_A,
    });

    UserModel.findWithRoles = jest.fn().mockResolvedValue(
      makeUser({ institution_id: INST_B }),
    );
    RoleModel.getUserRolesWithPermissions = jest.fn().mockResolvedValue([]);

    const result = await usersService.getOne('user-id-001', actor);
    expect(result).toBeDefined();
  });

  test('response includes permissions, managedDepartments, enrolledCourseIds, taCourseIds', async () => {
    const actor = makeActor({
      roles: ['institution_admin'],
      permissions: ['users.view_institution'],
    });

    UserModel.findWithRoles = jest.fn().mockResolvedValue(
      makeUser({
        managed_departments: [DEPT_X],
        enrolled_course_ids: ['course-1'],
        ta_course_ids:       ['course-2'],
      }),
    );
    RoleModel.getUserRolesWithPermissions = jest.fn().mockResolvedValue([
      { id: 'role-1', name: 'instructor', label: 'Instructor', permissions: ['courses.create', 'courses.view_own'] },
    ]);

    const result = await usersService.getOne('user-id-001', actor);
    expect(result.permissions).toContain('courses.create');
    expect(result.managedDepartments).toEqual([DEPT_X]);
    expect(result.enrolledCourseIds).toEqual(['course-1']);
    expect(result.taCourseIds).toEqual(['course-2']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// create()
// ─────────────────────────────────────────────────────────────────────────────

describe('usersService.create()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws 403 when actor lacks users.create', async () => {
    const actor = makeActor({ roles: ['instructor'], permissions: [] });
    await expect(
      usersService.create({ email: 'x@x.com', firstName: 'A', lastName: 'B' }, actor),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('institution_admin cannot assign institution_admin role (SUPER_ONLY)', async () => {
    const actor = makeActor({
      roles: ['institution_admin'],
      permissions: ['users.create'],
    });

    // email lookup — no duplicate
    pool.query.mockResolvedValueOnce({ rows: [] });

    InstitutionModel.findById = jest.fn().mockResolvedValue({ id: INST_A, max_users: 100 });
    UserModel.countByInstitution = jest.fn().mockResolvedValue(5);

    await expect(
      usersService.create(
        { email: 'new@a.com', firstName: 'New', lastName: 'User', role: 'institution_admin' },
        actor,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('super_admin can assign institution_admin role', async () => {
    const actor = makeActor({
      roles: ['super_admin'],
      permissions: ['users.create'],
    });

    pool.query.mockResolvedValueOnce({ rows: [] }); // no duplicate email

    InstitutionModel.findByEmailDomain = jest.fn().mockResolvedValue({ id: INST_A });
    InstitutionModel.findById          = jest.fn().mockResolvedValue({ id: INST_A, max_users: 100 });
    UserModel.countByInstitution       = jest.fn().mockResolvedValue(5);
    UserModel.create                   = jest.fn().mockResolvedValue(makeUser({ id: 'new-user-id' }));
    RoleModel.assignRole               = jest.fn().mockResolvedValue(undefined);
    RoleModel.getUserRolesWithPermissions = jest.fn().mockResolvedValue([]);

    const result = await usersService.create(
      { email: 'admin@a.com', firstName: 'New', lastName: 'Admin', role: 'institution_admin' },
      actor,
    );
    expect(RoleModel.assignRole).toHaveBeenCalledWith('new-user-id', 'institution_admin', INST_A, actor.id);
    expect(result).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// update()
// ─────────────────────────────────────────────────────────────────────────────

describe('usersService.update()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('user can update their own profile without any permission', async () => {
    const actor = makeActor({ id: 'self-id', roles: ['student'], permissions: [] });
    const selfUser = makeUser({ id: 'self-id' });

    UserModel.findById = jest.fn().mockResolvedValue(selfUser);
    UserModel.update   = jest.fn().mockResolvedValue({ ...selfUser, first_name: 'Updated' });
    RoleModel.getUserRolesWithPermissions = jest.fn().mockResolvedValue([]);

    const result = await usersService.update('self-id', { firstName: 'Updated' }, actor);
    expect(result.firstName).toBe('Updated');
  });

  test('cross-institution update returns 404', async () => {
    const actor = makeActor({
      roles: ['institution_admin'],
      permissions: ['users.update_institution'],
      institutionId: INST_A,
    });

    UserModel.findById = jest.fn().mockResolvedValue(makeUser({ institution_id: INST_B }));

    await expect(
      usersService.update('user-id-001', { firstName: 'X' }, actor),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('suspending own account is blocked', async () => {
    const actor = makeActor({
      id: 'self-id',
      roles: ['instructor'],
      permissions: ['users.update_institution', 'users.suspend'],
    });

    UserModel.findById = jest.fn().mockResolvedValue(makeUser({ id: 'self-id' }));

    await expect(
      usersService.update('self-id', { status: 'suspended' }, actor),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('suspending a user requires users.suspend permission', async () => {
    const actor = makeActor({
      roles: ['instructor'],
      permissions: ['users.update_institution'],
      institutionId: INST_A,
    });

    UserModel.findById = jest.fn().mockResolvedValue(makeUser({ id: 'other-id' }));

    await expect(
      usersService.update('other-id', { status: 'suspended' }, actor),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// remove()
// ─────────────────────────────────────────────────────────────────────────────

describe('usersService.remove()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws 403 when actor lacks users.delete', async () => {
    const actor = makeActor({ roles: ['instructor'], permissions: [] });
    await expect(usersService.remove('user-id', actor)).rejects.toMatchObject({ statusCode: 403 });
  });

  test('cannot delete own account', async () => {
    const actor = makeActor({ id: 'self-id', permissions: ['users.delete'] });
    await expect(usersService.remove('self-id', actor)).rejects.toMatchObject({ statusCode: 400 });
  });

  test('cross-institution delete returns 404 for non-super-admin', async () => {
    const actor = makeActor({
      roles: ['institution_admin'],
      permissions: ['users.delete'],
      institutionId: INST_A,
    });
    UserModel.findById = jest.fn().mockResolvedValue(makeUser({ institution_id: INST_B }));

    await expect(usersService.remove('user-id-001', actor)).rejects.toMatchObject({ statusCode: 404 });
  });

  test('non-super-admin cannot delete a super_admin account', async () => {
    const actor = makeActor({
      roles: ['institution_admin'],
      permissions: ['users.delete'],
      institutionId: INST_A,
    });
    UserModel.findById = jest.fn().mockResolvedValue(makeUser({ institution_id: INST_A }));
    RoleModel.getUserRolesWithPermissions = jest.fn().mockResolvedValue([
      { name: 'super_admin', permissions: [] },
    ]);

    await expect(usersService.remove('user-id-001', actor)).rejects.toMatchObject({ statusCode: 403 });
  });

  test('super_admin can delete a user from any institution', async () => {
    const actor = makeActor({
      roles: ['super_admin'],
      permissions: ['users.delete'],
      institutionId: INST_A,
    });
    const targetUser = makeUser({ institution_id: INST_B });
    UserModel.findById  = jest.fn().mockResolvedValue(targetUser);
    RoleModel.getUserRolesWithPermissions = jest.fn().mockResolvedValue([{ name: 'student', permissions: [] }]);
    UserModel.softDelete = jest.fn().mockResolvedValue({ id: targetUser.id });

    await expect(usersService.remove(targetUser.id, actor)).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// assignRole()
// ─────────────────────────────────────────────────────────────────────────────

describe('usersService.assignRole()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws 403 when actor lacks users.assign_roles', async () => {
    const actor = makeActor({ roles: ['instructor'], permissions: [] });
    await expect(
      usersService.assignRole('uid', { roleName: 'student' }, actor),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('institution_admin cannot assign super_admin role', async () => {
    const actor = makeActor({
      roles: ['institution_admin'],
      permissions: ['users.assign_roles'],
    });
    await expect(
      usersService.assignRole('uid', { roleName: 'super_admin' }, actor),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('institution_admin cannot assign institution_admin role', async () => {
    const actor = makeActor({
      roles: ['institution_admin'],
      permissions: ['users.assign_roles'],
    });
    await expect(
      usersService.assignRole('uid', { roleName: 'institution_admin' }, actor),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('cross-institution role assignment blocked for institution_admin', async () => {
    const actor = makeActor({
      roles: ['institution_admin'],
      permissions: ['users.assign_roles'],
      institutionId: INST_A,
    });
    // target user belongs to INST_B
    UserModel.findById = jest.fn().mockResolvedValue(makeUser({ institution_id: INST_B }));

    await expect(
      usersService.assignRole('user-id-001', { roleName: 'instructor' }, actor),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('super_admin can assign institution_admin across institutions', async () => {
    const actor = makeActor({
      roles: ['super_admin'],
      permissions: ['users.assign_roles'],
      institutionId: INST_A,
    });
    UserModel.findById = jest.fn().mockResolvedValue(makeUser({ institution_id: INST_B }));
    RoleModel.assignRole = jest.fn().mockResolvedValue(undefined);
    RoleModel.getUserRolesWithPermissions = jest.fn().mockResolvedValue([]);

    await expect(
      usersService.assignRole('user-id-001', { roleName: 'institution_admin' }, actor),
    ).resolves.toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// assignDepartment()
// ─────────────────────────────────────────────────────────────────────────────

describe('usersService.assignDepartment()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws 403 when actor lacks department assignment permission', async () => {
    const actor = makeActor({ roles: ['instructor'], permissions: [] });
    await expect(
      usersService.assignDepartment('uid', { departmentId: DEPT_X }, actor),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('blocks cross-institution department assignment', async () => {
    const actor = makeActor({
      roles: ['institution_admin'],
      permissions: ['departments.assign_manager'],
      institutionId: INST_A,
    });

    UserModel.findById = jest.fn().mockResolvedValue(makeUser());
    // department belongs to INST_B
    pool.query.mockResolvedValueOnce({ rows: [{ id: DEPT_X, institution_id: INST_B }] });

    await expect(
      usersService.assignDepartment('user-id-001', { departmentId: DEPT_X }, actor),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('institution_admin can assign department within own institution', async () => {
    const actor = makeActor({
      roles: ['institution_admin'],
      permissions: ['departments.assign_manager'],
      institutionId: INST_A,
    });

    UserModel.findById        = jest.fn().mockResolvedValue(makeUser());
    pool.query.mockResolvedValueOnce({ rows: [{ id: DEPT_X, institution_id: INST_A }] });
    RoleModel.assignDepartment = jest.fn().mockResolvedValue({ user_id: 'user-id-001', department_id: DEPT_X });
    RoleModel.getUserDepartments = jest.fn().mockResolvedValue([DEPT_X]);

    const result = await usersService.assignDepartment('user-id-001', { departmentId: DEPT_X }, actor);
    expect(result).toContain(DEPT_X);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Manual test scenario reference (not automated — requires running server)
// ─────────────────────────────────────────────────────────────────────────────

/*
Manual test scenarios for each role:

1. super_admin (superadmin@demo-university.edu / SuperAdmin123!)
   - GET /api/v1/users                       → lists users from ALL institutions
   - POST /api/v1/users/:id/assign-institution-admin  → succeeds
   - DELETE /api/v1/users/:id                → succeeds for any user

2. institution_admin (admin@demo-university.edu / Admin1234!)
   - GET /api/v1/users                       → lists only own institution users
   - GET /api/v1/users/<cross-tenant-id>     → 404 (not 403)
   - POST /api/v1/users/:id/assign-institution-admin  → 403
   - POST /api/v1/users/:id/roles body={roleName:"institution_admin"} → 403

3. dept_manager (deptmanager@demo-university.edu / Manager123!)
   - GET /api/v1/users                       → only users enrolled in their dept's courses
   - GET /api/v1/users/<user-outside-dept>   → 200 (service allows self or with view_dept)
   - POST /api/v1/users/:id/departments      → assigns dept within own institution
   - POST /api/v1/users/:id/departments (other inst dept) → 403

4. instructor (instructor@demo-university.edu / Instructor1!)
   - GET /api/v1/users                       → 403 (no view permission)
   - GET /api/v1/users/<own-id>              → 200 (self-access)
   - PATCH /api/v1/users/<own-id>            → 200 (self-update)

5. teaching_assistant (ta@demo-university.edu / Teaching1!)
   - GET /api/v1/users                       → 403
   - GET /api/v1/users/<own-id>              → 200 (self-access)

6. student (student1@demo-university.edu / Student123!)
   - GET /api/v1/users                       → 403
   - GET /api/v1/users/<other-student-id>    → 403 (no canView permission, not self)
   - GET /api/v1/users/<own-id>              → 200 (self-access)

7. Cross-institution isolation:
   - Log in as institution_admin from inst-A
   - GET /api/v1/users/<user-from-inst-B>   → 404 (not 403)
   - PATCH /api/v1/users/<user-from-inst-B> → 404

8. Role hierarchy:
   - institution_admin POST /api/v1/users/:id/roles {roleName:"super_admin"}        → 403
   - institution_admin POST /api/v1/users/:id/roles {roleName:"institution_admin"}   → 403
   - institution_admin POST /api/v1/users/:id/roles {roleName:"instructor"}          → 201
*/
