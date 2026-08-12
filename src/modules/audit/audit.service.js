'use strict';

// SRS §4.15 AUD-01 to AUD-05. Table is insert-only. No UPDATE/DELETE allowed on audit_logs.

const AuditModel = require('../../db/models/audit.model');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const { ROLES } = require('../../constants/roles');
const ApiError = require('../../utils/apiError');

exports.list = async (query, actor) => {
  const { page, limit, offset } = parsePagination(query);
  const isSuperAdmin = actor.roles?.includes(ROLES.SUPER_ADMIN);
  const filters = {
    institutionId: isSuperAdmin ? (query.institutionId || undefined) : actor.institutionId,
    actorId: query.actorId || undefined,
    entityType: query.entityType || undefined,
    entityId: query.entityId || undefined,
    action: query.action || undefined,
  };

  const [items, total] = await Promise.all([
    AuditModel.list({ ...filters, limit, offset }),
    AuditModel.count(filters),
  ]);

  return { items, meta: buildPaginationMeta(total, page, limit) };
};

exports.getOne = async (id, actor) => {
  const entry = await AuditModel.findById(id);
  if (!entry) throw ApiError.notFound('Audit log entry not found');

  const isSuperAdmin = actor.roles?.includes(ROLES.SUPER_ADMIN);
  // Cross-institution lookups 404 rather than 403, matching scopeGuards.js convention
  // (avoids leaking existence of entries outside the actor's tenant).
  if (!isSuperAdmin && entry.institution_id !== actor.institutionId) {
    throw ApiError.notFound('Audit log entry not found');
  }

  return entry;
};

// Internal helper — called by other services to record events
exports.log = async (entry) => AuditModel.log(entry);
