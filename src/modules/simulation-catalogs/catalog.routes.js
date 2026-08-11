'use strict';

/**
 * Simulation Catalog routes — SRS §4.7 SIM-01; RBAC v2.
 *
 * Public (no auth):
 *   GET  /simulation-catalogs/demo-tree
 *
 * Authenticated read (view_assigned | manage_global | simulations.view_catalog):
 *   GET  /simulation-catalogs/tree
 *   GET  /simulation-catalogs/assigned-tree
 *   GET  /simulation-catalogs/:id/tree
 *   GET  /simulation-catalogs/:id/items
 *   GET  /simulation-catalogs/:id
 *
 * Super Admin only (manage_global):
 *   GET    /simulation-catalogs           flat list (backward compat)
 *   POST   /simulation-catalogs           create root or sub-catalog
 *   PATCH  /simulation-catalogs/:id
 *   PATCH  /simulation-catalogs/:id/move
 *   PATCH  /simulation-catalogs/:id/reorder
 *   DELETE /simulation-catalogs/:id
 *   POST/DELETE /simulation-catalogs/:id/items[/:simulationId]
 *   GET/POST/DELETE /simulation-catalogs/:id/institutions[/:institutionId]
 */

const { Router } = require('express');
const c           = require('./catalog.controller');
const authenticate     = require('../../middleware/authenticate');
const { requirePermission, requireAnyPermission } = require('../../middleware/authorize');
const validate         = require('../../middleware/validate');
const v                = require('./catalog.validators');
const { handleZipUpload, handleImageUpload, handleClickRegionsUpload } = require('../../middleware/upload');

const router = Router();

// ── Public ────────────────────────────────────────────────────────────────────
router.get('/demo-tree', c.getDemoTree);

// All subsequent routes require authentication
router.use(authenticate);

const canView   = requireAnyPermission(
  'simulation_catalogs.view_assigned',
  'simulation_catalogs.manage_global',
  'simulations.view_catalog',
);
const canManage = requirePermission('simulation_catalogs.manage_global');

// ── Read (any authenticated user with view permission) ────────────────────────
router.get('/tree',          canView, c.getTree);
router.get('/assigned-tree', canView, c.getInstitutionTree);

// ── Super Admin flat list & create (keep before /:id to avoid shadowing) ──────
router.get('/',  canManage, c.listCatalogs);
router.post('/', canManage, v.createCatalog, validate, c.createCatalog);

// ── Storage recovery tool (keep before /:id to avoid shadowing) ───────────────
router.get('/storage-scan',    canManage, c.scanStorage);
router.post('/storage-relink', canManage, c.relinkSimulations);

// ── Parameterized read ────────────────────────────────────────────────────────
router.get('/:id/tree',  canView, c.getSubtree);
router.get('/:id/items', canView, c.listItems);
router.get('/:id',       canView, c.getCatalog);

// ── Super Admin writes ────────────────────────────────────────────────────────
router.patch('/:id/move',    canManage, v.moveCatalog,    validate, c.moveCatalog);
router.patch('/:id/reorder', canManage, v.reorderCatalog, validate, c.reorderCatalog);
router.patch('/:id',         canManage, v.updateCatalog,  validate, c.updateCatalog);
router.delete('/:id',        canManage, c.deleteCatalog);

// ── Simulation CRUD within catalog (new flow) ─────────────────────────────────
router.get('/:id/simulations',                        canView,   c.getCatalogSimulations);
// WebGL upload — MUST be before /:id/simulations POST to avoid param shadowing is not an issue here,
// but keep it explicit so the upload middleware runs before validation.
router.post('/:id/simulations/webgl-upload',          canManage, handleZipUpload, v.webglUpload, validate, c.uploadWebGLSimulation);
router.post('/:id/simulations',                       canManage, v.createSimulationInCatalog, validate, c.createSimulationInCatalog);
router.patch('/:id/simulations/:simId/thumbnail',     canManage, handleImageUpload, c.uploadSimulationThumbnail);
router.patch('/:id/simulations/:simId/click-regions', canManage, handleClickRegionsUpload, c.uploadClickRegions);
router.get('/:id/simulations/:simId/steps',           canManage, c.getSimulationSteps);
router.put('/:id/simulations/:simId/steps',           canManage, c.saveSimulationSteps);
router.patch('/:id/simulations/:simId',               canManage, v.updateSimulationInCatalog, validate, c.updateCatalogSimulation);
router.delete('/:id/simulations/:simId',              canManage, c.removeCatalogSimulation);

// ── Items (legacy — links existing simulations; prefer /simulations above) ────
router.post('/:id/items',                  canManage, v.addItem, validate, c.addItem);
router.delete('/:id/items/:simulationId',  canManage, c.removeItem);

// ── Institution assignment ────────────────────────────────────────────────────
router.get('/:id/institutions',                                        canManage, c.listAssignedInstitutions);
router.post('/:id/institutions',                                       canManage, v.assignToInstitution, validate, c.assignToInstitution);
// Impact preview — must come BEFORE /:institutionId DELETE to avoid param shadowing
router.get('/:id/institutions/:institutionId/unassign-impact',         canManage, c.getUnassignImpact);
router.delete('/:id/institutions/:institutionId',                      canManage, c.revokeFromInstitution);

module.exports = router;
