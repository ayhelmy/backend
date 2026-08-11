'use strict';

/**
 * Simulation Catalog service — SRS §4.7 SIM-01; RBAC v2 simulation_catalogs group.
 *
 * Tree access rules:
 *   super_admin       — full CRUD; full tree; any institution
 *   institution_admin — read assigned subtree only; no write
 *   instructor        — read assigned subtree for own institution
 *   student/TA        — no direct catalog access (simulations reached via course lessons)
 *   guest             — demo_public tree only (no auth)
 */

const path          = require('path');
const fs            = require('fs');
const { pool }      = require('../../config/database');
const config        = require('../../config');
const { SimulationCatalogModel, SimulationModel, AuditModel, SimulationClickRegionModel, SimulationStepModel } = require('../../db/models');
const ApiError      = require('../../utils/apiError');
const webglSvc      = require('../simulations/webgl.service');
const { getImageDimensions } = require('../../utils/imageDimensions');

// ─────────────────────────────────────────────────────────────────────────────
// Mappers
// ─────────────────────────────────────────────────────────────────────────────

function mapCatalog(row) {
  if (!row) return null;
  return {
    id:            row.id,
    name:          row.name,
    description:   row.description  ?? null,
    slug:          row.slug         ?? null,
    parentId:      row.parent_id    ?? null,
    rootCatalogId: row.root_catalog_id ?? null,
    depth:         row.depth        ?? 0,
    path:          row.path         ?? '',
    sortOrder:     row.sort_order   ?? 0,
    visibility:    row.visibility   ?? 'global',
    institutionId: row.institution_id ?? null,
    isGlobal:      row.is_global    ?? true,
    isDemo:        row.is_demo      ?? false,
    status:        row.status,
    itemCount:     row.item_count   !== undefined ? Number(row.item_count) : undefined,
    includeSubtree: row.include_subtree ?? undefined,
    createdBy:     row.created_by,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
    assignedAt:    row.assigned_at  ?? undefined,
  };
}

