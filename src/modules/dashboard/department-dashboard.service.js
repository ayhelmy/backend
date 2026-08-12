'use strict';

/** Dept-manager dashboard — GET /api/v1/dashboard/department. */

const {
  CourseModel, GradeModel, ModuleModel, QuizModel, QuizAttemptModel,
  RoleModel, SemesterTermModel, SimulationActivitySessionModel, NotificationModel, MailModel,
} = require('../../db/models');
const activityService = require('./dashboard-activity.service');
const { mapCourse } = require('../courses/courses.service');

module.exports = async function getDepartmentDashboard(actor, scope) {
  const departmentIds = scope.departmentIds?.length ? scope.departmentIds : [scope.departmentId].filter(Boolean);

  if (!departmentIds.length) {
    return emptyDashboard(scope);
  }

  const [
    roleCounts, semesterTerms, publishedCourses, draftCourses, totalLessons, totalQuizzes,
    pendingGrading, activityStats, courses, unreadNotifications, unreadMessages, recentActivity,
  ] = await Promise.all([
    RoleModel.countUsersByDepartments(departmentIds),
    Promise.all(departmentIds.map((id) => SemesterTermModel.listByDepartment(id))).then((r) => r.flat()),
    CourseModel.countByFilters({ departmentIds, status: 'published' }),
    CourseModel.countByFilters({ departmentIds, status: 'draft' }),
    ModuleModel.countLessonsByDepartments(departmentIds),
    QuizModel.countByDepartments(departmentIds),
    QuizAttemptModel.countPendingManualGrading({ departmentIds }),
    SimulationActivitySessionModel.getScopedSummary({ departmentId: departmentIds[0] }),
    CourseModel.list({ departmentIds, limit: 20 }).then((rows) => rows.map(mapCourse)),
    NotificationModel.unreadCount(actor.id),
    MailModel.unreadCount(actor.id),
    activityService.getRecentActivity({ institutionId: scope.institutionId, departmentId: departmentIds[0], limit: 20 }),
  ]);

  // Class-average grade across the department's courses — a real, per-course
  // query averaged client-side (no department-level pre-aggregation exists;
  // acceptable for the course counts departments realistically have, flagged
  // as a follow-up optimization for departments with 50+ active courses).
  const gradeSummaries = await Promise.all(courses.slice(0, 20).map((c) => GradeModel.courseGradeSummary(c.id)));
  const withGrades = gradeSummaries.filter((g) => g.avgPercentage !== null);
  const avgCourseProgress = withGrades.length
    ? withGrades.reduce((sum, g) => sum + g.avgPercentage, 0) / withGrades.length
    : null;

  return {
    role: 'dept_manager',
    scope: {
      institution_id: scope.institutionId, institution_name: scope.institutionName,
      department_id: departmentIds[0], department_name: scope.departmentName,
      academic_year_id: null, semester_term_id: null,
    },
    kpis: {
      departmentUsers: (roleCounts.student ?? 0) + (roleCounts.instructor ?? 0) + (roleCounts.teaching_assistant ?? 0),
      students: roleCounts.student ?? 0,
      instructors: roleCounts.instructor ?? 0,
      activeSemesterTerms: semesterTerms.filter((t) => t.status === 'active').length,
      activeCourses: publishedCourses + draftCourses,
      publishedCourses,
      totalLessons,
      totalQuizzes,
      totalSimulationsUsed: activityStats.distinct_simulations,
      averageCourseProgress: avgCourseProgress,
      pendingManualGrading: pendingGrading,
      unreadNotifications,
    },
    sections: {
      departmentCourses: courses.map((c) => ({
        id: c.id, title: c.title, status: c.status, instructorName: c.instructorName ?? null,
        enrolledCount: c.enrolledCount ?? 0, moduleCount: c.moduleCount ?? 0,
      })),
      progressFollowUp: {
        averageCourseProgress: avgCourseProgress,
        simulationActivity: {
          totalLaunches: activityStats.total_launches,
          uniqueStudents: activityStats.unique_students,
          avgDurationSeconds: activityStats.avg_duration_seconds,
        },
        pendingManualGrading: pendingGrading,
      },
    },
    quick_actions: [
      { label: 'View Department Courses', href: '/courses' },
      { label: 'View Department Users', href: '/users' },
      { label: 'View Notifications', href: '/notifications' },
      { label: 'Send Mail', href: '/mail' },
    ],
    notifications: { unread: unreadNotifications, recent: [] },
    messages: { unread: unreadMessages, recent: [] },
    recent_activity: recentActivity,
  };
};

function emptyDashboard(scope) {
  return {
    role: 'dept_manager',
    scope: { institution_id: scope.institutionId, department_id: null, academic_year_id: null, semester_term_id: null },
    kpis: {
      departmentUsers: 0, students: 0, instructors: 0, activeSemesterTerms: 0,
      activeCourses: 0, publishedCourses: 0, totalLessons: 0, totalQuizzes: 0,
      totalSimulationsUsed: 0, averageCourseProgress: null, pendingManualGrading: 0, unreadNotifications: 0,
    },
    sections: { departmentCourses: [], progressFollowUp: null },
    quick_actions: [],
    notifications: { unread: 0, recent: [] },
    messages: { unread: 0, recent: [] },
    recent_activity: [],
  };
}
