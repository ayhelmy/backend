'use strict';

const { pool }                         = require('../../config/database');
const { SemesterTermModel, AuditModel, CourseModel } = require('../../db/models');
const ApiError                         = require('../../utils/apiError');

function mapTerm(row) {
  return {
    id:               row.id,
    institutionId:    row.institution_id,
    departmentId:     row.department_id,
    academicYearId:   row.academic_year_id,
    name:             row.name,
    code:             row.code             ?? null,
    termOrder:        row.term_order,
    status:           row.status,
    startDate:        row.start_date       ?? null,
    endDate:          row.end_date         ?? null,
    createdBy:        row.created_by       ?? null,
    createdAt:        row.created_at,
    updatedAt:        row.updated_at,
    // joined fields (optional)
    academicYearName: row.academic_year_name ?? undefined,
    academicYearCode: row.academic_year_code ?? undefined,
    yearOrder:        row.year_order         ?? undefined,
  };
}

async function assertYearScope(academicYearId, actor) {
  const isSuperAdmin = actor.roles?.includes('super_admin');
  const { rows } = await pool.query(
    `SELECT institution_id FROM academic_years WHERE id = $1 AND deleted_at IS NULL`,
    [academicYearId],
  );
  if (!rows.length) throw ApiError.notFound('Academic year not found.');
  if (!isSuperAdmin && rows[0].institution_id !== actor.institutionId) {
    throw ApiError.forbidden('Academic year does not belong to your institution.');
  }
  return rows[0];
}

// ── list ──────────────────────────────────────────────────────────────────────

exports.list = async (academicYearId, query, actor) => {
  await assertYearScope(academicYearId, actor);
  const rows = await SemesterTermModel.listByAcademicYear(academicYearId, { status: query.status });
  return rows.map(mapTerm);
};

// ── getOne ────────────────────────────────────────────────────────────────────

exports.getOne = async (id, actor) => {
  const row = await SemesterTermModel.findById(id);
  if (!row) throw ApiError.notFound('Semester term not found.');
  const isSuperAdmin = actor.roles?.includes('super_admin');
  if (!isSuperAdmin && row.institution_id !== actor.institutionId) {
    throw ApiError.forbidden('Access denied.');
  }
  return mapTerm(row);
};

// ── create ────────────────────────────────────────────────────────────────────

exports.create = async (academicYearId, body, actor) => {
  const yearRow = await assertYearScope(academicYearId, actor);

  // Load academic year to get department_id
  const { rows: [ay] } = await pool.query(
    `SELECT id, institution_id, department_id FROM academic_years WHERE id = $1`,
    [academicYearId],
  );

  const row = await SemesterTermModel.create({
    institutionId:   ay.institution_id,
    departmentId:    ay.department_id,
    academicYearId,
    name:      body.name,
    code:      body.code       ?? null,
    termOrder: body.termOrder  ?? body.term_order ?? 1,
    status:    body.status     ?? 'active',
    startDate: body.startDate  ?? body.start_date ?? null,
    endDate:   body.endDate    ?? body.end_date   ?? null,
    createdBy: actor.id,
  });

  await AuditModel.log({
    institutionId: ay.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'semester_term.create', entityType: 'SemesterTerm', entityId: row.id,
    delta: { after: { name: row.name, academicYearId } },
  });

  return mapTerm(row);
};

// ── update ────────────────────────────────────────────────────────────────────

exports.update = async (id, body, actor) => {
  const existing = await SemesterTermModel.findById(id);
  if (!existing) throw ApiError.notFound('Semester term not found.');
  const isSuperAdmin = actor.roles?.includes('super_admin');
  if (!isSuperAdmin && existing.institution_id !== actor.institutionId) throw ApiError.forbidden('Access denied.');

  const row = await SemesterTermModel.update(id, {
    name:       body.name,
    code:       body.code,
    term_order: body.termOrder ?? body.term_order,
    status:     body.status,
    start_date: body.startDate ?? body.start_date,
    end_date:   body.endDate   ?? body.end_date,
  });

  await AuditModel.log({
    institutionId: existing.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'semester_term.update', entityType: 'SemesterTerm', entityId: id,
    delta: { before: { name: existing.name, status: existing.status }, after: body },
  });

  return mapTerm(row);
};

// ── remove ────────────────────────────────────────────────────────────────────

exports.remove = async (id, actor) => {
  const existing = await SemesterTermModel.findById(id);
  if (!existing) throw ApiError.notFound('Semester term not found.');
  const isSuperAdmin = actor.roles?.includes('super_admin');
  if (!isSuperAdmin && existing.institution_id !== actor.institutionId) throw ApiError.forbidden('Access denied.');

  const { rows: [{ cnt }] } = await pool.query(
    `SELECT COUNT(*) AS cnt FROM courses WHERE semester_term_id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (parseInt(cnt, 10) > 0) {
    throw ApiError.badRequest('Cannot delete semester term with existing courses. Archive it instead.');
  }

  await SemesterTermModel.softDelete(id);

  await AuditModel.log({
    institutionId: existing.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'semester_term.delete', entityType: 'SemesterTerm', entityId: id,
    delta: { before: { name: existing.name } },
  });
};

// ── getCourses — list courses under a semester term ───────────────────────────

exports.getCourses = async (termId, query, actor) => {
  const term = await SemesterTermModel.findById(termId);
  if (!term) throw ApiError.notFound('Semester term not found.');

  const isSuperAdmin = actor.roles?.includes('super_admin');
  const isAdmin      = actor.roles?.includes('institution_admin');
  const isStudent    = actor.roles?.includes('student');
  const isInstructor = actor.roles?.includes('instructor');

  if (!isSuperAdmin && term.institution_id !== actor.institutionId) {
    throw ApiError.forbidden('Access denied.');
  }

  // Students can only access courses in their current assigned semester term
  if (isStudent) {
    const { rows: [assignment] } = await pool.query(
      `SELECT semester_term_id FROM user_academic_assignments
        WHERE user_id = $1 AND role_context = 'student' AND is_current = TRUE LIMIT 1`,
      [actor.id],
    );
    if (!assignment || assignment.semester_term_id !== termId) {
      throw ApiError.forbidden('You can only access courses in your assigned semester term.');
    }
  }

  const rows = await CourseModel.list({
    institutionId:  isSuperAdmin ? null : actor.institutionId,
    semesterTermId: termId,
    status:         isStudent ? 'published' : (query.status || undefined),
    instructorId:   isInstructor && !isAdmin && !isSuperAdmin ? actor.id : undefined,
    limit:          parseInt(query.limit, 10) || 50,
    offset:         parseInt(query.offset, 10) || 0,
  });

  return rows;
};
