'use strict';

/**
 * Merges several already-existing "recent X" queries into one normalised,
 * timestamp-sorted feed for the dashboard's "Recent Activity" section. This is
 * a read-only merge/sort layer — it does not own any data, it only combines
 * results from AuditModel + QuizAttemptModel + SimulationActivitySessionModel
 * + GradeModel, which are the actual sources of truth (see each service).
 *
 * Scoping rule: audit-log and grade rows have no per-course/per-instructor
 * column to filter on cheaply, so they're only pulled in for
 * institution/department/platform-level scopes (via institutionId/departmentId)
 * — never for a person-scoped call (instructorId/studentId without an explicit
 * courseId/courseIds), where an unscoped query would leak data across courses.
 */

const {
  AuditModel, QuizAttemptModel, SimulationActivitySessionModel, GradeModel,
} = require('../../db/models');

function auditLabel(action) {
  const [entity, verb] = action.split('.');
  return `${entity.replace(/_/g, ' ')} ${verb.replace(/_/g, ' ')}`;
}

/**
 * @param {object} filters
 * @param {string} [filters.institutionId]
 * @param {string} [filters.departmentId]
 * @param {string} [filters.courseId]
 * @param {string[]} [filters.courseIds]
 * @param {string} [filters.instructorId]
 * @param {string} [filters.studentId]  — when set, activity is scoped to "my activity"
 * @param {number} [filters.limit=20]
 */
async function getRecentActivity(filters = {}) {
  const {
    institutionId, departmentId, courseId, courseIds, instructorId, studentId, limit = 20,
  } = filters;
  const perSourceLimit = Math.min(limit, 15);

  const hasCourseScope = !!(courseId || courseIds?.length || studentId);
  const isPersonScoped = !!(instructorId || studentId);

  const [auditRows, quizRows, simRows, gradeRows] = await Promise.all([
    isPersonScoped
      ? Promise.resolve([])
      : AuditModel.list({ institutionId, limit: perSourceLimit }).catch(() => []),
    QuizAttemptModel.listRecentSubmissions({
      courseId, institutionId: hasCourseScope || instructorId ? undefined : institutionId,
      departmentId, instructorId, studentId, limit: perSourceLimit,
    }).catch(() => []),
    SimulationActivitySessionModel.listRecent({
      institutionId: hasCourseScope ? undefined : institutionId,
      departmentId: hasCourseScope ? undefined : departmentId,
      courseId, courseIds, studentId, limit: perSourceLimit,
    }).catch(() => []),
    hasCourseScope
      ? GradeModel.listRecentlyGraded({ courseId, courseIds, studentId, limit: perSourceLimit }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const items = [
    ...auditRows.map((r) => ({
      type: 'audit',
      title: auditLabel(r.action),
      description: r.actor_email ?? 'System',
      at: r.occurred_at,
    })),
    ...quizRows.map((r) => ({
      type: 'quiz_attempt',
      title: `${r.student_first_name} ${r.student_last_name} submitted "${r.quiz_title}"`,
      description: r.status === 'pending_manual_grading' ? 'Pending manual grading' : `Scored ${r.percentage ?? '—'}%`,
      at: r.submitted_at,
    })),
    ...simRows.map((r) => ({
      type: 'simulation_session',
      title: `${r.first_name ?? 'A student'} ${r.last_name ?? ''} ${r.status === 'active' ? 'started' : 'ended'} "${r.simulation_title ?? 'a simulation'}"`,
      description: r.duration_seconds ? `${Math.round(r.duration_seconds / 60)} min` : 'In progress',
      at: r.ended_at ?? r.started_at,
    })),
    ...gradeRows.map((r) => ({
      type: 'grade_posted',
      title: `Grade posted for ${r.first_name} ${r.last_name}: "${r.item_title}"`,
      description: `${r.score}/${r.points_possible}`,
      at: r.graded_at,
    })),
  ].filter((i) => i.at);

  items.sort((a, b) => new Date(b.at) - new Date(a.at));
  return items.slice(0, limit);
}

module.exports = { getRecentActivity };
