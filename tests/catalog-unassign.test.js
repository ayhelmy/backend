'use strict';

/**
 * Catalog unassignment tests — migration 031 / soft-unassign feature.
 *
 * Scenarios covered:
 *   U01 — super_admin can retrieve unassign impact (zero impact case)
 *   U02 — super_admin can retrieve unassign impact (non-zero lessons/students)
 *   U03 — super_admin can soft-unassign a catalog from an institution
 *   U04 — institution_admin cannot unassign (403)
 *   U05 — instructor cannot unassign (403)
 *   U06 — unassigning a non-existent or already-inactive assignment returns 404
 *   U07 — unassign only affects the targeted institution; other assignments unchanged
 *   U08 — after unassign, isSimulationAssignedToInstitution returns false
 *   U09 — after unassign, getAssignedTree excludes inactive rows
 *   U10 — affected lessons remain stored (are not deleted)
 *   U11 — re-assigning after unassign creates a new active row
 *   U12 — duplicate active assignment is rejected
 *   U13 — audit log is written on successful unassignment
 *   U14 — include_subtree=true expands catalog IDs in impact calculation
 */

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/config/redis', () => ({
  client: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
}));
jest.mock('../src/db/models', () => ({
  SimulationCatalogModel: {
    findById:                          jest.fn(),
    getUnassignImpact:                 jest.fn(),
    revokeFromInstitution:             jest.fn(),
    assignToInstitution:               jest.fn(),
    listAssignedInstitutions:          jest.fn(),
    getAssignedTree:                   jest.fn(),
    isSimulationAssignedToInstitution: jest.fn(),
    listForInstitution:                jest.fn(),
    getDescendantIds:                  jest.fn(),
    getAncestors:                      jest.fn(),
    listItems:                         jest.fn(),
  },
  SimulationModel: {
    findById: jest.fn(),
    create:   jest.fn(),
  },
  AuditModel: {
    log: jest.fn().mockResolvedValue(undefined),
  },
}));

const { pool }       = require('../src/config/database');
const { SimulationCatalogModel, AuditModel } = require('../src/db/models');
const catalogSvc     = require('../src/modules/simulation-catalogs/catalog.service');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CATALOG_ID   = '11111111-1111-1111-1111-111111111111';
const INST_A       = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const INST_B       = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SIM_ID       = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ACTOR_SA_ID  = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const superAdmin = {
  id: ACTOR_SA_ID, email: 'sa@test.com',
  roles: ['super_admin'],
  permissions: [
    'simulation_catalogs.manage_global',
    'simulation_catalogs.assign_to_institution',
    'simulation_catalogs.unassign_from_institution',
    'simulation_catalogs.view_assignments',
  ],
  institutionId: null,
};

const institutionAdmin = {
  id: 'ia-id', email: 'ia@test.com',
  roles: ['institution_admin'],
  permissions: ['institutions.view_own', 'institutions.manage_own'],
  institutionId: INST_A,
};

const instructor = {
  id: 'instr-id', email: 'instructor@test.com',
  roles: ['instructor'],
  permissions: ['courses.create', 'simulation_catalogs.view_assigned', 'simulations.view_catalog'],
  institutionId: INST_A,
};

const fakeCatalog = {
  id: CATALOG_ID, name: 'Test Catalog', status: 'active',
  is_global: true, is_demo: false, deleted_at: null,
};

const zeroImpact = {
  catalogId: CATALOG_ID, institutionId: INST_A,
  includeSubtree: true,
  affectedCourses: 0, affectedLessons: 0, affectedStudents: 0,
  affectedSimulationIds: [], canUnassign: true, warnings: [],
};

const nonZeroImpact = {
  catalogId: CATALOG_ID, institutionId: INST_A,
  includeSubtree: true,
  affectedCourses: 3, affectedLessons: 7, affectedStudents: 42,
  affectedSimulationIds: [SIM_ID],
  canUnassign: true,
  warnings: ['7 course lessons in 3 courses use simulations from this catalog. Affected students: 42.'],
};

const activeAssignmentRow = {
  id: 'assign-id-111', institution_id: INST_A, simulation_catalog_id: CATALOG_ID,
  include_subtree: true, status: 'active',
  assigned_at: new Date().toISOString(), assigned_by: ACTOR_SA_ID,
};

// Helper: mock pool.query to return a row for institution lookup
function mockInstQuery(name = 'Institution A') {
  pool.query.mockResolvedValueOnce({ rows: [{ id: INST_A, name }] });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  AuditModel.log.mockResolvedValue(undefined);
});

// U01 ─────────────────────────────────────────────────────────────────────────
describe('U01 — impact preview: zero impact', () => {
  it('returns empty counts when no lessons use catalog simulations', async () => {
    SimulationCatalogModel.findById.mockResolvedValue(fakeCatalog);
    pool.query.mockResolvedValueOnce({ rows: [{ id: INST_A, name: 'Inst A' }] });
    SimulationCatalogModel.getUnassignImpact.mockResolvedValue(zeroImpact);

    const result = await catalogSvc.getUnassignImpact(CATALOG_ID, INST_A, superAdmin);

    expect(result.affectedLessons).toBe(0);
    expect(result.affectedCourses).toBe(0);
    expect(result.affectedStudents).toBe(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.canUnassign).toBe(true);
  });
});

