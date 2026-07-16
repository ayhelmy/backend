'use strict';

/**
 * Institutions service — SRS §4.4 INST-01 to INST-07; §9 schema.
 * Multi-tenant isolation: institution_admin is scoped to their own institution.
 * Super admin can manage all institutions.
 */

const { pool }            = require('../../config/database');
const { InstitutionModel, AuditModel } = require('../../db/models');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const ApiError            = require('../../utils/apiError');

// ── Mappers ───────────────────────────────────────────────────────────────────

function mapInstitution(row) {
  return {
    id:               row.id,
    name:             row.name,
    slug:             row.slug,
    domain:           row.domain           ?? null,
    logoUrl:          row.logo_url         ?? null,
    primaryColor:     row.primary_color,
    timezone:         row.timezone,
    locale:           row.locale,
    subscriptionPlan: row.subscription_plan,
    maxUsers:         row.max_users,
    maxStorageGb:     Number(row.max_storage_gb),
    status:           row.status,
    settings:         row.settings         ?? {},
    createdAt:        row.created_at,
    updatedAt:        row.updated_at,
    ...(row.user_count !== undefined && { userCount: Number(row.user_count) }),
    ...(row.dept_count !== undefined && { deptCount: Number(row.dept_count) }),
  };
}

function mapDept(row) {
  return {
    id:            row.id,
    institutionId: row.institution_id,
    name:          row.name,
    code:          row.code      ?? null,
    parentId:      row.parent_id ?? null,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
  };
}

function mapTerm(row) {
  return {
    id:            row.id,
    institutionId: row.institution_id,
    name:          row.name,
    startDate:     row.start_date,
    endDate:       row.end_date,
    isCurrent:     row.is_current,
    createdAt:     row.created_at,
  };
}

function mapDomain(row) {
  return {
    id:            row.id,
    institutionId: row.institution_id ?? null,
    name:          row.name,
    description:   row.description   ?? null,
    iconUrl:       row.icon_url      ?? null,
    color:         row.color,
    isGlobal:      row.institution_id === null,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
  };
}

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function assertInstAccess(instId, actor) {
  if (!actor.roles?.includes('super_admin') && actor.institutionId !== instId) {
    throw ApiError.forbidden('You can only manage your own institution.');
  }
}

// ── Institution CRUD ──────────────────────────────────────────────────────────

exports.list = async (query) => {
  const { page, limit, offset } = parsePagination(query);
  const { status, search } = query;

  const baseParams = [];
  const filters = ['i.deleted_at IS NULL'];

  if (status) {
    baseParams.push(status);
    filters.push(`i.status = $${baseParams.length}`);
  }
  if (search) {
    baseParams.push(`%${search.toLowerCase()}%`);
    const idx = baseParams.length;
    filters.push(`(LOWER(i.name) LIKE $${idx} OR LOWER(i.slug) LIKE $${idx})`);
  }

  const where = filters.join(' AND ');

  const { rows: [countRow] } = await pool.query(
    `SELECT COUNT(*) FROM institutions i WHERE ${where}`, baseParams,
  );

  const mainParams = [...baseParams, limit, offset];
  const { rows } = await pool.query(`
    SELECT i.id, i.name, i.slug, i.domain, i.logo_url, i.primary_color, i.status,
           i.subscription_plan, i.max_users, i.max_storage_gb, i.timezone, i.locale,
           i.settings, i.created_at, i.updated_at,
           COUNT(DISTINCT u.id) AS user_count,
           COUNT(DISTINCT d.id) AS dept_count
      FROM institutions i
      LEFT JOIN users       u ON u.institution_id = i.id AND u.deleted_at IS NULL
      LEFT JOIN departments d ON d.institution_id = i.id AND d.deleted_at IS NULL
     WHERE ${where}
     GROUP BY i.id
     ORDER BY i.name
     LIMIT $${mainParams.length - 1} OFFSET $${mainParams.length}
  `, mainParams);

  return {
    institutions: rows.map(mapInstitution),
    meta: buildPaginationMeta(Number(countRow.count), page, limit),
  };
};

