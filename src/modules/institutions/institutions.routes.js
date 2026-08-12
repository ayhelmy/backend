'use strict';

/**
 * Institutions routes — SRS §4.4 INST-01 to INST-07.
 * RBAC v2: permission-based + institution scope guards.
 *
 * Institutions:
 *   GET    /                      list all (super_admin: institutions.view_all)
 *   POST   /                      create (super_admin: institutions.create)
 *   GET    /:id                   get one (own institution or super_admin)
 *   PATCH  /:id                   update branding (institutions.manage_own or manage_all)
 *   DELETE /:id                   soft-delete (institutions.manage_all)
 *
 * Departments:
 *   GET    /:id/departments
 *   POST   /:id/departments       (departments.create)
 *   PATCH  /:id/departments/:deptId
 *   DELETE /:id/departments/:deptId
 *
 * Academic Terms, Learning Domains, Email Domains:
 *   All require platform.settings.manage or institutions.manage_own
 */
'use strict';

const { Router }    = require('express');
const c             = require('./institutions.controller');
const catalogSvc    = require('../simulation-catalogs/catalog.service');
const authenticate  = require('../../middleware/authenticate');
const { requirePermission, requireAnyPermission, requireInstitutionScope } = require('../../middleware/authorize');
const { body }      = require('express-validator');
const validate      = require('../../middleware/validate');
const v             = require('./institutions.validators');
const ApiResponse   = require('../../utils/apiResponse');

const router = Router();
router.use(authenticate);

// ── Institutions ──────────────────────────────────────────────────────────────
router.get('/',      requirePermission('institutions.view_all'),    c.list);
router.post('/',     requirePermission('institutions.create'),      v.create, validate, c.create);
router.get('/:id',   requireAnyPermission('institutions.view_all', 'institutions.view_own'), requireInstitutionScope(), c.getOne);
router.patch('/:id', requireAnyPermission('institutions.manage_all', 'institutions.manage_own'), requireInstitutionScope(), v.update, validate, c.update);
router.delete('/:id',requirePermission('institutions.manage_all'), c.remove);

// ── Departments ───────────────────────────────────────────────────────────────
router.get('/:id/departments',            requireAnyPermission('institutions.view_own', 'departments.view'), requireInstitutionScope(), c.listDepartments);
router.post('/:id/departments',           requirePermission('departments.create'), requireInstitutionScope(), v.createDept, validate, c.createDepartment);
router.patch('/:id/departments/:deptId',  requirePermission('departments.manage'), requireInstitutionScope(), v.updateDept, validate, c.updateDepartment);
router.delete('/:id/departments/:deptId', requirePermission('departments.manage'), requireInstitutionScope(), c.removeDepartment);

// ── Department → Simulation Catalog assignment ────────────────────────────────
// GET  /institutions/:id/departments/:deptId/simulation-catalogs  — view assignments
// POST /institutions/:id/departments/:deptId/simulation-catalogs  — assign catalog
// DELETE /institutions/:id/departments/:deptId/simulation-catalogs/:catalogId — revoke

router.get('/me/departments/:deptId/simulation-catalogs',
  requireAnyPermission('departments.view', 'departments.manage', 'simulation_catalogs.view_assigned'),
  async (req, res, next) => {
    try {
      ApiResponse.ok(res, 'Department simulation catalogs',
        await catalogSvc.listDepartmentCatalogAssignments(req.params.deptId, req.user));
    } catch (e) { next(e); }
  },
);

router.get('/:id/departments/:deptId/simulation-catalogs',
  requireAnyPermission('departments.view', 'departments.manage', 'simulation_catalogs.view_assigned', 'simulation_catalogs.manage_global'),
  requireInstitutionScope(),
  async (req, res, next) => {
    try {
      ApiResponse.ok(res, 'Department simulation catalogs',
        await catalogSvc.listDepartmentCatalogAssignments(req.params.deptId, req.user));
    } catch (e) { next(e); }
  },
);

router.post('/:id/departments/:deptId/simulation-catalogs',
  requireAnyPermission('departments.manage', 'simulation_catalogs.manage_global'),
  requireInstitutionScope(),
  body('catalogId').isUUID().withMessage('catalogId must be a valid UUID'),
  body('includeSubtree').optional().isBoolean(),
  validate,
  async (req, res, next) => {
    try {
      ApiResponse.created(res, 'Catalog assigned to department',
        await catalogSvc.assignCatalogToDepartment(req.params.deptId, req.body, req.user));
    } catch (e) { next(e); }
  },
);