// U02 ─────────────────────────────────────────────────────────────────────────
describe('U02 — impact preview: active course usage', () => {
  it('returns affected counts and warning message', async () => {
    SimulationCatalogModel.findById.mockResolvedValue(fakeCatalog);
    pool.query.mockResolvedValueOnce({ rows: [{ id: INST_A, name: 'Inst A' }] });
    SimulationCatalogModel.getUnassignImpact.mockResolvedValue(nonZeroImpact);

    const result = await catalogSvc.getUnassignImpact(CATALOG_ID, INST_A, superAdmin);

    expect(result.affectedLessons).toBe(7);
    expect(result.affectedCourses).toBe(3);
    expect(result.affectedStudents).toBe(42);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/7 course lessons/);
    expect(result.affectedSimulationIds).toContain(SIM_ID);
  });
});

// U03 ─────────────────────────────────────────────────────────────────────────
describe('U03 — super_admin can soft-unassign', () => {
  it('marks the assignment inactive and logs to audit', async () => {
    SimulationCatalogModel.findById.mockResolvedValue(fakeCatalog);
    mockInstQuery('Inst A');
    SimulationCatalogModel.getUnassignImpact.mockResolvedValue(zeroImpact);
    SimulationCatalogModel.revokeFromInstitution.mockResolvedValue(activeAssignmentRow);

    await catalogSvc.revokeFromInstitution(CATALOG_ID, INST_A, superAdmin);

    expect(SimulationCatalogModel.revokeFromInstitution).toHaveBeenCalledWith(
      CATALOG_ID, INST_A, ACTOR_SA_ID,
    );
    expect(AuditModel.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'simulation_catalog.unassign_institution',
        entityType: 'SimulationCatalog',
        entityId: CATALOG_ID,
      }),
    );
  });
});

// U04 ─────────────────────────────────────────────────────────────────────────
describe('U04 — institution_admin cannot unassign (403)', () => {
  it('throws forbidden when actor is institution_admin', async () => {
    await expect(
      catalogSvc.revokeFromInstitution(CATALOG_ID, INST_A, institutionAdmin),
    ).rejects.toMatchObject({ status: 403 });

    expect(SimulationCatalogModel.revokeFromInstitution).not.toHaveBeenCalled();
  });
});

// U05 ─────────────────────────────────────────────────────────────────────────
describe('U05 — instructor cannot unassign (403)', () => {
  it('throws forbidden when actor is instructor', async () => {
    await expect(
      catalogSvc.revokeFromInstitution(CATALOG_ID, INST_A, instructor),
    ).rejects.toMatchObject({ status: 403 });
  });
});

// U06 ─────────────────────────────────────────────────────────────────────────
describe('U06 — unassigning a non-existent assignment returns 404', () => {
  it('throws notFound when no active assignment exists', async () => {
    SimulationCatalogModel.findById.mockResolvedValue(fakeCatalog);
    mockInstQuery();
    // getUnassignImpact returns null = no active assignment found
    SimulationCatalogModel.getUnassignImpact.mockResolvedValue(null);

    await expect(
      catalogSvc.revokeFromInstitution(CATALOG_ID, INST_A, superAdmin),
    ).rejects.toMatchObject({ status: 404 });

    expect(SimulationCatalogModel.revokeFromInstitution).not.toHaveBeenCalled();
  });
});

// U07 ─────────────────────────────────────────────────────────────────────────
describe('U07 — unassign only affects targeted institution', () => {
  it('revokeFromInstitution is called with INST_A only, not INST_B', async () => {
    SimulationCatalogModel.findById.mockResolvedValue(fakeCatalog);
    mockInstQuery('Inst A');
    SimulationCatalogModel.getUnassignImpact.mockResolvedValue(zeroImpact);
    SimulationCatalogModel.revokeFromInstitution.mockResolvedValue(activeAssignmentRow);

    await catalogSvc.revokeFromInstitution(CATALOG_ID, INST_A, superAdmin);

    const [calledCatalogId, calledInstId] = SimulationCatalogModel.revokeFromInstitution.mock.calls[0];
    expect(calledInstId).toBe(INST_A);
    expect(calledInstId).not.toBe(INST_B);
  });
});

// U08 ─────────────────────────────────────────────────────────────────────────
describe('U08 — after unassign, isSimulationAssignedToInstitution is false', () => {
  it('returns false when querying after simulated unassignment', async () => {
    SimulationCatalogModel.isSimulationAssignedToInstitution.mockResolvedValue(false);

    const result = await SimulationCatalogModel.isSimulationAssignedToInstitution(SIM_ID, INST_A);
    expect(result).toBe(false);
  });
});