exports.create = async (body, actor) => {
  const { name, slug: rawSlug, domain, logoUrl, primaryColor, timezone, locale, subscriptionPlan, maxUsers } = body;

  const slug = (rawSlug ? rawSlug.trim() : slugify(name)).replace(/[^a-z0-9-]/g, '');
  if (!slug) throw ApiError.badRequest('Could not generate a valid slug from the name provided.');

  const existing = await InstitutionModel.findBySlug(slug);
  if (existing) throw ApiError.conflict('An institution with this slug already exists.');

  const { rows } = await pool.query(
    `INSERT INTO institutions
       (name, slug, domain, logo_url, primary_color, timezone, locale,
        subscription_plan, max_users, settings)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      name.trim(), slug,
      domain       ?? null,
      logoUrl      ?? null,
      primaryColor ?? '#0057B7',
      timezone     ?? 'UTC',
      locale       ?? 'en',
      subscriptionPlan ?? 'trial',
      maxUsers     ?? 100,
      JSON.stringify({}),
    ],
  );
  const inst = rows[0];

  await AuditModel.log({
    institutionId: inst.id,
    actorId:    actor?.id    ?? null,
    actorEmail: actor?.email ?? 'system',
    action: 'institution.create', entityType: 'Institution', entityId: inst.id,
    delta: { after: { name: inst.name, slug: inst.slug } },
  });

  return mapInstitution(inst);
};

exports.getOne = async (id, actor) => {
  assertInstAccess(id, actor);
  const row = await InstitutionModel.findById(id);
  if (!row) throw ApiError.notFound('Institution not found.');
  return mapInstitution(row);
};

exports.update = async (id, body, actor) => {
  assertInstAccess(id, actor);

  const before = await InstitutionModel.findById(id);
  if (!before) throw ApiError.notFound('Institution not found.');

  const isSuperAdmin = actor.roles?.includes('super_admin');
  const fields = {};

  if (body.name         !== undefined) fields.name          = body.name.trim();
  if (body.domain       !== undefined) fields.domain        = body.domain;
  if (body.logoUrl      !== undefined) fields.logo_url      = body.logoUrl;
  if (body.primaryColor !== undefined) fields.primary_color = body.primaryColor;
  if (body.timezone     !== undefined) fields.timezone      = body.timezone;
  if (body.locale       !== undefined) fields.locale        = body.locale;
  if (body.settings     !== undefined) fields.settings      = body.settings;

  if (isSuperAdmin) {
    if (body.subscriptionPlan !== undefined) fields.subscription_plan = body.subscriptionPlan;
    if (body.maxUsers         !== undefined) fields.max_users         = body.maxUsers;
    if (body.status           !== undefined) fields.status            = body.status;
  }

  if (!Object.keys(fields).length) return mapInstitution(before);

  const after = await InstitutionModel.update(id, fields);

  await AuditModel.log({
    institutionId: id,
    actorId: actor.id, actorEmail: actor.email,
    action: 'institution.update', entityType: 'Institution', entityId: id,
    delta: { before: { name: before.name, status: before.status }, after: fields },
  });

  return mapInstitution(after);
};

exports.remove = async (id) => {
  const row = await InstitutionModel.softDelete(id);
  if (!row) throw ApiError.notFound('Institution not found.');
};

// ── Departments ───────────────────────────────────────────────────────────────

exports.listDepartments = async (instId) => {
  const { rows } = await pool.query(
    `SELECT id, institution_id, name, code, parent_id, created_at, updated_at
       FROM departments
      WHERE institution_id = $1 AND deleted_at IS NULL
      ORDER BY name`,
    [instId],
  );
  return rows.map(mapDept);
};

exports.createDepartment = async (instId, body, actor) => {
  const { name, code, parentId } = body;

  if (code) {
    const upperCode = code.trim().toUpperCase();
    const { rows: dup } = await pool.query(
      `SELECT id FROM departments WHERE institution_id = $1 AND code = $2 AND deleted_at IS NULL`,
      [instId, upperCode],
    );
    if (dup.length) throw ApiError.conflict('A department with this code already exists.');
  }

  const { rows } = await pool.query(
    `INSERT INTO departments (institution_id, name, code, parent_id)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [instId, name.trim(), code ? code.trim().toUpperCase() : null, parentId ?? null],
  );

  await AuditModel.log({
    institutionId: instId,
    actorId: actor.id, actorEmail: actor.email,
    action: 'department.create', entityType: 'Department', entityId: rows[0].id,
    delta: { after: { name: rows[0].name, code: rows[0].code } },
  });

  return mapDept(rows[0]);
};