function mapCatalogItem(row) {
  return {
    id:               row.id,
    catalogId:        row.catalog_id,
    simulationId:     row.simulation_id,
    sortOrder:        row.sort_order ?? 0,
    title:            row.title,
    description:      row.description      ?? null,
    type:             row.type,
    visibility:       row.visibility,
    status:           row.sim_status ?? row.status,
    thumbnailUrl:     row.thumbnail_url    ?? null,
    estimatedMinutes: row.estimated_minutes ?? null,
    difficulty:       row.difficulty,
    addedAt:          row.created_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tree helpers (exported so other services can use them)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a flat list of catalog rows (ordered depth ASC) into a nested tree.
 * Each node gets a `children` array.
 */
function buildCatalogTree(flatList) {
  const map   = {};
  const roots = [];

  for (const row of flatList) {
    const node     = { ...mapCatalog(row), children: [] };
    map[node.id]   = node;
  }

  for (const row of flatList) {
    const node = map[row.id];
    if (row.parent_id && map[row.parent_id]) {
      map[row.parent_id].children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
exports.buildCatalogTree = buildCatalogTree;

/** Returns all ancestor rows (root → parent) for a given catalog ID. */
async function getCatalogAncestors(catalogId) {
  return SimulationCatalogModel.getAncestors(catalogId);
}
exports.getCatalogAncestors = getCatalogAncestors;

/** Returns all descendant IDs of a catalog. */
async function getCatalogDescendants(catalogId) {
  return SimulationCatalogModel.getDescendantIds(catalogId);
}
exports.getCatalogDescendants = getCatalogDescendants;

/** Returns true when a simulation belongs to any catalog accessible by institutionId. */
async function isSimulationAllowedForInstitution(simulationId, institutionId) {
  return SimulationCatalogModel.isSimulationAssignedToInstitution(simulationId, institutionId);
}
exports.isSimulationAllowedForInstitution = isSimulationAllowedForInstitution;

/** Returns true when catalogId itself (or an ancestor) is assigned to institutionId via an ACTIVE assignment. */
async function isCatalogAssignedToInstitution(catalogId, institutionId) {
  const { rows } = await pool.query(
    `SELECT 1
       FROM simulation_catalogs sc
       JOIN institution_simulation_catalogs isc ON isc.institution_id = $2 AND isc.status = 'active'
       JOIN simulation_catalogs ac ON ac.id = isc.simulation_catalog_id AND ac.deleted_at IS NULL
      WHERE sc.id = $1 AND sc.deleted_at IS NULL
        AND (
          sc.id = isc.simulation_catalog_id
          OR (isc.include_subtree = TRUE
              AND (sc.path = ac.path OR sc.path LIKE ac.path || '/%'))
        )
      LIMIT 1`,
    [catalogId, institutionId],
  );
  return rows.length > 0;
}
exports.isCatalogAssignedToInstitution = isCatalogAssignedToInstitution;

/** Flattens a tree into a plain array (BFS order). */
function flattenCatalogTreeForQuery(tree) {
  const result = [];
  const queue  = [...tree];
  while (queue.length) {
    const node = queue.shift();
    result.push(node);
    if (node.children?.length) queue.push(...node.children);
  }
  return result;
}
exports.flattenCatalogTreeForQuery = flattenCatalogTreeForQuery;

// ─────────────────────────────────────────────────────────────────────────────
// Permission guards
// ─────────────────────────────────────────────────────────────────────────────

function requireManageGlobal(actor) {
  if (!actor?.permissions?.includes('simulation_catalogs.manage_global')) {
    throw ApiError.forbidden('Missing required permission: simulation_catalogs.manage_global.');
  }
}

function requireViewAccess(actor) {
  const ok = actor?.permissions?.includes('simulation_catalogs.manage_global') ||
             actor?.permissions?.includes('simulation_catalogs.view_assigned')  ||
             actor?.permissions?.includes('simulations.view_catalog');
  if (!ok) throw ApiError.forbidden('Missing required permission: simulation_catalogs.view_assigned.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Tree read endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /simulation-catalogs/tree
 * super_admin → full tree
 * institution_admin / instructor → assigned subtree for own institution
 */
exports.getTree = async (query, actor) => {
  requireViewAccess(actor);

  if (actor.roles?.includes('super_admin')) {
    const flat = await SimulationCatalogModel.getFullTree({
      visibility:    query.visibility,
      institutionId: query.institutionId,
    });
    return buildCatalogTree(flat);
  }

  // Non-super-admin: return only assigned subtree for own institution
  const flat = await SimulationCatalogModel.getAssignedTree(actor.institutionId);
  return buildCatalogTree(flat);
};

/**
 * GET /simulation-catalogs/:id/tree
 * Returns the selected node + all descendants as a nested tree.
 */
exports.getSubtree = async (id, actor) => {
  requireViewAccess(actor);

  const catalog = await SimulationCatalogModel.findById(id);
  if (!catalog) throw ApiError.notFound('Simulation catalog not found.');

  if (!actor.roles?.includes('super_admin')) {
    const allowed = await isCatalogAssignedToInstitution(id, actor.institutionId);
    if (!allowed) throw ApiError.notFound('Simulation catalog not found.');
  }

  const flat = await SimulationCatalogModel.getSubtree(id);
  return buildCatalogTree(flat);
};

/**
 * GET /simulation-catalogs/demo-tree — no auth required
 */
exports.getDemoTree = async () => {
  const flat = await SimulationCatalogModel.getDemoTree();
  return buildCatalogTree(flat);
};

/**
 * GET /institutions/me/simulation-catalogs/tree — institution-scoped tree
 */
exports.getInstitutionTree = async (institutionId, actor) => {
  requireViewAccess(actor);

  if (!actor.roles?.includes('super_admin') && institutionId !== actor.institutionId) {
    throw ApiError.forbidden('You can only view catalogs for your own institution.');
  }

  const flat = await SimulationCatalogModel.getAssignedTree(institutionId);
  return buildCatalogTree(flat);
};

// ─────────────────────────────────────────────────────────────────────────────
// Flat list (backward compat — existing GET /simulation-catalogs)
// ─────────────────────────────────────────────────────────────────────────────

exports.listCatalogs = async (query, actor) => {
  requireManageGlobal(actor);
  const rows = await SimulationCatalogModel.list({ status: query.status });
  return rows.map(mapCatalog);
};

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

exports.createCatalog = async (body, actor) => {
  requireManageGlobal(actor);

  // Validate parent exists if provided
  if (body.parentId) {
    const parent = await SimulationCatalogModel.findById(body.parentId);
    if (!parent) throw ApiError.notFound('Parent catalog not found.');
  }

  const catalog = await SimulationCatalogModel.create({
    name:          body.name,
    description:   body.description  ?? null,
    parentId:      body.parentId     ?? null,
    visibility:    body.visibility   ?? (body.isDemo ? 'demo_public' : body.isGlobal !== false ? 'global' : 'institution'),
    institutionId: body.institutionId ?? null,
    isGlobal:      body.isGlobal     ?? (body.parentId ? undefined : true),
    isDemo:        body.isDemo       ?? false,
    sortOrder:     body.sortOrder    ?? 0,
    createdBy:     actor.id,
  });

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation_catalog.create', entityType: 'SimulationCatalog', entityId: catalog.id,
    delta: { after: { name: catalog.name, parentId: catalog.parent_id, visibility: catalog.visibility } },
  });

  return mapCatalog(catalog);
};

exports.getCatalog = async (id, actor) => {
  requireViewAccess(actor);

  const catalog = await SimulationCatalogModel.findById(id);
  if (!catalog) throw ApiError.notFound('Simulation catalog not found.');

  if (!actor.roles?.includes('super_admin')) {
    const allowed = await isCatalogAssignedToInstitution(id, actor.institutionId);
    if (!allowed) throw ApiError.notFound('Simulation catalog not found.');
  }

  const [items, ancestors] = await Promise.all([
    SimulationCatalogModel.listItems(id),
    SimulationCatalogModel.getAncestors(id),
  ]);

  return {
    ...mapCatalog(catalog),
    items:     items.map(mapCatalogItem),
    ancestors: ancestors.map(mapCatalog),
  };
};

exports.updateCatalog = async (id, body, actor) => {
  requireManageGlobal(actor);

  const catalog = await SimulationCatalogModel.findById(id);
  if (!catalog) throw ApiError.notFound('Simulation catalog not found.');

  const before  = { name: catalog.name, status: catalog.status, visibility: catalog.visibility };
  const updated = await SimulationCatalogModel.update(id, {
    name:        body.name,
    description: body.description,
    status:      body.status,
    is_global:   body.isGlobal,
    is_demo:     body.isDemo,
    visibility:  body.visibility,
    sort_order:  body.sortOrder,
  });

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation_catalog.update', entityType: 'SimulationCatalog', entityId: id,
    delta: { before, after: { name: body.name, status: body.status, visibility: body.visibility } },
  });

  return mapCatalog(updated);
};

/**
 * PATCH /simulation-catalogs/:id/move
 * Moves the catalog node (and subtree) under a new parent.
 */
exports.moveCatalog = async (id, body, actor) => {
  requireManageGlobal(actor);

  const catalog = await SimulationCatalogModel.findById(id);
  if (!catalog) throw ApiError.notFound('Simulation catalog not found.');

  const newParentId = body.newParentId ?? null;

  // Circular check
  const safe = await SimulationCatalogModel.validateNoCircularParent(id, newParentId);
  if (!safe) throw ApiError.badRequest('Cannot move catalog into one of its own descendants.');

  const oldParentId = catalog.parent_id;
  await SimulationCatalogModel.move(id, newParentId);

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation_catalog.move', entityType: 'SimulationCatalog', entityId: id,
    delta: { before: { parentId: oldParentId }, after: { parentId: newParentId } },
  });

  return SimulationCatalogModel.findById(id).then(mapCatalog);
};

/**
 * PATCH /simulation-catalogs/:id/reorder
 * Updates sort_order of the given catalog node.
 */
exports.reorderCatalog = async (id, body, actor) => {
  requireManageGlobal(actor);

  const catalog = await SimulationCatalogModel.findById(id);
  if (!catalog) throw ApiError.notFound('Simulation catalog not found.');

  const updated = await SimulationCatalogModel.update(id, { sort_order: body.sortOrder });
  return mapCatalog(updated);
};

exports.deleteCatalog = async (id, actor) => {
  requireManageGlobal(actor);

  const catalog = await SimulationCatalogModel.findById(id);
  if (!catalog) throw ApiError.notFound('Simulation catalog not found.');

  // softDelete throws if children or items remain
  await SimulationCatalogModel.softDelete(id);

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation_catalog.delete', entityType: 'SimulationCatalog', entityId: id,
    delta: { before: { name: catalog.name } },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Items
// ─────────────────────────────────────────────────────────────────────────────

exports.listItems = async (catalogId, actor) => {
  requireManageGlobal(actor);
  const catalog = await SimulationCatalogModel.findById(catalogId);
  if (!catalog) throw ApiError.notFound('Simulation catalog not found.');
  const rows = await SimulationCatalogModel.listItems(catalogId);
  return rows.map(mapCatalogItem);
};

exports.addItem = async (catalogId, body, actor) => {
  requireManageGlobal(actor);

  const catalog = await SimulationCatalogModel.findById(catalogId);
  if (!catalog) throw ApiError.notFound('Simulation catalog not found.');

  const sim = await SimulationModel.findById(body.simulationId);
  if (!sim) throw ApiError.notFound('Simulation not found.');

  const result = await SimulationCatalogModel.addItem(catalogId, body.simulationId, actor.id);

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation_catalog.item_add', entityType: 'SimulationCatalog', entityId: catalogId,
    delta: { after: { simulationId: body.simulationId, simulationTitle: sim.title } },
  });

  return result ?? { catalog_id: catalogId, simulation_id: body.simulationId, note: 'already_present' };
};