router.delete('/:id/departments/:deptId/simulation-catalogs/:catalogId',
  requireAnyPermission('departments.manage', 'simulation_catalogs.manage_global'),
  requireInstitutionScope(),
  async (req, res, next) => {
    try {
      await catalogSvc.revokeCatalogFromDepartment(req.params.deptId, req.params.catalogId, req.user);
      ApiResponse.noContent(res);
    } catch (e) { next(e); }
  },
);

// ── Academic Terms ────────────────────────────────────────────────────────────
router.get('/:id/terms',           requireAnyPermission('institutions.view_own', 'departments.view'), requireInstitutionScope(), c.listTerms);
router.post('/:id/terms',          requireAnyPermission('institutions.manage_own', 'platform.settings.manage'), requireInstitutionScope(), v.createTerm, validate, c.createTerm);
router.patch('/:id/terms/:termId', requireAnyPermission('institutions.manage_own', 'platform.settings.manage'), requireInstitutionScope(), v.updateTerm, validate, c.updateTerm);
router.delete('/:id/terms/:termId',requireAnyPermission('institutions.manage_own', 'platform.settings.manage'), requireInstitutionScope(), c.removeTerm);

// ── Learning Domains ──────────────────────────────────────────────────────────
router.get('/:id/domains',              requireAnyPermission('institutions.view_own', 'departments.view'), requireInstitutionScope(), c.listDomains);
router.post('/:id/domains',             requireAnyPermission('institutions.manage_own', 'platform.settings.manage'), requireInstitutionScope(), v.createDomain, validate, c.createDomain);
router.patch('/:id/domains/:domainId',  requireAnyPermission('institutions.manage_own', 'platform.settings.manage'), requireInstitutionScope(), v.updateDomain, validate, c.updateDomain);
router.delete('/:id/domains/:domainId', requireAnyPermission('institutions.manage_own', 'platform.settings.manage'), requireInstitutionScope(), c.removeDomain);

// ── Email Registration Domains ────────────────────────────────────────────────
router.get('/:id/email-domains',              requireAnyPermission('institutions.view_own', 'institutions.view_all'), requireInstitutionScope(), c.listEmailDomains);
router.post('/:id/email-domains',             requireAnyPermission('institutions.manage_own', 'platform.settings.manage'), requireInstitutionScope(), v.addEmailDomain, validate, c.addEmailDomain);
router.delete('/:id/email-domains/:domainId', requireAnyPermission('institutions.manage_own', 'platform.settings.manage'), requireInstitutionScope(), c.removeEmailDomain);

// ── Simulation Catalog assignment ─────────────────────────────────────────────
// GET  /institutions/me/simulation-catalogs         — any role with view_assigned
// GET  /institutions/:id/simulation-catalogs        — scoped to own institution
// POST /institutions/:id/simulation-catalogs        — assign_to_institution only
// DELETE /institutions/:id/simulation-catalogs/:catalogId — assign_to_institution only

router.get('/me/simulation-catalogs',
  requireAnyPermission('simulation_catalogs.view_assigned', 'simulations.view_catalog', 'simulation_catalogs.manage_global'),
  async (req, res, next) => {
    try {
      ApiResponse.ok(res, 'Institution simulation catalogs',
        await catalogSvc.listForInstitution(req.user.institutionId, req.user));
    } catch (e) { next(e); }
  },
);

router.get('/:id/simulation-catalogs',
  requireAnyPermission('simulation_catalogs.view_assigned', 'simulations.view_catalog', 'simulation_catalogs.manage_global'),
  requireInstitutionScope(),
  async (req, res, next) => {
    try {
      ApiResponse.ok(res, 'Institution simulation catalogs',
        await catalogSvc.listForInstitution(req.params.id, req.user));
    } catch (e) { next(e); }
  },
);

router.post('/:id/simulation-catalogs',
  requirePermission('simulation_catalogs.assign_to_institution'),
  body('catalogId').isUUID().withMessage('catalogId must be a valid UUID'),
  validate,
  async (req, res, next) => {
    try {
      ApiResponse.created(res, 'Catalog assigned to institution',
        await catalogSvc.assignToInstitution(req.body.catalogId, { institutionId: req.params.id }, req.user));
    } catch (e) { next(e); }
  },
);

router.delete('/:id/simulation-catalogs/:catalogId',
  requirePermission('simulation_catalogs.assign_to_institution'),
  async (req, res, next) => {
    try {
      await catalogSvc.revokeFromInstitution(req.params.catalogId, req.params.id, req.user);
      ApiResponse.noContent(res);
    } catch (e) { next(e); }
  },
);

module.exports = router;
