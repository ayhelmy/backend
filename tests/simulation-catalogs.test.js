'use strict';

/**
 * Simulation Catalog access-control unit tests — RBAC v2.
 * All DB models are mocked; no live database required.
 *
 * Scenarios:
 *   1. super_admin assigns catalog to institution → succeeds
 *   2. institution_admin cannot assign catalog to another institution
 *   3. instructor sees only assigned + demo simulations, not private ones
 *   4. instructor cannot add unassigned simulation to a lesson
 *   5. student (no manage_global) cannot create a simulation
 *   6. guest (no actor) sees only demo_public simulations
 *   7. guest cannot access institution-scoped simulation
 *   8. cross-institution visibility check returns 404 for institution-scoped sim
 *   9. super_admin can view any simulation regardless of visibility
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../src/db/models', () => ({
  SimulationCatalogModel: {},
  SimulationModel:        {},
  AuditModel:             { log: jest.fn().mockResolvedValue(undefined) },
  ModuleModel:            {},
  CourseModel:            {},
  InstitutionModel:       {},
  UserModel:              {},
  RoleModel:              {},
}));

jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/config/redis',    () => ({ del: jest.fn().mockResolvedValue(1) }));

const { SimulationCatalogModel, SimulationModel, AuditModel } = require('../src/db/models');
const { pool } = require('../src/config/database');

const catalogSvc    = require('../src/modules/simulation-catalogs/catalog.service');
const simSvc        = require('../src/modules/simulations/simulations.service');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const INST_A    = 'aaaaaaaa-0000-0000-0000-000000000001';
const INST_B    = 'bbbbbbbb-0000-0000-0000-000000000002';
const CATALOG_1 = 'cccccccc-0000-0000-0000-000000000010';
const SIM_1     = 'eeeeeeee-0000-0000-0000-000000000020';
const SIM_DEMO  = 'eeeeeeee-0000-0000-0000-000000000021';

function makeSuperAdmin() {
  return {
    id: 'sa-id', email: 'sa@test.com',
    institutionId: INST_A,
    roles: ['super_admin'],
    permissions: [
      'simulation_catalogs.manage_global',
      'simulation_catalogs.assign_to_institution',
      'simulation_catalogs.view_assigned',
    ],
  };
}

function makeInstAdmin(institutionId = INST_A) {
  return {
    id: 'ia-id', email: 'ia@test.com',
    institutionId,
    roles: ['institution_admin'],
    permissions: [
      'simulation_catalogs.view_assigned',
      'simulations.view_catalog',
    ],
  };
}

function makeInstructor(institutionId = INST_A) {
  return {
    id: 'ins-id', email: 'ins@test.com',
    institutionId,
    roles: ['instructor'],
    permissions: [
      'simulations.view_catalog',
      'simulation_catalogs.view_assigned',
      'simulations.add_to_course',
      'simulations.launch',
    ],
  };
}

function makeStudent(institutionId = INST_A) {
  return {
    id: 'stu-id', email: 'stu@test.com',
    institutionId,
    roles: ['student'],
    permissions: ['simulations.launch'],
  };
}

function makeCatalog(overrides = {}) {
  return { id: CATALOG_1, name: 'Main Catalog', description: null, status: 'active', is_global: true, is_demo: false, ...overrides };
}

function makeSim(overrides = {}) {
  return {
    id: SIM_1, title: 'Network Security 101',
    type: 'scorm', status: 'active', visibility: 'institution',
    launch_url: 'https://cdn.example.com/sim1', scoring_config: {},
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// catalogSvc.assignToInstitution()
// ─────────────────────────────────────────────────────────────────────────────

describe('catalogSvc.assignToInstitution()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('super_admin can assign catalog to any institution', async () => {
    const actor = makeSuperAdmin();
    SimulationCatalogModel.findById = jest.fn().mockResolvedValue(makeCatalog());
    pool.query.mockResolvedValueOnce({ rows: [{ id: INST_B, name: 'Uni B' }] });
    SimulationCatalogModel.assignToInstitution = jest.fn().mockResolvedValue({
      institution_id: INST_B, simulation_catalog_id: CATALOG_1,
    });

    const result = await catalogSvc.assignToInstitution(CATALOG_1, { institutionId: INST_B }, actor);
    expect(SimulationCatalogModel.assignToInstitution).toHaveBeenCalledWith(CATALOG_1, INST_B, actor.id);
    expect(AuditModel.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'simulation_catalog.assign_institution',
    }));
    expect(result.institution_id).toBe(INST_B);
  });

  test('throws 403 when actor lacks assign_to_institution permission', async () => {
    const actor = makeInstAdmin();
    await expect(
      catalogSvc.assignToInstitution(CATALOG_1, { institutionId: INST_B }, actor),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('throws 404 when institution does not exist', async () => {
    const actor = makeSuperAdmin();
    SimulationCatalogModel.findById = jest.fn().mockResolvedValue(makeCatalog());
    pool.query.mockResolvedValueOnce({ rows: [] }); // no institution found

    await expect(
      catalogSvc.assignToInstitution(CATALOG_1, { institutionId: INST_B }, actor),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('throws 404 when catalog does not exist', async () => {
    const actor = makeSuperAdmin();
    SimulationCatalogModel.findById = jest.fn().mockResolvedValue(null);

    await expect(
      catalogSvc.assignToInstitution(CATALOG_1, { institutionId: INST_B }, actor),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// catalogSvc.listForInstitution()
// ─────────────────────────────────────────────────────────────────────────────

describe('catalogSvc.listForInstitution()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('institution_admin can list own institution catalogs', async () => {
    const actor = makeInstAdmin(INST_A);
    SimulationCatalogModel.listForInstitution = jest.fn().mockResolvedValue([makeCatalog()]);

    const result = await catalogSvc.listForInstitution(INST_A, actor);
    expect(result).toHaveLength(1);
  });

  test('institution_admin cannot list catalogs of another institution', async () => {
    const actor = makeInstAdmin(INST_A);
    await expect(
      catalogSvc.listForInstitution(INST_B, actor),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('super_admin can list catalogs of any institution', async () => {
    const actor = makeSuperAdmin();
    SimulationCatalogModel.listForInstitution = jest.fn().mockResolvedValue([]);

    await expect(catalogSvc.listForInstitution(INST_B, actor)).resolves.toBeDefined();
  });

  test('throws 403 when actor has no view permission', async () => {
    const actor = makeStudent();
    await expect(
      catalogSvc.listForInstitution(INST_A, actor),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// simSvc.list() — scope filtering
// ─────────────────────────────────────────────────────────────────────────────

describe('simSvc.list()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('guest (no actor) sees only demo_public simulations', async () => {
    pool.query.mockResolvedValueOnce({ rows: [makeSim({ visibility: 'demo_public', id: SIM_DEMO })] });

    const result = await simSvc.list({}, null);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/demo_public/);
    expect(result.simulations).toHaveLength(1);
  });

  test('guest with scope=demo sees only demo simulations', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await simSvc.list({ scope: 'demo' }, null);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/demo_public/);
  });

  test('super_admin list has no visibility restriction', async () => {
    pool.query.mockResolvedValueOnce({ rows: [makeSim(), makeSim({ visibility: 'private', id: 'p-id' })] });

    const result = await simSvc.list({}, makeSuperAdmin());
    const sql = pool.query.mock.calls[0][0];
    expect(sql).not.toMatch(/demo_public/);
    expect(result.simulations).toHaveLength(2);
  });

  test('instructor list uses catalog-assigned subquery', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await simSvc.list({}, makeInstructor());
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/simulation_catalog_items/);
    expect(sql).toMatch(/institution_simulation_catalogs/);
  });

  test('institution_admin list includes both demo_public and catalog-assigned', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await simSvc.list({}, makeInstAdmin());
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/demo_public/);
    expect(sql).toMatch(/simulation_catalog_items/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// simSvc.getOne() — visibility gating
// ─────────────────────────────────────────────────────────────────────────────

describe('simSvc.getOne()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('guest can view demo_public simulation', async () => {
    SimulationModel.findById = jest.fn().mockResolvedValue(makeSim({ visibility: 'demo_public' }));

    const result = await simSvc.getOne(SIM_1, null);
    expect(result).toBeDefined();
  });

  test('guest cannot view institution-scoped simulation → 404', async () => {
    SimulationModel.findById = jest.fn().mockResolvedValue(makeSim({ visibility: 'institution' }));

    await expect(simSvc.getOne(SIM_1, null)).rejects.toMatchObject({ statusCode: 404 });
  });

  test('guest cannot view private simulation → 404', async () => {
    SimulationModel.findById = jest.fn().mockResolvedValue(makeSim({ visibility: 'private' }));

    await expect(simSvc.getOne(SIM_1, null)).rejects.toMatchObject({ statusCode: 404 });
  });

  test('instructor sees institution-scoped sim when catalog assigned', async () => {
    SimulationModel.findById = jest.fn().mockResolvedValue(makeSim({ visibility: 'institution' }));
    SimulationCatalogModel.isSimulationAssignedToInstitution = jest.fn().mockResolvedValue(true);

    const result = await simSvc.getOne(SIM_1, makeInstructor());
    expect(result).toBeDefined();
    expect(SimulationCatalogModel.isSimulationAssignedToInstitution)
      .toHaveBeenCalledWith(SIM_1, INST_A);
  });

  test('instructor cannot access institution-scoped sim not in assigned catalog → 404', async () => {
    SimulationModel.findById = jest.fn().mockResolvedValue(makeSim({ visibility: 'institution' }));
    SimulationCatalogModel.isSimulationAssignedToInstitution = jest.fn().mockResolvedValue(false);

    await expect(simSvc.getOne(SIM_1, makeInstructor())).rejects.toMatchObject({ statusCode: 404 });
  });

  test('super_admin can view private simulation', async () => {
    SimulationModel.findById = jest.fn().mockResolvedValue(makeSim({ visibility: 'private' }));

    const result = await simSvc.getOne(SIM_1, makeSuperAdmin());
    expect(result).toBeDefined();
  });

  test('non-admin cannot view private simulation → 404', async () => {
    SimulationModel.findById = jest.fn().mockResolvedValue(makeSim({ visibility: 'private' }));

    await expect(simSvc.getOne(SIM_1, makeInstructor())).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// simSvc.create() — permission check
// ─────────────────────────────────────────────────────────────────────────────

describe('simSvc.create()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws 403 when actor lacks manage_global', async () => {
    await expect(
      simSvc.create({ title: 'Test', launchUrl: 'https://x.com' }, makeStudent()),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('super_admin can create simulation', async () => {
    SimulationModel.create = jest.fn().mockResolvedValue(makeSim({ id: 'new-id', visibility: 'institution' }));

    const result = await simSvc.create(
      { title: 'New Sim', launchUrl: 'https://cdn.example.com/new', visibility: 'institution' },
      makeSuperAdmin(),
    );
    expect(result.id).toBe('new-id');
    expect(AuditModel.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'simulation.create' }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// simSvc.demoLaunch() — public demo launch
// ─────────────────────────────────────────────────────────────────────────────

describe('simSvc.demoLaunch()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('launches demo_public active simulation without auth', async () => {
    SimulationModel.findById = jest.fn().mockResolvedValue(
      makeSim({ visibility: 'demo_public', status: 'active' }),
    );

    const result = await simSvc.demoLaunch(SIM_DEMO);
    expect(result.isDemo).toBe(true);
    expect(result.maxAttempts).toBeNull();
  });

  test('rejects launch of non-demo simulation', async () => {
    SimulationModel.findById = jest.fn().mockResolvedValue(
      makeSim({ visibility: 'institution', status: 'active' }),
    );

    await expect(simSvc.demoLaunch(SIM_1)).rejects.toMatchObject({ statusCode: 403 });
  });

  test('rejects launch of inactive demo simulation', async () => {
    SimulationModel.findById = jest.fn().mockResolvedValue(
      makeSim({ visibility: 'demo_public', status: 'draft' }),
    );

    await expect(simSvc.demoLaunch(SIM_DEMO)).rejects.toMatchObject({ statusCode: 400 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// catalogSvc.addItem() — simulation catalog item management
// ─────────────────────────────────────────────────────────────────────────────

describe('catalogSvc.addItem()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('super_admin can add simulation to catalog', async () => {
    const actor = makeSuperAdmin();
    SimulationCatalogModel.findById = jest.fn().mockResolvedValue(makeCatalog());
    SimulationModel.findById = jest.fn().mockResolvedValue(makeSim());
    SimulationCatalogModel.addItem = jest.fn().mockResolvedValue({
      catalog_id: CATALOG_1, simulation_id: SIM_1,
    });

    const result = await catalogSvc.addItem(CATALOG_1, { simulationId: SIM_1 }, actor);
    expect(SimulationCatalogModel.addItem).toHaveBeenCalledWith(CATALOG_1, SIM_1, actor.id);
    expect(AuditModel.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'simulation_catalog.item_add',
    }));
    expect(result).toMatchObject({ catalog_id: CATALOG_1 });
  });

  test('throws 403 when actor lacks manage_global', async () => {
    await expect(
      catalogSvc.addItem(CATALOG_1, { simulationId: SIM_1 }, makeInstAdmin()),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('throws 404 when simulation does not exist', async () => {
    SimulationCatalogModel.findById = jest.fn().mockResolvedValue(makeCatalog());
    SimulationModel.findById = jest.fn().mockResolvedValue(null);

    await expect(
      catalogSvc.addItem(CATALOG_1, { simulationId: 'nonexistent' }, makeSuperAdmin()),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Manual test steps (no live DB required above; below for reference)
// ─────────────────────────────────────────────────────────────────────────────

/*
Manual test steps (run with a seeded database):

1. super_admin assigns catalog to institution:
   POST /api/v1/simulation-catalogs/:catalogId/institutions
   Body: { "institutionId": "<inst-id>" }
   Auth: superadmin@demo-university.edu / SuperAdmin123!
   Expected: 201 with assignment record

2. instructor sees only assigned simulations:
   GET /api/v1/simulations?scope=assigned
   Auth: instructor@demo-university.edu / Instructor1!
   Expected: 200, only sims from assigned catalogs + demo_public

3. instructor cannot add unassigned simulation to a lesson:
   POST /api/v1/courses/:courseId/modules/:moduleId/lessons
   Body: { "title": "Sim Lesson", "type": "simulation", "simulationId": "<unassigned-sim-id>" }
   Auth: instructor@demo-university.edu / Instructor1!
   Expected: 403 "Simulation is not available for this institution"

4. student cannot launch catalog simulation directly (no direct launch endpoint):
   - Student must launch via session service which checks course enrollment
   GET /api/v1/simulations/<institution-sim-id>
   Auth: student1@demo-university.edu / Student123!
   Expected: 200 only if sim is in a catalog assigned to the student's institution
   Expected: 404 if not assigned

5. guest sees demo simulations only:
   GET /api/v1/simulations/demo
   No Auth header
   Expected: 200, only visibility=demo_public, status=active simulations

6. guest cannot access institution-scoped simulation:
   GET /api/v1/simulations/<institution-sim-id>
   No Auth header
   Expected: 404

7. institution_admin sees assigned catalogs:
   GET /api/v1/institutions/me/simulation-catalogs
   Auth: admin@demo-university.edu / Admin1234!
   Expected: 200, list of catalogs assigned to their institution

8. institution_admin cannot see catalogs of another institution:
   GET /api/v1/institutions/<other-inst-id>/simulation-catalogs
   Auth: admin@demo-university.edu / Admin1234!
   Expected: 403 or 404
*/
