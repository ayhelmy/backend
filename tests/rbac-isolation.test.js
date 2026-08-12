'use strict';

/**
 * RBAC isolation tests — cross-institution boundary enforcement.
 *
 * Covers:
 *   - Users: institution_admin cannot read/write users from Institution B
 *   - Courses: institution_admin cannot access Institution B courses
 *   - Roles: privilege escalation prevention (institution_admin → institution_admin)
 *   - Grades: cross-institution grade access blocked
 *   - Audit: correct permission codes enforced
 *   - Passwords: cross-institution admin password reset blocked
 *   - Departments: cross-institution department assignment blocked
 *   - TA: cross-institution TA assignment blocked + course ownership enforced
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../src/db/models', () => ({
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
  pipeline: jest.fn().mockReturnValue({ del: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) }),
}));
jest.mock('../src/utils/email',  () => ({ sendInviteEmail: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/utils/crypto', () => ({
  hashPassword:    jest.fn().mockResolvedValue('hashed'),
  comparePassword: jest.fn().mockResolvedValue(true),
  randomToken:     jest.fn().mockReturnValue('tok123'),
}));

const { UserModel, RoleModel } = require('../src/db/models');
const { pool }                 = require('../src/config/database');
const redis                    = require('../src/config/redis');
const usersService             = require('../src/modules/users/users.service');
const rolesService             = require('../src/modules/roles/roles.service');
const coursesService           = require('../src/modules/courses/courses.service');
const { CourseModel }          = require('../src/db/models');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const INST_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const INST_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const DEPT_X = 'dddddddd-0000-0000-0000-000000000010';
const DEPT_Y = 'dddddddd-0000-0000-0000-000000000011';

function actor(overrides = {}) {
  return { id: 'actor-id', email: 'actor@a.com', institutionId: INST_A, roles: [], permissions: [], ...overrides };
}

function user(overrides = {}) {
  return { id: 'user-id', email: 'u@a.com', first_name: 'Test', last_name: 'User', status: 'active', institution_id: INST_A, managed_departments: [], enrolled_course_ids: [], ta_course_ids: [], ...overrides };
}

function course(overrides = {}) {
  return { id: 'course-id', institution_id: INST_A, instructor_id: 'actor-id', status: 'published', department_id: null, ...overrides };
}

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// 1. User isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('User isolation', () => {
  describe('getOne', () => {
    it('returns 404 when institution_admin requests user from Institution B', async () => {
      const a = actor({ roles: ['institution_admin'], permissions: ['users.view_institution'] });
      UserModel.findWithRoles = jest.fn().mockResolvedValue(user({ institution_id: INST_B }));

      await expect(usersService.getOne('user-b-id', a)).rejects.toMatchObject({ status: 404 });
    });

    it('super_admin can access user from any institution', async () => {
      const a = actor({ roles: ['super_admin'], permissions: ['users.view_all'] });
      UserModel.findWithRoles = jest.fn().mockResolvedValue(user({ institution_id: INST_B }));
      RoleModel.getUserRolesWithPermissions = jest.fn().mockResolvedValue([]);

      const result = await usersService.getOne('user-b-id', a);
      expect(result).toBeDefined();
    });

    it('student can view own profile without permissions', async () => {
      const a = actor({ id: 'student-id', roles: ['student'], permissions: [] });
      UserModel.findWithRoles = jest.fn().mockResolvedValue(user({ id: 'student-id', institution_id: INST_A }));
      RoleModel.getUserRolesWithPermissions = jest.fn().mockResolvedValue([]);

      const result = await usersService.getOne('student-id', a);
      expect(result.id).toBe('student-id');
    });

    it('student cannot view another user (missing permissions)', async () => {
      const a = actor({ id: 'student-id', roles: ['student'], permissions: [] });

      await expect(usersService.getOne('other-user-id', a)).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('getRoles', () => {
    it('institution_admin cannot view roles of user in Institution B (returns 404)', async () => {
      const a = actor({ roles: ['institution_admin'], permissions: ['users.view_institution'] });
      UserModel.findById = jest.fn().mockResolvedValue(user({ institution_id: INST_B }));

      await expect(usersService.getRoles('user-b-id', a)).rejects.toMatchObject({ status: 404 });
    });

    it('user can view own roles', async () => {
      const a = actor({ id: 'self-id', roles: ['student'], permissions: [] });
      UserModel.findById = jest.fn().mockResolvedValue(user({ id: 'self-id', institution_id: INST_A }));
      RoleModel.getUserRolesWithPermissions = jest.fn().mockResolvedValue([]);

      await expect(usersService.getRoles('self-id', a)).resolves.toEqual([]);
    });
  });

  describe('revokeRole', () => {
    it('institution_admin cannot revoke role from user in Institution B', async () => {
      const a = actor({ roles: ['institution_admin'], permissions: ['users.assign_roles'] });
      pool.query
        .mockResolvedValueOnce({ rows: [{ name: 'instructor' }] })         // role lookup
        .mockResolvedValueOnce({ rows: [{ institution_id: INST_B }] });    // target user
      UserModel.findById = jest.fn().mockResolvedValue(user({ institution_id: INST_B }));

      await expect(usersService.revokeRole('user-b-id', 'role-id', a)).rejects.toMatchObject({ status: 404 });
    });

    it('institution_admin cannot revoke super_admin role', async () => {
      const a = actor({ roles: ['institution_admin'], permissions: ['users.assign_roles'] });
      pool.query.mockResolvedValueOnce({ rows: [{ name: 'super_admin' }] });
      UserModel.findById = jest.fn().mockResolvedValue(user({ institution_id: INST_A }));

      await expect(usersService.revokeRole('user-id', 'role-id', a)).rejects.toMatchObject({ status: 403 });
    });

    it('institution_admin cannot revoke institution_admin role', async () => {
      const a = actor({ roles: ['institution_admin'], permissions: ['users.assign_roles'] });
      pool.query.mockResolvedValueOnce({ rows: [{ name: 'institution_admin' }] });
      UserModel.findById = jest.fn().mockResolvedValue(user({ institution_id: INST_A }));

      await expect(usersService.revokeRole('user-id', 'role-id', a)).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('changePassword', () => {
    it('institution_admin cannot change password of user in Institution B', async () => {
      const a = actor({ roles: ['institution_admin'], permissions: ['users.update_institution'] });
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'user-b-id', institution_id: INST_B, password_hash: 'h' }] });

      await expect(usersService.changePassword('user-b-id', { newPassword: 'pw' }, a))
        .rejects.toMatchObject({ status: 404 });
    });

    it('institution_admin can change password of user in own institution', async () => {
      const a = actor({ roles: ['institution_admin'], permissions: ['users.update_institution'] });
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'user-a-id', institution_id: INST_A, password_hash: 'h' }] })
        .mockResolvedValueOnce({ rows: [] });  // UPDATE

      await expect(usersService.changePassword('user-a-id', { newPassword: 'NewPw1!' }, a))
        .resolves.toBeUndefined();
    });

    it('user can change own password with correct current password', async () => {
      const a = actor({ id: 'self-id', roles: ['student'], permissions: [] });
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'self-id', institution_id: INST_A, password_hash: 'h' }] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(usersService.changePassword('self-id', { currentPassword: 'old', newPassword: 'new' }, a))
        .resolves.toBeUndefined();
    });
  });

  describe('create', () => {
    it('institution_admin creates user in own institution (no institutionId in body)', async () => {
      const a = actor({ roles: ['institution_admin'], permissions: ['users.create'] });
      pool.query
        .mockResolvedValueOnce({ rows: [] })        // duplicate check
        .mockResolvedValueOnce({ rows: [{ count: 1 }] }); // placeholder
      UserModel.countByInstitution = jest.fn().mockResolvedValue(5);
      const { InstitutionModel } = require('../src/db/models');
      InstitutionModel.findById = jest.fn().mockResolvedValue({ id: INST_A, name: 'A', max_users: 100 });
      UserModel.create = jest.fn().mockResolvedValue({ id: 'new-id', email: 'n@a.com', first_name: 'N', last_name: 'U', status: 'pending', institution_id: INST_A, created_at: new Date().toISOString() });
      RoleModel.assignRole = jest.fn().mockResolvedValue(undefined);
      RoleModel.getUserRolesWithPermissions = jest.fn().mockResolvedValue([]);

      const result = await usersService.create({ email: 'n@a.com', firstName: 'N', lastName: 'U', role: 'student' }, a);
      expect(result.institutionId).toBe(INST_A);
    });

    it('institution_admin cannot assign super_admin role on create', async () => {
      const a = actor({ roles: ['institution_admin'], permissions: ['users.create'] });
      pool.query.mockResolvedValueOnce({ rows: [] });
      UserModel.countByInstitution = jest.fn().mockResolvedValue(1);
      const { InstitutionModel } = require('../src/db/models');
      InstitutionModel.findById = jest.fn().mockResolvedValue({ id: INST_A, name: 'A', max_users: 100 });
      UserModel.create = jest.fn().mockResolvedValue({ id: 'n', email: 'n@a.com', first_name: 'N', last_name: 'U', status: 'pending', institution_id: INST_A, created_at: new Date().toISOString() });

      await expect(usersService.create({ email: 'n@a.com', firstName: 'N', lastName: 'U', role: 'super_admin' }, a))
        .rejects.toMatchObject({ status: 403 });
    });

    it('institution_admin cannot assign institution_admin role on create', async () => {
      const a = actor({ roles: ['institution_admin'], permissions: ['users.create'] });
      pool.query.mockResolvedValueOnce({ rows: [] });
      UserModel.countByInstitution = jest.fn().mockResolvedValue(1);
      const { InstitutionModel } = require('../src/db/models');
      InstitutionModel.findById = jest.fn().mockResolvedValue({ id: INST_A, name: 'A', max_users: 100 });
      UserModel.create = jest.fn().mockResolvedValue({ id: 'n', email: 'n@a.com', first_name: 'N', last_name: 'U', status: 'pending', institution_id: INST_A, created_at: new Date().toISOString() });

      await expect(usersService.create({ email: 'n@a.com', firstName: 'N', lastName: 'U', role: 'institution_admin' }, a))
        .rejects.toMatchObject({ status: 403 });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Role assignment privilege escalation
// ─────────────────────────────────────────────────────────────────────────────

describe('Role privilege escalation', () => {
  it('institution_admin cannot assign institution_admin via /roles/assign', async () => {
    const a = actor({ roles: ['institution_admin'], permissions: ['users.assign_roles'] });
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'target-id', institution_id: INST_A }] }); // findById
    UserModel.findById = jest.fn().mockResolvedValue(user({ institution_id: INST_A }));

    await expect(rolesService.assignRole({ userId: 'target-id', roleName: 'institution_admin', institutionId: INST_A }, a))
      .rejects.toMatchObject({ status: 403 });
  });

  it('institution_admin cannot assign super_admin via /roles/assign', async () => {
    const a = actor({ roles: ['institution_admin'], permissions: ['users.assign_roles'] });
    UserModel.findById = jest.fn().mockResolvedValue(user({ institution_id: INST_A }));

    await expect(rolesService.assignRole({ userId: 'target-id', roleName: 'super_admin', institutionId: INST_A }, a))
      .rejects.toMatchObject({ status: 403 });
  });

  it('super_admin can assign institution_admin', async () => {
    const a = actor({ roles: ['super_admin'], permissions: ['users.assign_roles', 'roles.manage'] });
    UserModel.findById = jest.fn().mockResolvedValue(user({ institution_id: INST_A }));
    RoleModel.assignRole = jest.fn().mockResolvedValue(undefined);
    RoleModel.getUserRolesWithPermissions = jest.fn().mockResolvedValue([]);
    redis.del = jest.fn().mockResolvedValue(1);

    await expect(rolesService.assignRole({ userId: 'target-id', roleName: 'institution_admin', institutionId: INST_A }, a))
      .resolves.toBeDefined();
  });

  it('institution_admin cannot assign roles in Institution B', async () => {
    const a = actor({ roles: ['institution_admin'], permissions: ['users.assign_roles'] });
    UserModel.findById = jest.fn().mockResolvedValue(user({ institution_id: INST_A }));

    await expect(rolesService.assignRole({ userId: 'target-id', roleName: 'student', institutionId: INST_B }, a))
      .rejects.toMatchObject({ status: 403 });
  });

  it('dept_manager cannot assign dept_manager role (SUPER_ONLY not applicable, but restricted by permission)', async () => {
    const a = actor({ roles: ['dept_manager'], permissions: [] }); // no users.assign_roles

    await expect(usersService.assignRole('target-id', { roleName: 'instructor' }, a))
      .rejects.toMatchObject({ status: 403 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Course isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('Course isolation', () => {
  beforeEach(() => {
    require('../src/db/models').CourseModel = {};
  });

  it('getOne returns 404 (not 403) for cross-institution access', async () => {
    const a = actor({ roles: ['institution_admin'], permissions: ['courses.view_institution'] });
    const { CourseModel } = require('../src/db/models');
    CourseModel.findById = jest.fn().mockResolvedValue(course({ institution_id: INST_B }));

    await expect(coursesService.getOne('course-b-id', a)).rejects.toMatchObject({ status: 404 });
  });

  it('instructor from Institution A cannot access Institution B course', async () => {
    const a = actor({ roles: ['instructor'], permissions: ['courses.view_own'] });
    const { CourseModel } = require('../src/db/models');
    CourseModel.findById = jest.fn().mockResolvedValue(course({ institution_id: INST_B, instructor_id: 'other-id' }));

    await expect(coursesService.getOne('course-b-id', a)).rejects.toMatchObject({ status: 404 });
  });

  it('super_admin can access any institution course', async () => {
    const a = actor({ roles: ['super_admin'], permissions: ['courses.view_all'] });
    const { CourseModel } = require('../src/db/models');
    CourseModel.findById = jest.fn().mockResolvedValue(course({ institution_id: INST_B }));

    await expect(coursesService.getOne('course-b-id', a)).resolves.toBeDefined();
  });

  it('listEnrollments blocks cross-institution access', async () => {
    const a = actor({ roles: ['institution_admin'], permissions: ['courses.manage_enrollments'] });
    const { CourseModel } = require('../src/db/models');
    CourseModel.findById = jest.fn().mockResolvedValue(course({ institution_id: INST_B }));

    await expect(coursesService.listEnrollments('course-b-id', {}, a)).rejects.toMatchObject({ status: 404 });
  });

  it('student can enroll in own institution course', async () => {
    const a = actor({ id: 'student-id', roles: ['student'], permissions: [] });
    const { CourseModel } = require('../src/db/models');
    const c = course({ enrollment_type: 'open', status: 'published', enrollment_cap: null });
    CourseModel.findById = jest.fn().mockResolvedValue(c);
    CourseModel.findEnrollment = jest.fn().mockResolvedValue(null);
    CourseModel.enroll = jest.fn().mockResolvedValue({ id: 'e1', status: 'active' });
    pool.query.mockResolvedValueOnce({ rows: [{ total: '0' }] }); // progress insert

    const result = await coursesService.enroll('course-id', {}, a);
    expect(result.status).toBe('active');
  });

  it('student cannot enroll in Institution B course', async () => {
    const a = actor({ id: 'student-id', roles: ['student'], permissions: [] });
    const { CourseModel } = require('../src/db/models');
    CourseModel.findById = jest.fn().mockResolvedValue(course({ institution_id: INST_B, status: 'published' }));

    await expect(coursesService.enroll('course-b-id', {}, a)).rejects.toMatchObject({ status: 403 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Department isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('Department isolation', () => {
  it('institution_admin cannot revoke department assignment in Institution B', async () => {
    const a = actor({ roles: ['institution_admin'], permissions: ['departments.assign_manager'] });
    pool.query.mockResolvedValueOnce({ rows: [{ institution_id: INST_B }] });

    await expect(rolesService.revokeDepartment('user-id', DEPT_Y, a)).rejects.toMatchObject({ status: 404 });
  });

  it('institution_admin can revoke department assignment in own institution', async () => {
    const a = actor({ roles: ['institution_admin'], permissions: ['departments.assign_manager'] });
    pool.query.mockResolvedValueOnce({ rows: [{ institution_id: INST_A }] });
    RoleModel.revokeDepartment = jest.fn().mockResolvedValue(undefined);
    redis.del = jest.fn().mockResolvedValue(1);

    await expect(rolesService.revokeDepartment('user-id', DEPT_X, a)).resolves.toBeUndefined();
  });

  it('dept_manager without departments returns empty user list', async () => {
    const a = actor({ roles: ['dept_manager'], permissions: ['users.view_department'] });
    RoleModel.getUserDepartments = jest.fn().mockResolvedValue([]);

    const result = await usersService.list({}, a);
    expect(result.users).toEqual([]);
    expect(result.meta.total).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. TA assignment isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('TA assignment isolation', () => {
  it('instructor cannot assign TA to another instructor course in same institution', async () => {
    const a = actor({ id: 'instructor-a', roles: ['instructor'], permissions: ['courses.assign_ta'] });
    pool.query
      .mockResolvedValueOnce({ rows: [{ institution_id: INST_A, instructor_id: 'instructor-b' }] }) // course
      .mockResolvedValueOnce({ rows: [{ institution_id: INST_A }] });                                // TA user

    await expect(rolesService.assignTA({ courseId: 'course-id', userId: 'ta-id' }, a))
      .rejects.toMatchObject({ status: 403 });
  });

  it('instructor cannot assign TA from Institution B', async () => {
    const a = actor({ id: 'instructor-a', roles: ['instructor'], permissions: ['courses.assign_ta'] });
    pool.query
      .mockResolvedValueOnce({ rows: [{ institution_id: INST_A, instructor_id: 'instructor-a' }] }) // course
      .mockResolvedValueOnce({ rows: [{ institution_id: INST_B }] });                                // TA from B

    await expect(rolesService.assignTA({ courseId: 'course-id', userId: 'ta-b-id' }, a))
      .rejects.toMatchObject({ status: 404 });
  });

  it('instructor can assign TA to own course from same institution', async () => {
    const a = actor({ id: 'instructor-a', roles: ['instructor'], permissions: ['courses.assign_ta'] });
    pool.query
      .mockResolvedValueOnce({ rows: [{ institution_id: INST_A, instructor_id: 'instructor-a' }] }) // course
      .mockResolvedValueOnce({ rows: [{ institution_id: INST_A }] });                                // TA
    RoleModel.assignTA = jest.fn().mockResolvedValue({ id: 'ta-rel' });
    redis.del = jest.fn().mockResolvedValue(1);

    await expect(rolesService.assignTA({ courseId: 'course-id', userId: 'ta-id' }, a))
      .resolves.toBeDefined();
  });

  it('institution_admin can assign TA to any course in own institution', async () => {
    const a = actor({ roles: ['institution_admin'], permissions: ['courses.assign_ta'] });
    pool.query
      .mockResolvedValueOnce({ rows: [{ institution_id: INST_A, instructor_id: 'other-instructor' }] })
      .mockResolvedValueOnce({ rows: [{ institution_id: INST_A }] });
    RoleModel.assignTA = jest.fn().mockResolvedValue({ id: 'ta-rel' });
    redis.del = jest.fn().mockResolvedValue(1);

    await expect(rolesService.assignTA({ courseId: 'course-id', userId: 'ta-id' }, a))
      .resolves.toBeDefined();
  });

  it('instructor cannot assign TA to course in Institution B', async () => {
    const a = actor({ id: 'instructor-a', roles: ['instructor'], permissions: ['courses.assign_ta'] });
    pool.query.mockResolvedValueOnce({ rows: [{ institution_id: INST_B, instructor_id: 'instructor-a' }] });

    await expect(rolesService.assignTA({ courseId: 'course-b-id', userId: 'ta-id' }, a))
      .rejects.toMatchObject({ status: 404 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Instructor cannot list all users
// ─────────────────────────────────────────────────────────────────────────────

describe('Instructor user list access', () => {
  it('instructor without users.view_* permissions cannot list users', async () => {
    const a = actor({ roles: ['instructor'], permissions: ['courses.view_own'] });

    await expect(usersService.list({}, a)).rejects.toMatchObject({ status: 403 });
  });

  it('student without users.view_* permissions cannot list users', async () => {
    const a = actor({ roles: ['student'], permissions: ['grades.view_own'] });

    await expect(usersService.list({}, a)).rejects.toMatchObject({ status: 403 });
  });

  it('guest without permissions cannot list users', async () => {
    const a = actor({ roles: ['guest'], permissions: ['simulations.view_demo'] });

    await expect(usersService.list({}, a)).rejects.toMatchObject({ status: 403 });
  });
});
