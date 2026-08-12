/**
 * LTI platform registry — admin CRUD for lti_platforms/lti_deployments, plus
 * resolvePlatform(), the lookup both oidc-login.service.js and
 * launch-validation.service.js use to turn (issuer, client_id, deployment_id)
 * into a trusted platform + deployment row.
 */
'use strict';

const { LtiPlatformModel, AuditModel } = require('../../db/models');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const ApiError = require('../../utils/apiError');

function mapPlatform(row) {
  return {
    id:             row.id,
    institutionId:  row.institution_id,
    platformName:   row.platform_name,
    issuer:         row.issuer,
    clientId:       row.client_id,
    authLoginUrl:   row.auth_login_url,
    authTokenUrl:   row.auth_token_url,
    jwksUrl:        row.jwks_url,
    allowedScopes:  row.allowed_scopes ?? [],
    roleMapping:    row.role_mapping ?? {},
    status:         row.status,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
  };
}

function mapDeployment(row) {
  return {
    id:           row.id,
    platformId:   row.platform_id,
    deploymentId: row.deployment_id,
    label:        row.label,
    status:       row.status,
    createdAt:    row.created_at,
  };
}

function isSuperAdmin(actor) {
  return actor.roles?.includes('super_admin');
}

function assertPlatformAccess(platform, actor) {
  if (!isSuperAdmin(actor) && platform.institution_id !== actor.institutionId) {
    throw ApiError.forbidden('You can only manage LTI platforms within your own institution.');
  }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

exports.list = async (actor, query) => {
  const { page, limit, offset } = parsePagination(query);
  const institutionId = isSuperAdmin(actor) ? (query.institutionId || undefined) : actor.institutionId;

  const [rows, total] = await Promise.all([
    LtiPlatformModel.list({ institutionId, search: query.search, limit, offset }),
    LtiPlatformModel.count({ institutionId, search: query.search }),
  ]);

  return { platforms: rows.map(mapPlatform), meta: buildPaginationMeta(total, page, limit) };
};

exports.create = async (body, actor) => {
  const institutionId = isSuperAdmin(actor) ? body.institutionId : actor.institutionId;
  if (!institutionId) throw ApiError.badRequest('institutionId is required.');

  const existing = await LtiPlatformModel.findByIssuerAndClientId(body.issuer, body.clientId);
  if (existing) throw ApiError.conflict('A platform with this issuer and client ID is already registered.');

  const row = await LtiPlatformModel.create({
    institutionId,
    platformName: body.platformName,
    issuer: body.issuer,
    clientId: body.clientId,
    authLoginUrl: body.authLoginUrl,
    authTokenUrl: body.authTokenUrl,
    jwksUrl: body.jwksUrl,
    createdBy: actor.id,
  });

  await AuditModel.log({
    institutionId,
    actorId: actor.id, actorEmail: actor.email,
    action: 'lti_platform.create', entityType: 'LtiPlatform', entityId: row.id,
    delta: { after: { platformName: row.platform_name, issuer: row.issuer } },
  });

  return mapPlatform(row);
};

exports.getOne = async (id, actor) => {
  const row = await LtiPlatformModel.findById(id);
  if (!row) throw ApiError.notFound('LTI platform not found.');
  assertPlatformAccess(row, actor);

  const deployments = await LtiPlatformModel.listDeployments(id);
  return { ...mapPlatform(row), deployments: deployments.map(mapDeployment) };
};

exports.update = async (id, body, actor) => {
  const before = await LtiPlatformModel.findById(id);
  if (!before) throw ApiError.notFound('LTI platform not found.');
  assertPlatformAccess(before, actor);

  const fields = {};
  if (body.platformName  !== undefined) fields.platform_name  = body.platformName;
  if (body.issuer        !== undefined) fields.issuer         = body.issuer;
  if (body.clientId      !== undefined) fields.client_id      = body.clientId;
  if (body.authLoginUrl  !== undefined) fields.auth_login_url = body.authLoginUrl;
  if (body.authTokenUrl  !== undefined) fields.auth_token_url = body.authTokenUrl;
  if (body.jwksUrl       !== undefined) fields.jwks_url       = body.jwksUrl;

  const after = await LtiPlatformModel.update(id, fields);

  await AuditModel.log({
    institutionId: before.institution_id,
    actorId: actor.id, actorEmail: actor.email,
    action: 'lti_platform.update', entityType: 'LtiPlatform', entityId: id,
    delta: { before: { platformName: before.platform_name }, after: fields },
  });

  return mapPlatform(after);
};

exports.setStatus = async (id, status, actor) => {
  const before = await LtiPlatformModel.findById(id);
  if (!before) throw ApiError.notFound('LTI platform not found.');
  assertPlatformAccess(before, actor);

  const after = await LtiPlatformModel.setStatus(id, status);

  await AuditModel.log({
    institutionId: before.institution_id,
    actorId: actor.id, actorEmail: actor.email,
    action: status === 'active' ? 'lti_platform.activate' : 'lti_platform.deactivate',
    entityType: 'LtiPlatform', entityId: id,
    delta: { before: { status: before.status }, after: { status } },
  });

  return mapPlatform(after);
};

// ── Deployments ───────────────────────────────────────────────────────────────

exports.addDeployment = async (platformId, body, actor) => {
  const platform = await LtiPlatformModel.findById(platformId);
  if (!platform) throw ApiError.notFound('LTI platform not found.');
  assertPlatformAccess(platform, actor);

  const row = await LtiPlatformModel.addDeployment(platformId, body.deploymentId, body.label);

  await AuditModel.log({
    institutionId: platform.institution_id,
    actorId: actor.id, actorEmail: actor.email,
    action: 'lti_platform.add_deployment', entityType: 'LtiPlatform', entityId: platformId,
    delta: { after: { deploymentId: body.deploymentId } },
  });

  return mapDeployment(row);
};

exports.removeDeployment = async (platformId, deploymentId, actor) => {
  const platform = await LtiPlatformModel.findById(platformId);
  if (!platform) throw ApiError.notFound('LTI platform not found.');
  assertPlatformAccess(platform, actor);

  const row = await LtiPlatformModel.removeDeployment(platformId, deploymentId);
  if (!row) throw ApiError.notFound('Deployment not found.');

  await AuditModel.log({
    institutionId: platform.institution_id,
    actorId: actor.id, actorEmail: actor.email,
    action: 'lti_platform.remove_deployment', entityType: 'LtiPlatform', entityId: platformId,
    delta: { before: { deploymentId } },
  });
};

// ── Launch-time resolution (no actor — called from the public LTI protocol) ──

/**
 * Resolves an active platform + active deployment by (issuer, clientId, deploymentId).
 * Returns null (not a thrown error) so callers can map to the right LtiError code.
 */
exports.resolvePlatform = async ({ issuer, clientId, deploymentId }) => {
  const platform = await LtiPlatformModel.findByIssuerAndClientId(issuer, clientId);
  if (!platform || platform.status !== 'active') return { platform: null, deployment: null };

  if (!deploymentId) return { platform, deployment: null };

  const deployment = await LtiPlatformModel.findDeployment(platform.id, deploymentId);
  return { platform, deployment: deployment ?? null };
};

// ── Launch/audit log listing for the admin UI ─────────────────────────────────

exports.listLaunchLogs = async (actor, query) => {
  const { page, limit, offset } = parsePagination(query);
  const institutionId = isSuperAdmin(actor) ? (query.institutionId || undefined) : actor.institutionId;

  const [rows, total] = await Promise.all([
    AuditModel.list({ institutionId, action: 'lti.', limit, offset }),
    AuditModel.count({ institutionId, action: 'lti.' }),
  ]);

  return { logs: rows, meta: buildPaginationMeta(total, page, limit) };
};

exports.mapPlatform = mapPlatform;
exports.mapDeployment = mapDeployment;
