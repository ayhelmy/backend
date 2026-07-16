'use strict';

const { pool }  = require('../../config/database');
const { UserAcademicAssignmentModel, AuditModel } = require('../../db/models');
const ApiError  = require('../../utils/apiError');

function mapAssignment(row) {
  return {
    id:               row.id,
    userId:           row.user_id,
    institutionId:    row.institution_id,
    departmentId:     row.department_id,
    academicYearId:   row.academic_year_id,
    semesterTermId:   row.semester_term_id,
    roleContext:      row.role_context,
    isCurrent:        row.is_current,
    assignedBy:       row.assigned_by      ?? null,
    assignedAt:       row.assigned_at,
    createdAt:        row.created_at,
    updatedAt:        row.updated_at,
    // joined
    departmentName:   row.department_name  ?? undefined,
    departmentCode:   row.department_code  ?? undefined,
    academicYearName: row.academic_year_name ?? undefined,
    academicYearCode: row.academic_year_code ?? undefined,
    yearOrder:        row.year_order        ?? undefined,
    semesterTermName: row.semester_term_name ?? undefined,
    semesterTermCode: row.semester_term_code ?? undefined,
    termOrder:        row.term_order        ?? undefined,
  };
}

async function validateTriple(departmentId, academicYearId, semesterTermId, institutionId) {
  // dept belongs to institution
  const { rows: [dept] } = await pool.query(
    `SELECT id FROM departments WHERE id = $1 AND institution_id = $2 AND deleted_at IS NULL`,
    [departmentId, institutionId],
  );
  if (!dept) throw ApiError.badRequest('Department not found or does not belong to your institution.');

  // academic year belongs to that department
  const { rows: [ay] } = await pool.query(
    `SELECT id FROM academic_years WHERE id = $1 AND department_id = $2 AND deleted_at IS NULL`,
    [academicYearId, departmentId],
  );
  if (!ay) throw ApiError.badRequest('Academic year not found or does not belong to the selected department.');

  // semester term belongs to that academic year
  const { rows: [st] } = await pool.query(
    `SELECT id FROM semester_terms WHERE id = $1 AND academic_year_id = $2 AND deleted_at IS NULL`,
    [semesterTermId, academicYearId],
  );
  if (!st) throw ApiError.badRequest('Semester term not found or does not belong to the selected academic year.');
}

// ── list ──────────────────────────────────────────────────────────────────────

exports.list = async (userId, actor) => {
  const isSelf = actor.id === userId;
  const canView = actor.permissions?.includes('academic_assignments.view');
  if (!isSelf && !canView) throw ApiError.forbidden('Missing permission: academic_assignments.view');
  const rows = await UserAcademicAssignmentModel.listForUser(userId);
  return rows.map(mapAssignment);
};

// ── getMyAssignment ───────────────────────────────────────────────────────────

exports.getMyCurrent = async (actor) => {
  const rows = await UserAcademicAssignmentModel.findCurrentForUser(actor.id);
  return rows.map(mapAssignment);
};

// ── create ────────────────────────────────────────────────────────────────────

exports.create = async (userId, body, actor) => {
  if (!actor.permissions?.includes('academic_assignments.manage')) {
    throw ApiError.forbidden('Missing permission: academic_assignments.manage');
  }

  const isSuperAdmin  = actor.roles?.includes('super_admin');
  const institutionId = isSuperAdmin ? body.institutionId ?? actor.institutionId : actor.institutionId;

  // User must belong to the same institution
  const { rows: [targetUser] } = await pool.query(
    `SELECT id, institution_id FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  if (!targetUser) throw ApiError.notFound('User not found.');
  if (!isSuperAdmin && targetUser.institution_id !== institutionId) {
    throw ApiError.forbidden('Cannot assign users outside your institution.');
  }

  const { departmentId, academicYearId, semesterTermId, roleContext } = body;
  if (!departmentId || !academicYearId || !semesterTermId || !roleContext) {
    throw ApiError.badRequest('departmentId, academicYearId, semesterTermId and roleContext are all required.');
  }

  await validateTriple(departmentId, academicYearId, semesterTermId, targetUser.institution_id);

  let row;
  if (roleContext === 'student') {
    row = await UserAcademicAssignmentModel.replaceStudentCurrentAssignment({
      userId, institutionId: targetUser.institution_id,
      departmentId, academicYearId, semesterTermId,
      assignedBy: actor.id,
    });
  } else {
    row = await UserAcademicAssignmentModel.create({
      userId, institutionId: targetUser.institution_id,
      departmentId, academicYearId, semesterTermId,
      roleContext, assignedBy: actor.id,
    });
  }

  await AuditModel.log({
    institutionId: targetUser.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'user_academic_assignment.create', entityType: 'UserAcademicAssignment', entityId: row.id,
    delta: { after: { userId, departmentId, academicYearId, semesterTermId, roleContext } },
  });

  return mapAssignment(await UserAcademicAssignmentModel.findById(row.id));
};

// ── update ────────────────────────────────────────────────────────────────────

exports.update = async (assignmentId, body, actor) => {
  if (!actor.permissions?.includes('academic_assignments.manage')) {
    throw ApiError.forbidden('Missing permission: academic_assignments.manage');
  }
  const row = await UserAcademicAssignmentModel.update(assignmentId, {
    is_current:  body.isCurrent,
    role_context: body.roleContext,
  });
  return row ? mapAssignment(await UserAcademicAssignmentModel.findById(assignmentId)) : null;
};
