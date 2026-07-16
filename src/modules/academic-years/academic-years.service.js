'use strict';

const { pool }              = require('../../config/database');
const { AcademicYearModel, AuditModel } = require('../../db/models');
const ApiError              = require('../../utils/apiError');

function mapYear(row) {
  return {
    id:             row.id,
    institutionId:  row.institution_id,
    departmentId:   row.department_id,
    name:           row.name,
    code:           row.code           ?? null,
    yearOrder:      row.year_order,
    status:         row.status,
    startDate:      row.start_date     ?? null,
    endDate:        row.end_date       ?? null,
    createdBy:      row.created_by     ?? null,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
  };
}

async function assertDeptScope(departmentId, actor) {
  const isSuperAdmin = actor.roles?.includes('super_admin');
  if (isSuperAdmin) return;
  const { rows } = await pool.query(
    `SELECT institution_id FROM departments WHERE id = $1 AND deleted_at IS NULL`,
    [departmentId],
  );
  if (!rows.length) throw ApiError.notFound('Department not found.');
  if (rows[0].institution_id !== actor.institutionId) {
    throw ApiError.forbidden('Department does not belong to your institution.');
  }
}

// ── list ──────────────────────────────────────────────────────────────────────

exports.list = async (departmentId, query, actor) => {
  await assertDeptScope(departmentId, actor);
  const rows = await AcademicYearModel.listByDepartment(departmentId, { status: query.status });
  return rows.map(mapYear);
};

// ── getOne ────────────────────────────────────────────────────────────────────

exports.getOne = async (id, actor) => {
  const row = await AcademicYearModel.findById(id);
  if (!row) throw ApiError.notFound('Academic year not found.');
  const isSuperAdmin = actor.roles?.includes('super_admin');
  if (!isSuperAdmin && row.institution_id !== actor.institutionId) {
    throw ApiError.forbidden('Access denied.');
  }
  return mapYear(row);
};

// ── create ────────────────────────────────────────────────────────────────────

exports.create = async (departmentId, body, actor) => {
  await assertDeptScope(departmentId, actor);

  const { rows: [dept] } = await pool.query(
    `SELECT id, institution_id FROM departments WHERE id = $1 AND deleted_at IS NULL`,
    [departmentId],
  );
  if (!dept) throw ApiError.notFound('Department not found.');

  const row = await AcademicYearModel.create({
    institutionId: dept.institution_id,
    departmentId,
    name:      body.name,
    code:      body.code      ?? null,
    yearOrder: body.yearOrder ?? body.year_order ?? 1,
    status:    body.status    ?? 'active',
    startDate: body.startDate ?? body.start_date ?? null,
    endDate:   body.endDate   ?? body.end_date   ?? null,
    createdBy: actor.id,
  });

  await AuditModel.log({
    institutionId: dept.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'academic_year.create', entityType: 'AcademicYear', entityId: row.id,
    delta: { after: { name: row.name, departmentId } },
  });

  return mapYear(row);
};

// ── update ────────────────────────────────────────────────────────────────────

exports.update = async (id, body, actor) => {
  const existing = await AcademicYearModel.findById(id);
  if (!existing) throw ApiError.notFound('Academic year not found.');

  const isSuperAdmin = actor.roles?.includes('super_admin');
  if (!isSuperAdmin && existing.institution_id !== actor.institutionId) {
    throw ApiError.forbidden('Access denied.');
  }

  const row = await AcademicYearModel.update(id, {
    name:       body.name,
    code:       body.code,
    year_order: body.yearOrder ?? body.year_order,
    status:     body.status,
    start_date: body.startDate ?? body.start_date,
    end_date:   body.endDate   ?? body.end_date,
  });

  await AuditModel.log({
    institutionId: existing.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'academic_year.update', entityType: 'AcademicYear', entityId: id,
    delta: { before: { name: existing.name, status: existing.status }, after: body },
  });

  return mapYear(row);
};

// ── remove ────────────────────────────────────────────────────────────────────

exports.remove = async (id, actor) => {
  const existing = await AcademicYearModel.findById(id);
  if (!existing) throw ApiError.notFound('Academic year not found.');

  const isSuperAdmin = actor.roles?.includes('super_admin');
  if (!isSuperAdmin && existing.institution_id !== actor.institutionId) {
    throw ApiError.forbidden('Access denied.');
  }

  // Block deletion if courses exist under this academic year
  const { rows: [{ cnt }] } = await pool.query(
    `SELECT COUNT(*) AS cnt FROM courses WHERE academic_year_id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (parseInt(cnt, 10) > 0) {
    throw ApiError.badRequest('Cannot delete academic year with existing courses. Archive it instead.');
  }

  await AcademicYearModel.softDelete(id);

  await AuditModel.log({
    institutionId: existing.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'academic_year.delete', entityType: 'AcademicYear', entityId: id,
    delta: { before: { name: existing.name } },
  });
};