exports.removeItem = async (catalogId, simulationId, actor) => {
  requireManageGlobal(actor);
  const removed = await SimulationCatalogModel.removeItem(catalogId, simulationId);
  if (!removed) throw ApiError.notFound('Simulation not found in this catalog.');

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation_catalog.item_remove', entityType: 'SimulationCatalog', entityId: catalogId,
    delta: { before: { simulationId } },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Institution assignment
// ─────────────────────────────────────────────────────────────────────────────

exports.assignToInstitution = async (catalogId, body, actor) => {
  const canAssign = actor?.permissions?.includes('simulation_catalogs.assign_to_institution') ||
                    actor?.permissions?.includes('simulation_catalogs.manage_global');
  if (!canAssign) throw ApiError.forbidden('Missing required permission: simulation_catalogs.assign_to_institution.');

  const catalog = await SimulationCatalogModel.findById(catalogId);
  if (!catalog) throw ApiError.notFound('Simulation catalog not found.');

  const { institutionId, includeSubtree = true } = body;
  const { rows: [inst] } = await pool.query(
    'SELECT id, name FROM institutions WHERE id = $1 AND deleted_at IS NULL', [institutionId],
  );
  if (!inst) throw ApiError.notFound('Institution not found.');

  const result = await SimulationCatalogModel.assignToInstitution(
    catalogId, institutionId, actor.id, includeSubtree,
  );

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation_catalog.assign_institution', entityType: 'SimulationCatalog', entityId: catalogId,
    delta: { after: { institutionId, institutionName: inst.name, includeSubtree } },
  });

  return result ?? { catalogId, institutionId, note: 'already_assigned' };
};

exports.revokeFromInstitution = async (catalogId, institutionId, actor) => {
  const canRevoke = actor?.permissions?.includes('simulation_catalogs.unassign_from_institution') ||
                    actor?.permissions?.includes('simulation_catalogs.assign_to_institution')    ||
                    actor?.permissions?.includes('simulation_catalogs.manage_global');
  if (!canRevoke) {
    throw ApiError.forbidden('Missing required permission: simulation_catalogs.unassign_from_institution.');
  }

  if (!actor.roles?.includes('super_admin')) {
    throw ApiError.forbidden('Only super_admin can unassign simulation catalogs from institutions.');
  }

  const catalog = await SimulationCatalogModel.findById(catalogId);
  if (!catalog) throw ApiError.notFound('Simulation catalog not found.');

  const { rows: [inst] } = await pool.query(
    'SELECT id, name FROM institutions WHERE id = $1 AND deleted_at IS NULL', [institutionId],
  );
  if (!inst) throw ApiError.notFound('Institution not found.');

  // Calculate impact BEFORE unassigning so the audit log captures true numbers
  const impact = await SimulationCatalogModel.getUnassignImpact(institutionId, catalogId);
  if (!impact) throw ApiError.notFound('No active assignment found for this catalog and institution.');

  const removed = await SimulationCatalogModel.revokeFromInstitution(catalogId, institutionId, actor.id);
  if (!removed) throw ApiError.notFound('No active assignment found for this catalog and institution.');

  await AuditModel.log({
    institutionId: actor.institutionId,
    actorId:    actor.id,
    actorEmail: actor.email,
    action:     'simulation_catalog.unassign_institution',
    entityType: 'SimulationCatalog',
    entityId:   catalogId,
    delta: {
      before: {
        institutionId,
        institutionName:  inst.name,
        includeSubtree:   removed.include_subtree,
      },
      impact: {
        affectedCourses:  impact.affectedCourses,
        affectedLessons:  impact.affectedLessons,
        affectedStudents: impact.affectedStudents,
      },
    },
  });
};

/**
 * Returns an impact summary for unassigning catalogId from institutionId.
 * Counts affected courses, lessons, and active students without modifying data.
 */
exports.getUnassignImpact = async (catalogId, institutionId, actor) => {
  const canView = actor?.permissions?.includes('simulation_catalogs.manage_global') ||
                  actor?.permissions?.includes('simulation_catalogs.unassign_from_institution');
  if (!canView) throw ApiError.forbidden('Missing required permission.');

  if (!actor.roles?.includes('super_admin')) {
    throw ApiError.forbidden('Only super_admin can view unassignment impact.');
  }

  const catalog = await SimulationCatalogModel.findById(catalogId);
  if (!catalog) throw ApiError.notFound('Simulation catalog not found.');

  const { rows: [inst] } = await pool.query(
    'SELECT id, name FROM institutions WHERE id = $1 AND deleted_at IS NULL', [institutionId],
  );
  if (!inst) throw ApiError.notFound('Institution not found.');

  const impact = await SimulationCatalogModel.getUnassignImpact(institutionId, catalogId);
  if (!impact) throw ApiError.notFound('No active assignment found for this catalog and institution.');

  return impact;
};

exports.listAssignedInstitutions = async (catalogId, actor) => {
  requireManageGlobal(actor);
  const catalog = await SimulationCatalogModel.findById(catalogId);
  if (!catalog) throw ApiError.notFound('Simulation catalog not found.');

  const rows = await SimulationCatalogModel.listAssignedInstitutions(catalogId);
  return rows.map((r) => ({
    id:                 r.id,
    name:               r.name,
    slug:               r.slug,
    domain:             r.domain                 ?? null,
    logoUrl:            r.logo_url               ?? null,
    status:             r.status,
    includeSubtree:     r.include_subtree,
    assignedAt:         r.assigned_at,
    assignedByEmail:    r.assigned_by_email      ?? null,
    assignmentId:       r.assignment_id          ?? null,
    isDirect:           r.is_direct,
    assignedViaCatalog: r.is_direct ? null : (r.assigned_via_catalog_name ?? null),
  }));
};

exports.listForInstitution = async (institutionId, actor) => {
  requireViewAccess(actor);

  if (!actor.roles?.includes('super_admin') && institutionId !== actor.institutionId) {
    throw ApiError.forbidden('You can only view catalogs for your own institution.');
  }

  const rows = await SimulationCatalogModel.listForInstitution(institutionId);
  return rows.map(mapCatalog);
};

