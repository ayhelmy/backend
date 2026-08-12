'use strict';

/**
 * Top-level dashboard dispatcher. `getMyDashboard` auto-detects the caller's
 * highest-ranked role + scope and delegates to the matching role service; the
 * explicit per-role functions (used by the /platform, /institution, ...
 * routes) call the exact same underlying service — no duplicated logic
 * between /me and the explicit routes (SRS dashboard spec §11).
 */

const ApiError = require('../../utils/apiError');
const { ROLES } = require('../../constants/roles');
const { resolveActorRole, resolveScope } = require('./dashboard-permission.service');

const getPlatformDashboard = require('./platform-dashboard.service');
const getInstitutionDashboard = require('./institution-dashboard.service');
const getDepartmentDashboard = require('./department-dashboard.service');
const getInstructorDashboard = require('./instructor-dashboard.service');
const getTaDashboard = require('./ta-dashboard.service');
const getStudentDashboard = require('./student-dashboard.service');

const DISPATCH = {
  [ROLES.SUPER_ADMIN]: (actor) => getPlatformDashboard(actor),
  [ROLES.INSTITUTION_ADMIN]: async (actor) => getInstitutionDashboard(actor, await resolveScope(actor, ROLES.INSTITUTION_ADMIN)),
  [ROLES.DEPT_MANAGER]: async (actor) => getDepartmentDashboard(actor, await resolveScope(actor, ROLES.DEPT_MANAGER)),
  [ROLES.INSTRUCTOR]: async (actor) => getInstructorDashboard(actor, await resolveScope(actor, ROLES.INSTRUCTOR)),
  [ROLES.TEACHING_ASSISTANT]: async (actor) => getTaDashboard(actor, await resolveScope(actor, ROLES.TEACHING_ASSISTANT)),
  [ROLES.STUDENT]: async (actor) => getStudentDashboard(actor, await resolveScope(actor, ROLES.STUDENT)),
};

exports.getMyDashboard = async (actor) => {
  const role = resolveActorRole(actor);
  const handler = DISPATCH[role];
  if (!handler) throw ApiError.forbidden('Guests do not have a private dashboard.');
  return handler(actor);
};

exports.getPlatformDashboard = (actor) => getPlatformDashboard(actor);

exports.getInstitutionDashboard = async (actor) => {
  const scope = await resolveScope(actor, ROLES.INSTITUTION_ADMIN);
  return getInstitutionDashboard(actor, scope);
};

exports.getDepartmentDashboard = async (actor) => {
  const scope = await resolveScope(actor, ROLES.DEPT_MANAGER);
  return getDepartmentDashboard(actor, scope);
};

exports.getInstructorDashboard = async (actor) => {
  const scope = await resolveScope(actor, ROLES.INSTRUCTOR);
  return getInstructorDashboard(actor, scope);
};

exports.getTaDashboard = async (actor) => {
  const scope = await resolveScope(actor, ROLES.TEACHING_ASSISTANT);
  return getTaDashboard(actor, scope);
};

exports.getStudentDashboard = async (actor) => {
  const scope = await resolveScope(actor, ROLES.STUDENT);
  return getStudentDashboard(actor, scope);
};
