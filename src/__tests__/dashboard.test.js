'use strict';

/**
 * Dashboard module — backend unit tests.
 * Covers: role-rank resolution (highest-role-wins for multi-role users),
 * per-role dispatch (correct service called, guest rejected), and audit-log
 * institution isolation (the data source backing every dashboard's
 * "recent activity" feed).
 * Run: npx jest src/__tests__/dashboard.test.js
 */

jest.mock('../config/database', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [] }) },
}));

const INSTITUTION_A = 'inst-aaaa';
const INSTITUTION_B = 'inst-bbbb';

describe('dashboard-permission.service', () => {
  const { resolveActorRole } = require('../modules/dashboard/dashboard-permission.service');

  test('picks the highest-ranked role when a user holds several', () => {
    expect(resolveActorRole({ roles: ['student', 'instructor'] })).toBe('instructor');
    expect(resolveActorRole({ roles: ['instructor', 'institution_admin'] })).toBe('institution_admin');
    expect(resolveActorRole({ roles: ['super_admin', 'student'] })).toBe('super_admin');
  });

  test('falls back to guest for a user with no roles', () => {
    expect(resolveActorRole({ roles: [] })).toBe('guest');
    expect(resolveActorRole({})).toBe('guest');
  });

  test('accepts role objects ({name}) as well as plain strings', () => {
    expect(resolveActorRole({ roles: [{ name: 'dept_manager' }, { name: 'student' }] })).toBe('dept_manager');
  });
});

describe('dashboard.service dispatch', () => {
  jest.mock('../modules/dashboard/platform-dashboard.service', () => jest.fn().mockResolvedValue({ role: 'super_admin' }));
  jest.mock('../modules/dashboard/institution-dashboard.service', () => jest.fn().mockResolvedValue({ role: 'institution_admin' }));
  jest.mock('../modules/dashboard/department-dashboard.service', () => jest.fn().mockResolvedValue({ role: 'dept_manager' }));
  jest.mock('../modules/dashboard/instructor-dashboard.service', () => jest.fn().mockResolvedValue({ role: 'instructor' }));
  jest.mock('../modules/dashboard/ta-dashboard.service', () => jest.fn().mockResolvedValue({ role: 'teaching_assistant' }));
  jest.mock('../modules/dashboard/student-dashboard.service', () => jest.fn().mockResolvedValue({ role: 'student' }));
  jest.mock('../modules/dashboard/dashboard-permission.service', () => ({
    resolveActorRole: jest.requireActual('../modules/dashboard/dashboard-permission.service').resolveActorRole,
    resolveScope: jest.fn().mockResolvedValue({ institutionId: 'inst-aaaa' }),
  }));

  const svc = require('../modules/dashboard/dashboard.service');
  const getPlatformDashboard = require('../modules/dashboard/platform-dashboard.service');
  const getInstitutionDashboard = require('../modules/dashboard/institution-dashboard.service');
  const getStudentDashboard = require('../modules/dashboard/student-dashboard.service');

  test('super_admin -> platform dashboard', async () => {
    const result = await svc.getMyDashboard({ id: 'u1', institutionId: INSTITUTION_A, roles: ['super_admin'] });
    expect(getPlatformDashboard).toHaveBeenCalled();
    expect(result.role).toBe('super_admin');
  });

  test('institution_admin -> institution dashboard, scoped', async () => {
    const actor = { id: 'u2', institutionId: INSTITUTION_A, roles: ['institution_admin'] };
    await svc.getMyDashboard(actor);
    expect(getInstitutionDashboard).toHaveBeenCalledWith(actor, { institutionId: INSTITUTION_A });
  });

  test('student -> student dashboard', async () => {
    const actor = { id: 'u3', institutionId: INSTITUTION_A, roles: ['student'] };
    await svc.getMyDashboard(actor);
    expect(getStudentDashboard).toHaveBeenCalled();
  });

  test('guest is rejected with 403, never reaches a role service', async () => {
    const actor = { id: 'u4', institutionId: null, roles: ['guest'] };
    await expect(svc.getMyDashboard(actor)).rejects.toMatchObject({ statusCode: 403 });
  });

  test('a user with no roles at all is treated as guest and rejected', async () => {
    await expect(svc.getMyDashboard({ id: 'u5', roles: [] })).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('audit.service institution isolation', () => {
  const AuditModel = { list: jest.fn(), count: jest.fn(), findById: jest.fn() };
  jest.doMock('../db/models/audit.model', () => AuditModel);

  let auditService;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../db/models/audit.model', () => AuditModel);
    auditService = require('../modules/audit/audit.service');
    AuditModel.list.mockReset().mockResolvedValue([]);
    AuditModel.count.mockReset().mockResolvedValue(0);
    AuditModel.findById.mockReset();
  });

  test('non-super-admin list() is forced to their own institution, ignoring any query override', async () => {
    const actor = { institutionId: INSTITUTION_A, roles: ['institution_admin'] };
    await auditService.list({ institutionId: INSTITUTION_B }, actor);
    expect(AuditModel.list).toHaveBeenCalledWith(expect.objectContaining({ institutionId: INSTITUTION_A }));
  });

  test('super_admin list() may filter by any institution', async () => {
    const actor = { institutionId: INSTITUTION_A, roles: ['super_admin'] };
    await auditService.list({ institutionId: INSTITUTION_B }, actor);
    expect(AuditModel.list).toHaveBeenCalledWith(expect.objectContaining({ institutionId: INSTITUTION_B }));
  });

  test('getOne() 404s when the entry belongs to a different institution', async () => {
    AuditModel.findById.mockResolvedValue({ id: 'log-1', institution_id: INSTITUTION_B });
    const actor = { institutionId: INSTITUTION_A, roles: ['institution_admin'] };
    await expect(auditService.getOne('log-1', actor)).rejects.toMatchObject({ statusCode: 404 });
  });

  test('getOne() succeeds when the entry belongs to the actor\'s own institution', async () => {
    AuditModel.findById.mockResolvedValue({ id: 'log-1', institution_id: INSTITUTION_A });
    const actor = { institutionId: INSTITUTION_A, roles: ['institution_admin'] };
    await expect(auditService.getOne('log-1', actor)).resolves.toMatchObject({ id: 'log-1' });
  });

  test('getOne() 404s cleanly when the entry does not exist', async () => {
    AuditModel.findById.mockResolvedValue(null);
    const actor = { institutionId: INSTITUTION_A, roles: ['super_admin'] };
    await expect(auditService.getOne('missing', actor)).rejects.toMatchObject({ statusCode: 404 });
  });
});