// ─────────────────────────────────────────────────────────────────────────────
// Simulation CRUD within catalog context (new flow — SRS §4.7 SIM-01)
// ─────────────────────────────────────────────────────────────────────────────

function mapSimulation(row) {
  if (!row) return null;
  return {
    id:                   row.id,
    institutionId:        row.institution_id       ?? null,
    domainId:             row.domain_id            ?? null,
    title:                row.title,
    description:          row.description          ?? null,
    type:                 row.type,
    launchUrl:            row.launch_url           ?? null,
    thumbnailUrl:         row.thumbnail_url        ?? null,
    estimatedMinutes:     row.estimated_minutes    ?? null,
    difficulty:           row.difficulty           ?? 'intermediate',
    maxScore:             row.max_score            ?? 100,
    passScore:            row.pass_score           ?? 70,
    maxAttempts:          row.max_attempts         ?? 3,
    scoringConfig:        row.scoring_config       ?? {},
    learningObjectives:   row.learning_objectives  ?? [],
    status:               row.status,
    visibility:           row.visibility,
    version:              row.version              ?? '1.0.0',
    // WebGL fields (migration 029)
    launchType:           row.launch_type          ?? null,
    buildUuid:            row.build_uuid           ?? null,
    originalZipFilename:  row.original_zip_filename ?? null,
    storagePath:          row.storage_path         ?? null,
    publicEntryUrl:       row.public_entry_url     ?? null,
    entryFile:            row.entry_file           ?? 'index.html',
    buildStatus:          row.build_status         ?? null,
    buildValidation:      row.build_validation     ?? null,
    fileSizeBytes:        row.file_size_bytes      ?? null,
    createdAt:            row.created_at,
    updatedAt:            row.updated_at           ?? null,
  };
}

/**
 * POST /simulation-catalogs/:id/simulations
 * Creates a new simulation and immediately links it to the catalog in one flow.
 * Replaces the old "create simulation then pick catalog" flow.
 */
exports.createSimulationInCatalog = async (catalogId, body, actor) => {
  requireManageGlobal(actor);

  const catalog = await SimulationCatalogModel.findById(catalogId);
  if (!catalog) throw ApiError.notFound('Simulation catalog not found.');

  const sim = await SimulationModel.create({
    institutionId:      null,
    domainId:           body.domainId           ?? null,
    title:              body.title,
    description:        body.description        ?? null,
    type:               'webgl',
    launchUrl:          null,
    thumbnailUrl:       body.thumbnailUrl        ?? null,
    estimatedMinutes:   body.estimatedMinutes    ?? null,
    difficulty:         body.difficulty          ?? 'intermediate',
    maxScore:           body.maxScore            ?? 100,
    passScore:          body.passScore           ?? 70,
    maxAttempts:        body.maxAttempts         ?? 3,
    scoringConfig:      body.scoringConfig        ?? {},
    learningObjectives: body.learningObjectives  ?? [],
    version:            body.version             ?? '1.0.0',
    visibility:         body.visibility          ?? 'institution',
    createdBy:          actor.id,
  });

  await SimulationCatalogModel.addItem(catalogId, sim.id, actor.id);

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation.create_in_catalog', entityType: 'Simulation', entityId: sim.id,
    delta: { after: { title: sim.title, catalogId, catalogName: catalog.name } },
  });

  return { simulation: mapSimulation(sim), catalogId };
};

/**
 * GET /simulation-catalogs/:id/simulations?include_children=true
 * Lists simulations directly in a catalog, or in the entire subtree.
 */
exports.getCatalogSimulations = async (catalogId, query, actor) => {
  requireViewAccess(actor);

  const catalog = await SimulationCatalogModel.findById(catalogId);
  if (!catalog) throw ApiError.notFound('Simulation catalog not found.');

  if (!actor.roles?.includes('super_admin')) {
    const allowed = await isCatalogAssignedToInstitution(catalogId, actor.institutionId);
    if (!allowed) throw ApiError.notFound('Simulation catalog not found.');
  }

  const includeChildren = query.include_children === 'true' || query.include_children === true;

  const webglCols = `
    s.launch_type, s.build_uuid, s.original_zip_filename, s.storage_path,
    s.public_entry_url, s.entry_file, s.build_status, s.build_validation, s.file_size_bytes
  `;

  if (includeChildren) {
    const descendants = await SimulationCatalogModel.getDescendantIds(catalogId);
    const catalogIds  = [catalogId, ...descendants];
    const { rows } = await pool.query(
      `SELECT DISTINCT s.id, s.institution_id, s.domain_id, s.title, s.description,
              s.type, s.launch_url, s.thumbnail_url, s.estimated_minutes,
              s.difficulty, s.max_score, s.pass_score, s.max_attempts,
              s.scoring_config, s.learning_objectives, s.status, s.visibility,
              s.version, s.created_by, s.created_at, s.updated_at, ${webglCols}
         FROM simulations s
         JOIN simulation_catalog_items sci ON sci.simulation_id = s.id
        WHERE sci.catalog_id = ANY($1::uuid[]) AND s.deleted_at IS NULL
        ORDER BY s.title`,
      [catalogIds],
    );
    return rows.map(mapSimulation);
  }

  const { rows } = await pool.query(
    `SELECT s.id, s.institution_id, s.domain_id, s.title, s.description,
            s.type, s.launch_url, s.thumbnail_url, s.estimated_minutes,
            s.difficulty, s.max_score, s.pass_score, s.max_attempts,
            s.scoring_config, s.learning_objectives, s.status, s.visibility,
            s.version, s.created_by, s.created_at, s.updated_at, ${webglCols}
       FROM simulations s
       JOIN simulation_catalog_items sci
         ON sci.simulation_id = s.id AND sci.catalog_id = $1
      WHERE s.deleted_at IS NULL
      ORDER BY sci.sort_order, s.title`,
    [catalogId],
  );
  return rows.map(mapSimulation);
};

/**
 * PATCH /simulation-catalogs/:id/simulations/:simId
 * Updates simulation metadata from within the catalog context.
 */
