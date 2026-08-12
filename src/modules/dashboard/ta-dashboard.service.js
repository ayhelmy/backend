'use strict';

/** Teaching-assistant dashboard — GET /api/v1/dashboard/ta. */

const { CourseModel, RoleModel } = require('../../db/models');
const { buildTeachingDashboard } = require('./teaching-dashboard.shared');

module.exports = async function getTaDashboard(actor, scope) {
  const courseIds = await RoleModel.getTACourses(actor.id);
  const courses = await CourseModel.listByIds(courseIds);
  return buildTeachingDashboard(actor, scope, 'teaching_assistant', courses);
};
