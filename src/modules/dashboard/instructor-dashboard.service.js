'use strict';

/** Instructor dashboard — GET /api/v1/dashboard/instructor. */

const { CourseModel } = require('../../db/models');
const { buildTeachingDashboard } = require('./teaching-dashboard.shared');

module.exports = async function getInstructorDashboard(actor, scope) {
  const courses = await CourseModel.list({ institutionId: scope.institutionId, instructorId: actor.id, limit: 50 });
  return buildTeachingDashboard(actor, scope, 'instructor', courses);
};
