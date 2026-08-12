'use strict';

const svc         = require('./catalog.service');
const ApiResponse = require('../../utils/apiResponse');

// ── Tree endpoints ────────────────────────────────────────────────────────────
exports.getTree            = async (req, res, next) => { try { ApiResponse.ok(res, 'Catalog tree', await svc.getTree(req.query, req.user)); } catch (e) { next(e); } };
exports.getSubtree         = async (req, res, next) => { try { ApiResponse.ok(res, 'Catalog subtree', await svc.getSubtree(req.params.id, req.user)); } catch (e) { next(e); } };
exports.getDemoTree        = async (req, res, next) => { try { ApiResponse.ok(res, 'Demo catalog tree', await svc.getDemoTree()); } catch (e) { next(e); } };
exports.getInstitutionTree = async (req, res, next) => { try { ApiResponse.ok(res, 'Institution catalog tree', await svc.getInstitutionTree(req.params.institutionId ?? req.user.institutionId, req.user)); } catch (e) { next(e); } };

// ── Flat list (backward compat) ───────────────────────────────────────────────
exports.listCatalogs         = async (req, res, next) => { try { ApiResponse.ok(res, 'Simulation catalogs', await svc.listCatalogs(req.query, req.user)); } catch (e) { next(e); } };

// ── CRUD ──────────────────────────────────────────────────────────────────────
exports.createCatalog        = async (req, res, next) => { try { ApiResponse.created(res, 'Catalog created', await svc.createCatalog(req.body, req.user)); } catch (e) { next(e); } };
exports.getCatalog           = async (req, res, next) => { try { ApiResponse.ok(res, 'Simulation catalog', await svc.getCatalog(req.params.id, req.user)); } catch (e) { next(e); } };
exports.updateCatalog        = async (req, res, next) => { try { ApiResponse.ok(res, 'Catalog updated', await svc.updateCatalog(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.moveCatalog          = async (req, res, next) => { try { ApiResponse.ok(res, 'Catalog moved', await svc.moveCatalog(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.reorderCatalog       = async (req, res, next) => { try { ApiResponse.ok(res, 'Catalog reordered', await svc.reorderCatalog(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.deleteCatalog        = async (req, res, next) => { try { await svc.deleteCatalog(req.params.id, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };

// ── Items ─────────────────────────────────────────────────────────────────────
exports.listItems            = async (req, res, next) => { try { ApiResponse.ok(res, 'Catalog items', await svc.listItems(req.params.id, req.user)); } catch (e) { next(e); } };
exports.addItem              = async (req, res, next) => { try { ApiResponse.created(res, 'Simulation added to catalog', await svc.addItem(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.removeItem           = async (req, res, next) => { try { await svc.removeItem(req.params.id, req.params.simulationId, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };

// ── Institution assignment ────────────────────────────────────────────────────
exports.assignToInstitution      = async (req, res, next) => { try { ApiResponse.created(res, 'Catalog assigned to institution', await svc.assignToInstitution(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.revokeFromInstitution    = async (req, res, next) => { try { await svc.revokeFromInstitution(req.params.id, req.params.institutionId, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };
exports.listAssignedInstitutions = async (req, res, next) => { try { ApiResponse.ok(res, 'Assigned institutions', await svc.listAssignedInstitutions(req.params.id, req.user)); } catch (e) { next(e); } };
exports.listForInstitution       = async (req, res, next) => { try { ApiResponse.ok(res, 'Institution catalogs', await svc.listForInstitution(req.params.institutionId, req.user)); } catch (e) { next(e); } };
exports.getUnassignImpact        = async (req, res, next) => { try { ApiResponse.ok(res, 'Unassign impact', await svc.getUnassignImpact(req.params.id, req.params.institutionId, req.user)); } catch (e) { next(e); } };

// ── Simulation CRUD within catalog context ────────────────────────────────────
exports.createSimulationInCatalog    = async (req, res, next) => { try { ApiResponse.created(res, 'Simulation created in catalog', await svc.createSimulationInCatalog(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.getCatalogSimulations        = async (req, res, next) => { try { ApiResponse.ok(res, 'Catalog simulations', await svc.getCatalogSimulations(req.params.id, req.query, req.user)); } catch (e) { next(e); } };
exports.updateCatalogSimulation      = async (req, res, next) => { try { ApiResponse.ok(res, 'Simulation updated', await svc.updateCatalogSimulation(req.params.id, req.params.simId, req.body, req.user)); } catch (e) { next(e); } };
exports.removeCatalogSimulation      = async (req, res, next) => { try { await svc.removeCatalogSimulation(req.params.id, req.params.simId, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };
exports.uploadSimulationThumbnail    = async (req, res, next) => { try { ApiResponse.ok(res, 'Thumbnail uploaded', await svc.uploadSimulationThumbnail(req.params.id, req.params.simId, req.file, req.user)); } catch (e) { next(e); } };
exports.uploadClickRegions           = async (req, res, next) => { try { ApiResponse.ok(res, 'Click regions uploaded', await svc.uploadClickRegions(req.params.id, req.params.simId, req.file, req.body.regions, req.user)); } catch (e) { next(e); } };

// ── Simulation completion steps ───────────────────────────────────────────────
exports.getSimulationSteps  = async (req, res, next) => { try { ApiResponse.ok(res, 'Simulation steps', await svc.getSimulationSteps(req.params.id, req.params.simId, req.user)); } catch (e) { next(e); } };
exports.saveSimulationSteps = async (req, res, next) => { try { ApiResponse.ok(res, 'Steps saved', await svc.saveSimulationSteps(req.params.id, req.params.simId, req.body.steps, req.user)); } catch (e) { next(e); } };

// ── WebGL ZIP upload ──────────────────────────────────────────────────────────
exports.uploadWebGLSimulation = async (req, res, next) => {
  try {
    ApiResponse.created(
      res,
      'WebGL simulation uploaded and ready',
      await svc.createWebGLSimulationInCatalog(req.params.id, req.body, req.file, req.user),
    );
  } catch (e) { next(e); }
};