exports.updateDepartment = async (deptId, body) => {
  const { name, code, parentId } = body;
  const sets   = [];
  const params = [];

  if (name     !== undefined) { params.push(name.trim()); sets.push(`name = $${params.length}`); }
  if (code     !== undefined) { params.push(code ? code.trim().toUpperCase() : null); sets.push(`code = $${params.length}`); }
  if (parentId !== undefined) { params.push(parentId); sets.push(`parent_id = $${params.length}`); }

  if (!sets.length) throw ApiError.badRequest('No fields to update.');

  params.push(deptId);
  const { rows } = await pool.query(
    `UPDATE departments SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length} AND deleted_at IS NULL
      RETURNING *`,
    params,
  );
  if (!rows.length) throw ApiError.notFound('Department not found.');
  return mapDept(rows[0]);
};

exports.removeDepartment = async (deptId) => {
  const { rows } = await pool.query(
    `UPDATE departments SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [deptId],
  );
  if (!rows.length) throw ApiError.notFound('Department not found.');
};

// ── Academic Terms ────────────────────────────────────────────────────────────

exports.listTerms = async (instId) => {
  const { rows } = await pool.query(
    `SELECT id, institution_id, name, start_date, end_date, is_current, created_at
       FROM academic_terms
      WHERE institution_id = $1
      ORDER BY start_date DESC`,
    [instId],
  );
  return rows.map(mapTerm);
};

exports.createTerm = async (instId, body) => {
  const { name, startDate, endDate, isCurrent = false } = body;

  if (new Date(endDate) <= new Date(startDate)) {
    throw ApiError.badRequest('End date must be after start date.');
  }

  if (isCurrent) {
    await pool.query(`UPDATE academic_terms SET is_current = FALSE WHERE institution_id = $1`, [instId]);
  }

  const { rows } = await pool.query(
    `INSERT INTO academic_terms (institution_id, name, start_date, end_date, is_current)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [instId, name.trim(), startDate, endDate, isCurrent],
  );
  return mapTerm(rows[0]);
};

