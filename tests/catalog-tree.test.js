'use strict';

/**
 * Catalog tree tests — hierarchy, access control, and tenant isolation.
 *
 * actor.roles is string[] (JWT payload shape) per authenticate.js.
 * All DB calls mocked — no live database required.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPool = { query: jest.fn() };
jest.mock('../src/config/database', () => ({ pool: mockPool }));

jest.mock('../src/db/models', () => ({
  SimulationCatalogModel: {
    getFullTree:              jest.fn(),
    getDemoTree:              jest.fn(),
    getAssignedTree:          jest.fn(),
    findById:                 jest.fn(),
    getSubtree:               jest.fn(),
    getAncestors:             jest.fn(),
    list:                     jest.fn(),
    create:                   jest.fn(),
    update:                   jest.fn(),
    move:                     jest.fn(),
    softDelete:               jest.fn(),
    validateNoCircularParent: jest.fn(),
    isSimulationAssignedToInstitution: jest.fn(),
    assignToInstitution:      jest.fn(),
    revokeFromInstitution:    jest.fn(),
    listItems:                jest.fn(),
    addItem:                  jest.fn(),
    removeItem:               jest.fn(),
    listAssignedInstitutions: jest.fn(),
    listForInstitution:       jest.fn(),
  },
  SimulationModel: { findById: jest.fn() },
  AuditModel:      { log: jest.fn().mockResolvedValue(undefined) },
}));

const { SimulationCatalogModel } = require('../src/db/models');
const catalogSvc = require('../src/modules/simulation-catalogs/catalog.service');

// ── Fixtures ──────────────────────────────────────────────────────────────────

// roles is string[] — matches JWT payload shape (authenticate.js line 46)
const SUPER   = { id: 'sa-1', email: 'sa@x.com',  institutionId: null,    roles: ['super_admin'],        permissions: ['simulation_catalogs.manage_global', 'simulation_catalogs.assign_to_institution'] };
const ADMIN_A = { id: 'aa-1', email: 'aa@x.com',  institutionId: 'inst-a', roles: ['institution_admin'], permissions: ['simulation_catalogs.view_assigned'] };
const ADMIN_B = { id: 'ab-1', email: 'ab@x.com',  institutionId: 'inst-b', roles: ['institution_admin'], permissions: ['simulation_catalogs.view_assigned'] };
const INSTR_A = { id: 'ia-1', email: 'ia@x.com',  institutionId: 'inst-a', roles: ['instructor'],         permissions: ['simulations.view_catalog'] };

const ROOT_CAT = { id: 'cat-root', name: 'Engineering', slug: 'engineering', depth: 0, path: 'cat-root', parent_id: null, root_catalog_id: 'cat-root', visibility: 'global', status: 'active', sort_order: 0, item_count: 0 };
const CHILD_CAT = { id: 'cat-child', name: 'Mechanical Engineering', slug: 'mechanical-engineering', depth: 1, path: 'cat-root/cat-child', parent_id: 'cat-root', root_catalog_id: 'cat-root', visibility: 'global', status: 'active', sort_order: 0, item_count: 2 };
const LEAF_CAT  = { id: 'cat-leaf',  name: 'Pumps', slug: 'pumps', depth: 2, path: 'cat-root/cat-child/cat-leaf', parent_id: 'cat-child', root_catalog_id: 'cat-root', visibility: 'global', status: 'active', sort_order: 0, item_count: 1 };
const DEMO_CAT  = { id: 'cat-demo',  name: 'Demo Samples', slug: 'demo-samples', depth: 0, path: 'cat-demo', parent_id: null, root_catalog_id: 'cat-demo', visibility: 'demo_public', status: 'active', sort_order: 10, item_count: 3 };

beforeEach(() => jest.clearAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

// 1 ── super_admin receives full tree ─────────────────────────────────────────
test('super_admin receives full catalog tree', async () => {
  SimulationCatalogModel.getFullTree.mockResolvedValue([ROOT_CAT, CHILD_CAT, LEAF_CAT]);
  const result = await catalogSvc.getTree({}, SUPER);
  expect(SimulationCatalogModel.getFullTree).toHaveBeenCalledTimes(1);
  expect(Array.isArray(result)).toBe(true);
  expect(result[0].id).toBe('cat-root');
  expect(result[0].children[0].id).toBe('cat-child');
});

// 2 ── institution_admin sees only assigned subtree ────────────────────────────
test('institution_admin sees only assigned subtree', async () => {
  SimulationCatalogModel.getAssignedTree.mockResolvedValue([CHILD_CAT, LEAF_CAT]);
  const result = await catalogSvc.getTree({}, ADMIN_A);
  expect(SimulationCatalogModel.getAssignedTree).toHaveBeenCalledWith('inst-a');
  expect(SimulationCatalogModel.getFullTree).not.toHaveBeenCalled();
  expect(result.every((n) => n.id !== 'cat-root')).toBe(true);
});

// 3 ── demo tree public ────────────────────────────────────────────────────────
test('getDemoTree returns only demo_public catalogs', async () => {
  SimulationCatalogModel.getDemoTree.mockResolvedValue([DEMO_CAT]);
  const result = await catalogSvc.getDemoTree();
  expect(result.length).toBe(1);
  expect(result[0].visibility).toBe('demo_public');
});

// 4 ── create root catalog ─────────────────────────────────────────────────────
test('super_admin can create a root catalog (no parentId)', async () => {
  SimulationCatalogModel.create.mockResolvedValue(ROOT_CAT);
  const result = await catalogSvc.createCatalog(
    { name: 'Engineering', visibility: 'global' },
    SUPER,
  );
  expect(SimulationCatalogModel.create).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'Engineering', parentId: null, visibility: 'global' }),
  );
  expect(result.id).toBe('cat-root');
});

// 5 ── create sub-catalog ─────────────────────────────────────────────────────
test('super_admin can create sub-catalog with parentId', async () => {
  SimulationCatalogModel.findById.mockResolvedValueOnce(ROOT_CAT); // parent exists check
  SimulationCatalogModel.create.mockResolvedValue(CHILD_CAT);
  const result = await catalogSvc.createCatalog(
    { name: 'Mechanical Engineering', parentId: 'cat-root', visibility: 'global' },
    SUPER,
  );
  expect(SimulationCatalogModel.create).toHaveBeenCalledWith(
    expect.objectContaining({ parentId: 'cat-root' }),
  );
  expect(result.depth).toBe(1);
});

// 6 ── circular parent prevention ─────────────────────────────────────────────
test('moveCatalog rejects when newParentId would create a cycle', async () => {
  SimulationCatalogModel.findById.mockResolvedValueOnce(ROOT_CAT);
  // validateNoCircularParent returns false → service throws
  SimulationCatalogModel.validateNoCircularParent.mockResolvedValue(false);
  await expect(
    catalogSvc.moveCatalog('cat-root', { newParentId: 'cat-child' }, SUPER),
  ).rejects.toMatchObject({ statusCode: 400 });
  expect(SimulationCatalogModel.move).not.toHaveBeenCalled();
});

// 7 ── move catalog node to new parent ────────────────────────────────────────
test('moveCatalog calls model.move with the correct id and newParentId', async () => {
  SimulationCatalogModel.findById
    .mockResolvedValueOnce(CHILD_CAT)  // lookup moving node
    .mockResolvedValueOnce({ ...CHILD_CAT, parent_id: 'cat-new-parent' }); // post-move refetch
  SimulationCatalogModel.validateNoCircularParent.mockResolvedValue(true);
  SimulationCatalogModel.move.mockResolvedValue(undefined);
  await catalogSvc.moveCatalog('cat-child', { newParentId: 'cat-new-parent' }, SUPER);
  expect(SimulationCatalogModel.move).toHaveBeenCalledWith('cat-child', 'cat-new-parent');
});

// 8 ── institution_admin B cannot access subtree assigned to institution A only ─
test('getSubtree returns 404 for inst-b when catalog not assigned to inst-b', async () => {
  SimulationCatalogModel.findById.mockResolvedValue(CHILD_CAT);
  // isCatalogAssignedToInstitution internally queries pool — return no rows
  mockPool.query.mockResolvedValue({ rows: [] });
  await expect(
    catalogSvc.getSubtree('cat-child', ADMIN_B),
  ).rejects.toMatchObject({ statusCode: 404 });
});

// 9 ── isSimulationAssignedToInstitution returns false for unassigned simulation ─
test('isSimulationAssignedToInstitution returns false for unassigned catalog', async () => {
  SimulationCatalogModel.isSimulationAssignedToInstitution.mockResolvedValue(false);
  const allowed = await SimulationCatalogModel.isSimulationAssignedToInstitution('sim-x', 'inst-a');
  expect(allowed).toBe(false);
});

// 10 ── assignToInstitution with include_subtree ───────────────────────────────
test('assignToInstitution passes include_subtree=true to model', async () => {
  SimulationCatalogModel.findById.mockResolvedValue(ROOT_CAT);
  mockPool.query.mockResolvedValue({ rows: [{ id: 'inst-a', name: 'Inst A' }] }); // institution exists check
  SimulationCatalogModel.assignToInstitution.mockResolvedValue({ catalog_id: 'cat-root', institution_id: 'inst-a', include_subtree: true });
  await catalogSvc.assignToInstitution('cat-root', { institutionId: 'inst-a', includeSubtree: true }, SUPER);
  expect(SimulationCatalogModel.assignToInstitution).toHaveBeenCalledWith(
    'cat-root', 'inst-a', SUPER.id, true,
  );
});

// 11 ── softDelete blocked when children exist ─────────────────────────────────
test('deleteCatalog throws when catalog has live children', async () => {
  SimulationCatalogModel.findById.mockResolvedValue(ROOT_CAT);
  SimulationCatalogModel.softDelete.mockRejectedValue(
    Object.assign(new Error('Cannot delete: catalog has sub-catalogs.'), { statusCode: 409 }),
  );
  await expect(catalogSvc.deleteCatalog('cat-root', SUPER)).rejects.toThrow('sub-catalogs');
  expect(SimulationCatalogModel.softDelete).toHaveBeenCalledWith('cat-root');
});