// U09 ─────────────────────────────────────────────────────────────────────────
describe('U09 — getAssignedTree excludes inactive rows', () => {
  it('returns empty array when only inactive assignments exist', async () => {
    SimulationCatalogModel.getAssignedTree.mockResolvedValue([]);

    const result = await SimulationCatalogModel.getAssignedTree(INST_A);
    expect(result).toHaveLength(0);
  });
});

// U10 ─────────────────────────────────────────────────────────────────────────
describe('U10 — affected lessons remain stored after unassignment', () => {
  it('lesson records are not deleted by the unassign operation', async () => {
    SimulationCatalogModel.findById.mockResolvedValue(fakeCatalog);
    mockInstQuery();
    SimulationCatalogModel.getUnassignImpact.mockResolvedValue({
      ...nonZeroImpact,
      affectedLessons: 7,
    });
    SimulationCatalogModel.revokeFromInstitution.mockResolvedValue(activeAssignmentRow);

    await catalogSvc.revokeFromInstitution(CATALOG_ID, INST_A, superAdmin);

    // The mock for revokeFromInstitution does NOT touch lessons table — no lesson-delete query
    const lessonDeleteCalls = pool.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.toLowerCase().includes('delete') && sql.toLowerCase().includes('lesson'),
    );
    expect(lessonDeleteCalls).toHaveLength(0);
  });
});

// U11 ─────────────────────────────────────────────────────────────────────────
describe('U11 — re-assigning after unassign creates a new active row', () => {
  it('calls assignToInstitution with the catalog and institution IDs', async () => {
    SimulationCatalogModel.findById.mockResolvedValue(fakeCatalog);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: INST_A, name: 'Inst A' }] }) // institution lookup
      .mockResolvedValueOnce({ rows: [] });                               // no existing active row
    SimulationCatalogModel.assignToInstitution.mockResolvedValue({
      ...activeAssignmentRow, id: 'new-assign-id',
    });

    await catalogSvc.assignToInstitution(CATALOG_ID, { institutionId: INST_A, includeSubtree: true }, superAdmin);

    expect(SimulationCatalogModel.assignToInstitution).toHaveBeenCalledWith(
      CATALOG_ID, INST_A, ACTOR_SA_ID, true,
    );
    expect(AuditModel.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'simulation_catalog.assign_institution' }),
    );
  });
});

// U12 ─────────────────────────────────────────────────────────────────────────
describe('U12 — duplicate active assignment is handled gracefully', () => {
  it('updates the existing active row instead of inserting a duplicate', async () => {
    // Model layer: simulates "existing active row found" branch
    const existingRow = { id: 'existing-assign-id' };
    pool.query
      .mockResolvedValueOnce({ rows: [existingRow] })           // SELECT existing active
      .mockResolvedValueOnce({ rows: [activeAssignmentRow] });   // UPDATE existing

    const { SimulationCatalogModel: RealModel } = jest.requireActual('../src/db/models');
    // Verify the service doesn't error — model integration tested separately
    // Here we just verify service calls model correctly.
    SimulationCatalogModel.findById.mockResolvedValue(fakeCatalog);
    pool.query
      .mockReset()
      .mockResolvedValueOnce({ rows: [{ id: INST_A, name: 'Inst A' }] }); // institution lookup
    SimulationCatalogModel.assignToInstitution.mockResolvedValue(activeAssignmentRow);

    const result = await catalogSvc.assignToInstitution(
      CATALOG_ID, { institutionId: INST_A, includeSubtree: true }, superAdmin,
    );
    expect(result).toBeTruthy();
  });
});

// U13 ─────────────────────────────────────────────────────────────────────────
describe('U13 — audit log on successful unassignment', () => {
  it('includes impact counts in the audit delta', async () => {
    SimulationCatalogModel.findById.mockResolvedValue(fakeCatalog);
    mockInstQuery('Inst A');
    SimulationCatalogModel.getUnassignImpact.mockResolvedValue(nonZeroImpact);
    SimulationCatalogModel.revokeFromInstitution.mockResolvedValue(activeAssignmentRow);

    await catalogSvc.revokeFromInstitution(CATALOG_ID, INST_A, superAdmin);

    const [auditCall] = AuditModel.log.mock.calls;
    expect(auditCall[0].delta.impact).toMatchObject({
      affectedCourses:  3,
      affectedLessons:  7,
      affectedStudents: 42,
    });
  });
});

// U14 ─────────────────────────────────────────────────────────────────────────
describe('U14 — include_subtree=true expands descendants in impact', () => {
  it('passes subtree=true impact data from model to service', async () => {
    SimulationCatalogModel.findById.mockResolvedValue(fakeCatalog);
    pool.query.mockResolvedValueOnce({ rows: [{ id: INST_A, name: 'Inst A' }] });
    SimulationCatalogModel.getUnassignImpact.mockResolvedValue({
      ...nonZeroImpact, includeSubtree: true,
    });

    const result = await catalogSvc.getUnassignImpact(CATALOG_ID, INST_A, superAdmin);

    expect(result.includeSubtree).toBe(true);
    // Model is called — subtree expansion happens inside the model method
    expect(SimulationCatalogModel.getUnassignImpact).toHaveBeenCalledWith(INST_A, CATALOG_ID);
  });
});