exports.updateTerm = async (termId, body) => {
  const { name, startDate, endDate, isCurrent } = body;
  const sets   = [];
  const params = [];

  if (name      !== undefined) { params.push(name.trim()); sets.push(`name = $${params.length}`); }
  if (startDate !== undefined) { params.push(startDate);   sets.push(`start_date = $${params.length}`); }
  if (endDate   !== undefined) { params.push(endDate);     sets.push(`end_date = $${params.length}`); }
  if (isCurrent !== undefined) { params.push(isCurrent);   sets.push(`is_current = $${params.length}`); }

  if (!sets.length) throw ApiError.badRequest('No fields to update.');

  if (isCurrent) {
    const { rows: tr } = await pool.query(`SELECT institution_id FROM academic_terms WHERE id = $1`, [termId]);
    if (tr.length) {
      await pool.query(
        `UPDATE academic_terms SET is_current = FALSE WHERE institution_id = $1 AND id != $2`,
        [tr[0].institution_id, termId],
      );
    }
  }

  params.push(termId);
  const { rows } = await pool.query(
    `UPDATE academic_terms SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  if (!rows.length) throw ApiError.notFound('Academic term not found.');
  return mapTerm(rows[0]);
};

exports.removeTerm = async (termId) => {
  const { rows } = await pool.query(`DELETE FROM academic_terms WHERE id = $1 RETURNING id`, [termId]);
  if (!rows.length) throw ApiError.notFound('Academic term not found.');
};

// ── Learning Subject Domains ──────────────────────────────────────────────────

exports.listDomains = async (instId) => {
  const { rows } = await pool.query(
    `SELECT id, institution_id, name, description, icon_url, color, created_at, updated_at
       FROM domains
      WHERE institution_id = $1 OR institution_id IS NULL
      ORDER BY institution_id NULLS LAST, name`,
    [instId],
  );
  return rows.map(mapDomain);
};

exports.createDomain = async (instId, body, actor) => {
  const { name, description, color, iconUrl } = body;

  const { rows: dup } = await pool.query(
    `SELECT id FROM domains WHERE institution_id = $1 AND LOWER(name) = LOWER($2)`,
    [instId, name.trim()],
  );
  if (dup.length) throw ApiError.conflict('A domain with this name already exists for this institution.');

  const { rows } = await pool.query(
    `INSERT INTO domains (institution_id, name, description, icon_url, color)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [instId, name.trim(), description ?? null, iconUrl ?? null, color ?? '#6366F1'],
  );

  await AuditModel.log({
    institutionId: instId,
    actorId: actor.id, actorEmail: actor.email,
    action: 'domain.create', entityType: 'Domain', entityId: rows[0].id,
    delta: { after: { name: rows[0].name } },
  });

  return mapDomain(rows[0]);
};

exports.updateDomain = async (domainId, instId, body) => {
  const { name, description, color, iconUrl } = body;
  const sets   = [];
  const params = [];

  if (name        !== undefined) { params.push(name.trim()); sets.push(`name = $${params.length}`); }
  if (description !== undefined) { params.push(description); sets.push(`description = $${params.length}`); }
  if (color       !== undefined) { params.push(color);       sets.push(`color = $${params.length}`); }
  if (iconUrl     !== undefined) { params.push(iconUrl);     sets.push(`icon_url = $${params.length}`); }

  if (!sets.length) throw ApiError.badRequest('No fields to update.');

  params.push(domainId, instId);
  const { rows } = await pool.query(
    `UPDATE domains SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length - 1} AND institution_id = $${params.length}
      RETURNING *`,
    params,
  );
  if (!rows.length) throw ApiError.notFound('Domain not found or is a global domain.');
  return mapDomain(rows[0]);
};

exports.removeDomain = async (domainId, instId) => {
  const { rows } = await pool.query(
    `DELETE FROM domains WHERE id = $1 AND institution_id = $2 RETURNING id`,
    [domainId, instId],
  );
  if (!rows.length) throw ApiError.notFound('Domain not found or is a global domain (cannot be deleted).');
};

// ── Email Registration Domains ────────────────────────────────────────────────

exports.listEmailDomains = async (instId) => {
  return InstitutionModel.getDomains(instId);
};

exports.addEmailDomain = async (instId, body) => {
  const { domain, isPrimary = false } = body;
  if (!domain || !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) {
    throw ApiError.badRequest('Invalid domain format. Example: university.edu');
  }
  return InstitutionModel.addDomain(instId, domain.toLowerCase().trim(), isPrimary);
};

exports.removeEmailDomain = async (instId, domainId) => {
  const { rows } = await pool.query(
    `DELETE FROM institution_domains WHERE id = $1 AND institution_id = $2 RETURNING id`,
    [domainId, instId],
  );
  if (!rows.length) throw ApiError.notFound('Email domain not found.');
};