exports.updateCatalogSimulation = async (catalogId, simId, body, actor) => {
  requireManageGlobal(actor);

  const catalog = await SimulationCatalogModel.findById(catalogId);
  if (!catalog) throw ApiError.notFound('Simulation catalog not found.');

  const { rows: [item] } = await pool.query(
    'SELECT 1 FROM simulation_catalog_items WHERE catalog_id = $1 AND simulation_id = $2 LIMIT 1',
    [catalogId, simId],
  );
  if (!item) throw ApiError.notFound('Simulation not found in this catalog.');

  await SimulationModel.update(simId, {
    title:               body.title,
    description:         body.description,
    type:                body.type,
    launch_url:          body.launchUrl,
    thumbnail_url:       body.thumbnailUrl,
    estimated_minutes:   body.estimatedMinutes,
    difficulty:          body.difficulty,
    max_score:           body.maxScore,
    pass_score:          body.passScore,
    max_attempts:        body.maxAttempts,
    visibility:          body.visibility,
    status:              body.status,
    version:             body.version,
    learning_objectives: body.learningObjectives,
  });

  const updated = await SimulationModel.findById(simId);

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation.update_in_catalog', entityType: 'Simulation', entityId: simId,
    delta: { after: { catalogId, title: body.title } },
  });

  return mapSimulation(updated);
};

/**
 * DELETE /simulation-catalogs/:id/simulations/:simId
 * Removes the simulation from the catalog (does NOT soft-delete the simulation itself).
 */
exports.removeCatalogSimulation = async (catalogId, simId, actor) => {
  requireManageGlobal(actor);

  const removed = await SimulationCatalogModel.removeItem(catalogId, simId);
  if (!removed) throw ApiError.notFound('Simulation not found in this catalog.');

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation.remove_from_catalog', entityType: 'Simulation', entityId: simId,
    delta: { before: { catalogId } },
  });
};

/**
 * PATCH /simulation-catalogs/:catalogId/simulations/:simId/thumbnail
 * Accepts a multipart image upload, persists to storage/thumbnails/, updates the simulation record.
 */
exports.uploadSimulationThumbnail = async (catalogId, simId, file, actor, baseUrl = '') => {
  requireManageGlobal(actor);

  if (!file) throw ApiError.badRequest('A thumbnail image file is required.');

  const { rows: [item] } = await pool.query(
    'SELECT 1 FROM simulation_catalog_items WHERE catalog_id = $1 AND simulation_id = $2 LIMIT 1',
    [catalogId, simId],
  );
  if (!item) throw ApiError.notFound('Simulation not found in this catalog.');

  const thumbDir = config.storage.thumbnailsDirAbs;

  fs.mkdirSync(thumbDir, { recursive: true });

  const ext      = path.extname(file.originalname).toLowerCase() || '.jpg';
  const filename = `${simId}${ext}`;
  const dest     = path.join(thumbDir, filename);

  fs.copyFileSync(file.path, dest);
  try { fs.unlinkSync(file.path); } catch (_) {}

  const thumbnailUrl = `${baseUrl}${config.storage.thumbnailsUrlPrefix}/${filename}`;

  await SimulationModel.update(simId, { thumbnail_url: thumbnailUrl });

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation.thumbnail_uploaded', entityType: 'Simulation', entityId: simId,
    delta: { after: { thumbnailUrl, catalogId } },
  });

  return { thumbnailUrl };
};

/**
 * PATCH /simulation-catalogs/:catalogId/simulations/:simId/click-regions
 * Accepts a reference screenshot (multipart `image`) + a JSON text field
 * `regions` shaped like a COCO export ({ categories, annotations }). Reads
 * the image's pixel dimensions and stores a flattened category/bbox list,
 * used later to resolve a recorded click's (normX, normY) to a component
 * name when generating the click-tracking CSV.
 */
exports.uploadClickRegions = async (catalogId, simId, file, regionsJson, actor, baseUrl = '') => {
  requireManageGlobal(actor);

  if (!file) throw ApiError.badRequest('A reference image file is required.');
  if (!regionsJson) throw ApiError.badRequest('A `regions` JSON field is required.');

  const { rows: [item] } = await pool.query(
    'SELECT 1 FROM simulation_catalog_items WHERE catalog_id = $1 AND simulation_id = $2 LIMIT 1',
    [catalogId, simId],
  );
  if (!item) throw ApiError.notFound('Simulation not found in this catalog.');

  let parsed;
  try {
    parsed = JSON.parse(regionsJson);
  } catch {
    try { fs.unlinkSync(file.path); } catch (_) {}
    throw ApiError.badRequest('`regions` is not valid JSON.');
  }

  const categories = Array.isArray(parsed.categories) ? parsed.categories : [];
  const annotations = Array.isArray(parsed.annotations) ? parsed.annotations : [];
  const categoryNameById = new Map(categories.map(c => [c.id, c.name]));

  const regions = annotations
    .filter(a => Array.isArray(a.bbox) && a.bbox.length === 4)
    .map(a => ({
      categoryName: categoryNameById.get(a.category_id) ?? 'Uncategorized',
      bbox: a.bbox,
    }));

  if (regions.length === 0) {
    try { fs.unlinkSync(file.path); } catch (_) {}
    throw ApiError.badRequest('No valid bounding boxes found in `regions`.');
  }

  let imageWidth, imageHeight;
  let referenceImageUrl = null;
  try {
    const buffer = fs.readFileSync(file.path);
    ({ width: imageWidth, height: imageHeight } = getImageDimensions(buffer));

    // Persist the reference image so the analytics dashboard can use it as background.
    const thumbDir = config.storage.thumbnailsDirAbs;
    fs.mkdirSync(thumbDir, { recursive: true });
    const ext      = path.extname(file.originalname).toLowerCase() || '.png';
    const filename = `${simId}-regions${ext}`;
    fs.copyFileSync(file.path, path.join(thumbDir, filename));
    referenceImageUrl = `${baseUrl}${config.storage.thumbnailsUrlPrefix}/${filename}`;
  } catch (err) {
    throw ApiError.badRequest(err.message);
  } finally {
    try { fs.unlinkSync(file.path); } catch (_) {}
  }

  await SimulationClickRegionModel.upsert(simId, { imageWidth, imageHeight, regions, referenceImageUrl });

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation.click_regions_uploaded', entityType: 'Simulation', entityId: simId,
    delta: { after: { imageWidth, imageHeight, regionCount: regions.length, referenceImageUrl, catalogId } },
  });

  return { imageWidth, imageHeight, regionCount: regions.length, referenceImageUrl };
};

/**
 * POST /simulation-catalogs/:catalogId/simulations/webgl-upload
 * Uploads, extracts, and validates a Unity WebGL ZIP, then creates the simulation record.
 *
 * @param {string} catalogId
 * @param {object} body  - { title, description, difficulty, estimatedMinutes, visibility, status }
 * @param {object} file  - Multer file object { path, originalname, size }
 * @param {object} actor - Authenticated user
 */
