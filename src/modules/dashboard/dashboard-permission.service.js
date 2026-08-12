'use strict';

/**
 * Resolves which dashboard a user should see and the tenant scope it's bound to.
 * A user can hold multiple roles (RBAC v2, `user_roles` is many-to-many) — there is
 * no "current active role" concept anywhere else in the system, so the dashboard
 * picks the single highest-ranked held role (ROLE_RANK) and scopes strictly to it.
 */

const { ROLES, ROLE_RANK } = require('../../constants/roles');
const { RoleModel, UserAcademicAssignmentModel, InstitutionModel } = require('../../db/models');
const institutionsService = require('../institutions/institutions.service');

function resolveActorRole(actor) {
  const roles = (actor.roles ?? []).map((r) => (typeof r === 'string' ? r : r.name));
  if (!roles.length) return ROLES.GUEST;
  return roles.reduce((best, r) => (
    (ROLE_RANK[r] ?? 99) < (ROLE_RANK[best] ?? 99) ? r : best
  ), roles[0]);
}

async function resolveScope(actor, role) {
  const base = { role, institutionId: null, institutionName: null,
    departmentId: null, departmentName: null, departmentIds: [],
    academicYearId: null, academicYearName: null,
    semesterTermId: null, semesterTermName: null };

  if (role === ROLES.SUPER_ADMIN) return base;

  const institution = actor.institutionId ? await InstitutionModel.findById(actor.institutionId) : null;
  base.institutionId = actor.institutionId ?? null;
  base.institutionName = institution?.name ?? null;

  if (role === ROLES.INSTITUTION_ADMIN) return base;

  if (role === ROLES.DEPT_MANAGER) {
    const deptIds = await RoleModel.getUserDepartments(actor.id);
    base.departmentIds = deptIds;
    if (deptIds.length) {
      const depts = await institutionsService.getDepartmentsByIds(deptIds);
      base.departmentId = depts[0]?.id ?? null;
      base.departmentName = depts[0]?.name ?? null;
    }
    return base;
  }

  if (role === ROLES.INSTRUCTOR || role === ROLES.TEACHING_ASSISTANT) {
    const roleContext = role === ROLES.INSTRUCTOR ? 'instructor' : 'teaching_assistant';
    const assignments = await UserAcademicAssignmentModel.findCurrentForUser(actor.id, roleContext);
    const current = assignments[0];
    if (current) {
      base.departmentId = current.department_id;
      base.departmentName = current.department_name;
      base.academicYearId = current.academic_year_id;
      base.academicYearName = current.academic_year_name;
      base.semesterTermId = current.semester_term_id;
      base.semesterTermName = current.semester_term_name;
    }
    return base;
  }

  if (role === ROLES.STUDENT) {
    const assignments = await UserAcademicAssignmentModel.findCurrentForUser(actor.id, 'student');
    const current = assignments[0];
    if (current) {
      base.departmentId = current.department_id;
      base.departmentName = current.department_name;
      base.academicYearId = current.academic_year_id;
      base.academicYearName = current.academic_year_name;
      base.semesterTermId = current.semester_term_id;
      base.semesterTermName = current.semester_term_name;
    }
    return base;
  }

  return base;
}

module.exports = { resolveActorRole, resolveScope };