exports.createWebGLSimulationInCatalog = async (catalogId, body, file, actor) => {
  requireManageGlobal(actor);

  if (!file) throw ApiError.badRequest('A ZIP file (zip_file) is required.');

  const catalog = await SimulationCatalogModel.findById(catalogId);
  if (!catalog) throw ApiError.notFound('Simulation catalog not found.');

  const buildUuid = webglSvc.generateBuildUuid();
  let sim = null;

  try {
    // 1. Extract ZIP to storage/simulations/{uuid}/
    const { validation } = await webglSvc.extractWebGLZip(file.path, buildUuid);

    if (!validation.valid) {
      await AuditModel.log({
        institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
        action: 'simulation.webgl_validation_failed', entityType: 'Simulation', entityId: null,
        delta: { buildUuid, errors: validation.errors, catalogId },
      });
      throw ApiError.unprocessable(
        `WebGL ZIP validation failed: ${validation.errors.join('; ')}`,
      );
    }

    // 2. Build the public URL.
    // If the ZIP had a wrapper folder (e.g., "Build 002 Benshmark/"), entry file
    // path needs to include that subfolder so index.html is reachable.
    let entryFilePath = 'index.html';
    if (validation.checklist?.wrapperFolder) {
      const rel = require('path').relative(
        webglSvc.getBuildPath(buildUuid),
        validation.checklist.wrapperFolder,
      );
      entryFilePath = `${rel}/index.html`.replace(/\\/g, '/');
    }
    const publicEntryUrl = webglSvc.getPublicEntryUrl(buildUuid, entryFilePath);
    const storagePath    = webglSvc.getBuildPath(buildUuid);

    // 3. Persist simulation record
    sim = await SimulationModel.createWebGL({
      institutionId:       null,
      title:               body.title,
      description:         body.description          ?? null,
      thumbnailUrl:        body.thumbnailUrl          ?? null,
      estimatedMinutes:    body.estimatedMinutes      ? Number(body.estimatedMinutes) : null,
      difficulty:          body.difficulty            ?? 'intermediate',
      visibility:          body.visibility            ?? 'institution',
      status:              'active',
      createdBy:           actor.id,
      buildUuid,
      originalZipFilename: file.originalname,
      storagePath,
      publicEntryUrl,
      entryFile:           entryFilePath,
      buildStatus:         'ready',
      buildValidation:     validation,
      fileSizeBytes:       file.size ?? null,
    });

    // 4. Link simulation to catalog
    await SimulationCatalogModel.addItem(catalogId, sim.id, actor.id);

    // 5. Audit
    await AuditModel.log({
      institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
      action: 'simulation.webgl_uploaded', entityType: 'Simulation', entityId: sim.id,
      delta: {
        after: {
          title: sim.title, catalogId, catalogName: catalog.name,
          buildUuid, publicEntryUrl, buildStatus: 'ready',
        },
      },
    });

    return { simulation: mapSimulation(sim), catalogId };

  } finally {
    // Always clean up temp file
    await webglSvc.cleanTempFile(file.path);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Department catalog assignment
// ─────────────────────────────────────────────────────────────────────────────

function requireDeptCatalogManage(actor) {
  const ok = actor?.permissions?.includes('simulation_catalogs.manage_global') ||
             actor?.permissions?.includes('departments.manage');
  if (!ok) throw ApiError.forbidden('Missing permission: departments.manage.');
}

/**
 * POST /institutions/:id/departments/:deptId/simulation-catalogs
 * Assigns a catalog to a department. The catalog must already be assigned to the institution.
 */
exports.assignCatalogToDepartment = async (deptId, body, actor) => {
  requireDeptCatalogManage(actor);

  const { catalogId, includeSubtree = true } = body;

  const { rows: [dept] } = await pool.query(
    'SELECT id, institution_id FROM departments WHERE id = $1 AND deleted_at IS NULL',
    [deptId],
  );
  if (!dept) throw ApiError.notFound('Department not found.');

  const institutionId = dept.institution_id;
  if (!actor.roles?.includes('super_admin') && institutionId !== actor.institutionId) {
    throw ApiError.notFound('Department not found.');
  }

  const catalog = await SimulationCatalogModel.findById(catalogId);
  if (!catalog) throw ApiError.notFound('Simulation catalog not found.');

  const instOk = await isCatalogAssignedToInstitution(catalogId, institutionId);
  if (!instOk) {
    throw ApiError.badRequest(
      'This catalog must be assigned to the institution before it can be assigned to a department.',
    );
  }

  const { rows: [row] } = await pool.query(
    `INSERT INTO department_simulation_catalogs
       (institution_id, department_id, simulation_catalog_id, assigned_by, include_subtree)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (department_id, simulation_catalog_id) DO UPDATE
       SET include_subtree = $5, assigned_by = $4, assigned_at = NOW(), updated_at = NOW()
     RETURNING assigned_at`,
    [institutionId, deptId, catalogId, actor.id, includeSubtree],
  );

  await AuditModel.log({
    institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'department.catalog_assign', entityType: 'Department', entityId: deptId,
    delta: { after: { catalogId, catalogName: catalog.name, includeSubtree } },
  });

  return { departmentId: deptId, catalogId, includeSubtree, assignedAt: row.assigned_at };
};

/**
 * DELETE /institutions/:id/departments/:deptId/simulation-catalogs/:catalogId
 */
exports.revokeCatalogFromDepartment = async (deptId, catalogId, actor) => {
  requireDeptCatalogManage(actor);

  const { rows: [dept] } = await pool.query(
    'SELECT id, institution_id FROM departments WHERE id = $1 AND deleted_at IS NULL',
    [deptId],
  );
  if (!dept) throw ApiError.notFound('Department not found.');

  if (!actor.roles?.includes('super_admin') && dept.institution_id !== actor.institutionId) {
    throw ApiError.notFound('Department not found.');
  }

  const { rows } = await pool.query(
    `DELETE FROM department_simulation_catalogs
      WHERE department_id = $1 AND simulation_catalog_id = $2
      RETURNING id`,
    [deptId, catalogId],
  );
  if (!rows.length) throw ApiError.notFound('Catalog is not assigned to this department.');

  await AuditModel.log({
    institutionId: dept.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'department.catalog_revoke', entityType: 'Department', entityId: deptId,
    delta: { before: { catalogId } },
  });
};

/**
 * GET /institutions/:id/departments/:deptId/simulation-catalogs
 * Lists direct catalog assignments for a department (not yet subtree-expanded).
 */
exports.listDepartmentCatalogAssignments = async (deptId, actor) => {
  const viewOk = actor?.permissions?.includes('simulation_catalogs.view_assigned') ||
                 actor?.permissions?.includes('simulation_catalogs.manage_global')  ||
                 actor?.permissions?.includes('departments.view')                   ||
                 actor?.permissions?.includes('departments.manage');
  if (!viewOk) throw ApiError.forbidden('Missing required permission.');

  const { rows: [dept] } = await pool.query(
    'SELECT id, institution_id FROM departments WHERE id = $1 AND deleted_at IS NULL',
    [deptId],
  );
  if (!dept) throw ApiError.notFound('Department not found.');

  if (!actor.roles?.includes('super_admin') && dept.institution_id !== actor.institutionId) {
    throw ApiError.notFound('Department not found.');
  }

  const { rows } = await pool.query(
    `SELECT sc.id, sc.name, sc.description, sc.slug, sc.path, sc.depth,
            sc.parent_id, sc.root_catalog_id, sc.sort_order,
            sc.visibility, sc.institution_id, sc.is_global, sc.is_demo, sc.status,
            sc.created_by, sc.created_at, sc.updated_at,
            dsc.include_subtree, dsc.assigned_at,
            (SELECT COUNT(*)::int FROM simulation_catalog_items sci
              WHERE sci.catalog_id = sc.id) AS item_count
       FROM department_simulation_catalogs dsc
       JOIN simulation_catalogs sc ON sc.id = dsc.simulation_catalog_id AND sc.deleted_at IS NULL
      WHERE dsc.department_id = $1
      ORDER BY sc.depth ASC, sc.sort_order ASC, sc.name ASC`,
    [deptId],
  );

  return rows.map((r) => ({ ...mapCatalog(r), includeSubtree: r.include_subtree, assignedAt: r.assigned_at }));
};

/**
 * Returns a flat Set of all catalog IDs accessible to a department,
 * expanding subtrees for include_subtree=TRUE assignments.
 */
exports.getDepartmentCatalogIds = async (deptId) => {
  const { rows: assignments } = await pool.query(
    `SELECT dsc.simulation_catalog_id AS catalog_id, dsc.include_subtree
       FROM department_simulation_catalogs dsc
       JOIN simulation_catalogs sc ON sc.id = dsc.simulation_catalog_id AND sc.deleted_at IS NULL
      WHERE dsc.department_id = $1`,
    [deptId],
  );
  if (!assignments.length) return [];

  const ids = new Set();
  for (const a of assignments) {
    ids.add(a.catalog_id);
    if (a.include_subtree) {
      const descendants = await SimulationCatalogModel.getDescendantIds(a.catalog_id);
      descendants.forEach((id) => ids.add(id));
    }
  }
  return [...ids];
};

/**
 * Returns the nested catalog tree for a department, expanding subtrees per assignment.
 * Used by GET /courses/:id/simulation-catalogs.
 */
exports.getDepartmentCatalogTree = async (deptId, actor) => {
  const assignments = await exports.listDepartmentCatalogAssignments(deptId, actor);
  if (!assignments.length) return [];

  const results = [];
  for (const a of assignments) {
    if (a.includeSubtree) {
      const flat = await SimulationCatalogModel.getSubtree(a.id);
      results.push(...buildCatalogTree(flat));
    } else {
      results.push({ ...a, children: [] });
    }
  }
  return results;
};

/** Tree-aware check: is simulation accessible to the given department? */
exports.isSimulationAllowedForDepartment = async (simId, deptId) => {
  return SimulationCatalogModel.isSimulationAllowedForDepartment(simId, deptId);
};

/** Returns array of simulation IDs available to a department (tree-aware). */
exports.getDepartmentAvailableSimulationIds = async (deptId) => {
  const catalogIds = await exports.getDepartmentCatalogIds(deptId);
  if (!catalogIds.length) return [];

  const { rows } = await pool.query(
    `SELECT DISTINCT simulation_id FROM simulation_catalog_items WHERE catalog_id = ANY($1::uuid[])`,
    [catalogIds],
  );
  return rows.map((r) => r.simulation_id);
};

// ── Simulation completion steps ───────────────────────────────────────────────

/**
 * GET  /simulation-catalogs/:id/simulations/:simId/steps
 * Returns the ordered step list for a simulation.
 */
exports.getSimulationSteps = async (catalogId, simId, actor) => {
  requireManageGlobal(actor);

  const { rows: [item] } = await pool.query(
    'SELECT 1 FROM simulation_catalog_items WHERE catalog_id = $1 AND simulation_id = $2 LIMIT 1',
    [catalogId, simId],
  );
  if (!item) throw ApiError.notFound('Simulation not found in this catalog.');

  const rows = await SimulationStepModel.findBySimulationId(simId);
  return rows.map(r => ({
    id:           r.id,
    stepOrder:    r.step_order,
    label:        r.label,
    categoryName: r.category_name,
  }));
};

/**
 * PUT  /simulation-catalogs/:id/simulations/:simId/steps
 * Replaces the complete step list for a simulation.
 * Body: { steps: [{ stepOrder, label, categoryName }] }
 */
exports.saveSimulationSteps = async (catalogId, simId, steps, actor) => {
  requireManageGlobal(actor);

  const { rows: [item] } = await pool.query(
    'SELECT 1 FROM simulation_catalog_items WHERE catalog_id = $1 AND simulation_id = $2 LIMIT 1',
    [catalogId, simId],
  );
  if (!item) throw ApiError.notFound('Simulation not found in this catalog.');

  if (!Array.isArray(steps)) throw ApiError.badRequest('`steps` must be an array.');
  if (steps.length > 50)     throw ApiError.badRequest('Maximum 50 steps per simulation.');

  const normalised = steps.map((s, idx) => ({
    stepOrder:    Number(s.stepOrder ?? idx + 1),
    label:        String(s.label ?? '').trim(),
    categoryName: String(s.categoryName ?? '').trim(),
  }));

  for (const s of normalised) {
    if (!s.label)        throw ApiError.badRequest(`Step ${s.stepOrder}: label is required.`);
    if (!s.categoryName) throw ApiError.badRequest(`Step ${s.stepOrder}: categoryName is required.`);
  }

  const saved = await SimulationStepModel.replaceSteps(simId, normalised);

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation.steps_saved', entityType: 'Simulation', entityId: simId,
    delta: { after: { stepCount: saved.length, catalogId } },
  }).catch(() => {});

  return saved.map(r => ({
    id:           r.id,
    stepOrder:    r.step_order,
    label:        r.label,
    categoryName: r.category_name,
  }));
};

// ── Storage scan / relink (recovery tool — see incident notes) ────────────────
//
// The seed script previously wiped the simulations table in production,
// orphaning any real Unity WebGL builds / thumbnails already sitting on the
// storage volume (their DB rows are gone, but the files remain). These two
// admin-only endpoints let a super_admin inventory what's actually on disk
// and relink existing simulation rows to the real files, instead of guessing.

/**
 * GET /simulation-catalogs/storage-scan
 * Read-only inventory of storage/simulations/* and storage/thumbnails/*,
 * cross-referenced against current simulation rows, so an admin can see
 * which folders are real (vs. seed stubs) and which are already linked.
 */
exports.scanStorage = async (actor) => {
  requireManageGlobal(actor);

  const simBase   = config.storage.simulationsDirAbs;
  const thumbBase = config.storage.thumbnailsDirAbs;

  const { rows: sims } = await pool.query(
    `SELECT id, title, build_uuid, thumbnail_url, build_validation
       FROM simulations WHERE deleted_at IS NULL ORDER BY title`,
  );

  let buildDirNames = [];
  try {
    buildDirNames = fs.readdirSync(simBase, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (_) { buildDirNames = []; }

  const storageBuilds = buildDirNames.map((uuid) => {
    const dir = path.join(simBase, uuid);
    const indexHtml = path.join(dir, 'index.html');
    const hasIndexHtml = fs.existsSync(indexHtml);

    let detectedTitle = null;
    if (hasIndexHtml) {
      try {
        const html = fs.readFileSync(indexHtml, 'utf8');
        const m = html.match(/<title>([^<]*)<\/title>/i);
        if (m) detectedTitle = m[1].trim();
      } catch (_) { /* unreadable — leave title null */ }
    }

    const buildDir = path.join(dir, 'Build');
    let buildFileCount = 0;
    let totalBytes = 0;
    let hasNonEmptyFile = false;
    if (fs.existsSync(buildDir)) {
      for (const f of fs.readdirSync(buildDir)) {
        const stat = fs.statSync(path.join(buildDir, f));
        buildFileCount += 1;
        totalBytes += stat.size;
        if (stat.size > 0) hasNonEmptyFile = true;
      }
    }

    const linkedSim = sims.find((s) => s.build_uuid === uuid);

    return {
      buildUuid: uuid,
      hasIndexHtml,
      detectedTitle,
      buildFileCount,
      totalBytes,
      looksLikeStub: !hasIndexHtml || !hasNonEmptyFile,
      currentlyLinkedTo: linkedSim ? { simulationId: linkedSim.id, title: linkedSim.title } : null,
    };
  });

  let thumbFileNames = [];
  try {
    thumbFileNames = fs.readdirSync(thumbBase, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch (_) { thumbFileNames = []; }

  const storageThumbnails = thumbFileNames.map((filename) => {
    const stat = fs.statSync(path.join(thumbBase, filename));
    const baseName = filename.replace(/\.[^.]+$/, '');
    const matchingSim = sims.find((s) => baseName === s.id || baseName === `${s.id}-regions`);
    return {
      filename,
      bytes: stat.size,
      matchesSimulationId:    matchingSim ? matchingSim.id    : null,
      matchesSimulationTitle: matchingSim ? matchingSim.title : null,
    };
  });

  return {
    simulations: sims.map((s) => ({
      id:           s.id,
      title:        s.title,
      buildUuid:    s.build_uuid,
      thumbnailUrl: s.thumbnail_url,
      isStubBuild:  s.build_validation?.stub === true,
    })),
    storageBuilds,
    storageThumbnails,
  };
};

/**
 * POST /simulation-catalogs/storage-relink
 * body: { mappings: [{ simulationId, buildUuid?, thumbnailFilename? }] }
 * Points existing simulation rows at real files already on the storage
 * volume. Validates each build folder / thumbnail file exists before
 * writing anything; per-mapping errors don't abort the rest of the batch.
 */
exports.relinkSimulations = async (mappings, actor, baseUrl = '') => {
  requireManageGlobal(actor);

  if (!Array.isArray(mappings) || mappings.length === 0) {
    throw ApiError.badRequest('mappings[] is required.');
  }

  const results = [];

  for (const m of mappings) {
    const { simulationId, buildUuid, thumbnailFilename } = m ?? {};
    if (!simulationId) {
      results.push({ simulationId: simulationId ?? null, success: false, error: 'simulationId is required.' });
      continue;
    }

    const sim = await SimulationModel.findById(simulationId);
    if (!sim) {
      results.push({ simulationId, success: false, error: 'Simulation not found.' });
      continue;
    }

    const updates = {};

    if (buildUuid) {
      const buildDir = webglSvc.getBuildPath(buildUuid);
      if (!fs.existsSync(buildDir)) {
        results.push({ simulationId, success: false, error: `Build folder not found: ${buildUuid}` });
        continue;
      }

      let validation;
      try {
        validation = await webglSvc.validateWebGLStructure(buildDir);
      } catch (err) {
        results.push({ simulationId, success: false, error: `Validation failed: ${err.message}` });
        continue;
      }
      if (!validation.checklist?.indexHtml) {
        results.push({ simulationId, success: false, error: `No index.html found under ${buildUuid}.` });
        continue;
      }

      let entryFile = 'index.html';
      if (validation.checklist.wrapperFolder) {
        const rel = path.relative(buildDir, validation.checklist.wrapperFolder);
        entryFile = `${rel}/index.html`.replace(/\\/g, '/');
      }

      updates.build_uuid        = buildUuid;
      updates.storage_path      = buildDir;
      updates.public_entry_url  = webglSvc.getPublicEntryUrl(buildUuid, entryFile);
      updates.entry_file        = entryFile;
      updates.build_status      = 'ready';
      updates.build_validation  = validation;
      updates.launch_type       = 'webgl';
    }

    if (thumbnailFilename) {
      const thumbPath = path.join(config.storage.thumbnailsDirAbs, thumbnailFilename);
      if (!fs.existsSync(thumbPath)) {
        results.push({ simulationId, success: false, error: `Thumbnail not found: ${thumbnailFilename}` });
        continue;
      }
      updates.thumbnail_url = `${baseUrl}${config.storage.thumbnailsUrlPrefix}/${thumbnailFilename}`;
    }

    if (Object.keys(updates).length === 0) {
      results.push({ simulationId, success: false, error: 'Provide buildUuid and/or thumbnailFilename.' });
      continue;
    }

    const updated = await SimulationModel.update(simulationId, updates);

    await AuditModel.log({
      institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
      action: 'simulation.storage_relinked', entityType: 'Simulation', entityId: simulationId,
      delta: {
        before: { buildUuid: sim.build_uuid, thumbnailUrl: sim.thumbnail_url },
        after:  updates,
      },
    }).catch(() => {});

    results.push({ simulationId, title: sim.title, success: true, simulation: mapSimulation(updated) });
  }

  return { results };
};
