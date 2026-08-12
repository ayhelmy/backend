'use strict';

/**
 * Shared builder for instructor + teaching_assistant dashboards — both roles
 * see the same shape of data (a set of courses they teach/assist, with
 * follow-up and gradebook rollups), differing only in how the course set is
 * resolved (instructor: courses.instructor_id = me; TA: course_teaching_assistants)
 * and in which quick actions are offered. See instructor-dashboard.service.js
 * and ta-dashboard.service.js for the two entry points.
 */

const {
  GradeModel, QuizAttemptModel, SimulationScoreModel, SimulationActivitySessionModel, NotificationModel, MailModel,
} = require('../../db/models');
const activityService = require('./dashboard-activity.service');
const { mapCourse } = require('../courses/courses.service');

/**
 * @param {object} actor
 * @param {object} scope
 * @param {'instructor'|'teaching_assistant'} role
 * @param {Array} courses  — pre-resolved course rows (already scoped to this user)
 */
async function buildTeachingDashboard(actor, scope, role, rawCourses) {
  const courses = rawCourses.map(mapCourse);
  const courseIds = courses.map((c) => c.id);
  const publishedCourses = courses.filter((c) => c.status === 'published');
  const draftCourses = courses.filter((c) => c.status === 'draft');
  const coursesWithoutModules = courses.filter((c) => (c.moduleCount ?? 0) === 0 && c.status !== 'archived');

  const perCoursePending = await Promise.all(courseIds.map((id) => Promise.all([
    QuizAttemptModel.countPendingManualGrading({ courseId: id }),
    SimulationScoreModel.countPendingByCourse({ courseId: id }),
  ])));
  const pendingQuizGrading = perCoursePending.reduce((sum, [q]) => sum + q, 0);
  const pendingSimGrading = perCoursePending.reduce((sum, [, s]) => sum + s, 0);

  const [
    activeSessions, unreadNotifications, unreadMessages, recentActivity, perCourseFollowUp,
  ] = await Promise.all([
    SimulationActivitySessionModel.countActive({ courseIds }),
    NotificationModel.unreadCount(actor.id),
    MailModel.unreadCount(actor.id),
    activityService.getRecentActivity({ courseIds, limit: 20 }),
    Promise.all(publishedCourses.slice(0, 15).map(async (c) => ({
      courseId: c.id, title: c.title,
      studentsWithoutAttempts: await QuizAttemptModel.countStudentsWithoutAttempts(c.id),
      studentsWithoutActivity: await SimulationActivitySessionModel.countStudentsWithoutActivity(c.id),
    }))),
  ]);

  const totalEnrolledStudents = courses.reduce((sum, c) => sum + (c.enrolledCount ?? 0), 0);

  const gradeSummaries = await Promise.all(publishedCourses.slice(0, 15).map((c) => GradeModel.courseGradeSummary(c.id)));
  const withGrades = gradeSummaries.filter((g) => g.avgPercentage !== null);
  const avgCourseProgress = withGrades.length
    ? withGrades.reduce((sum, g) => sum + g.avgPercentage, 0) / withGrades.length
    : null;
  const missingGradesTotal = gradeSummaries.reduce((sum, g) => sum + g.missingGrades, 0);

  const recentSubmissions = courseIds.length
    ? await QuizAttemptModel.listRecentSubmissions({ courseId: courseIds[0], limit: 10 })
    : [];
  const recentSessions = courseIds.length
    ? await SimulationActivitySessionModel.listRecent({ courseIds, limit: 10 }).catch(() => [])
    : [];

  return {
    role,
    scope: {
      institution_id: scope.institutionId, institution_name: scope.institutionName,
      department_id: scope.departmentId, department_name: scope.departmentName,
      academic_year_id: scope.academicYearId, academic_year_name: scope.academicYearName,
      semester_term_id: scope.semesterTermId, semester_term_name: scope.semesterTermName,
    },
    kpis: {
      myCourses: courses.length,
      publishedCourses: publishedCourses.length,
      draftCourses: draftCourses.length,
      totalEnrolledStudents,
      pendingQuizGrading,
      pendingSimulationGrading: pendingSimGrading,
      activeSimulationSessions: activeSessions,
      averageCourseProgress: avgCourseProgress,
      unreadMessages,
      unreadNotifications,
    },
    sections: {
      myCourses: courses.map((c) => ({
        id: c.id, title: c.title, status: c.status,
        departmentName: c.departmentName, academicYearName: c.academicYearName, semesterTermName: c.semesterTermName,
        enrolledCount: c.enrolledCount ?? 0, moduleCount: c.moduleCount ?? 0,
      })),
      followUpRequired: {
        pendingQuizGrading,
        pendingSimulationGrading: pendingSimGrading,
        coursesWithoutModules: coursesWithoutModules.map((c) => ({ id: c.id, title: c.title })),
        draftCoursesNotPublished: draftCourses.map((c) => ({ id: c.id, title: c.title })),
        perCourse: perCourseFollowUp,
      },
      recentStudentActivity: {
        quizSubmissions: recentSubmissions,
        simulationSessions: recentSessions,
      },
      gradebookSummary: {
        averageCourseProgress: avgCourseProgress,
        missingGrades: missingGradesTotal,
        perCourse: gradeSummaries,
      },
    },
    quick_actions: role === 'instructor' ? [
      { label: 'Create Course', href: '/courses/new' },
      { label: 'Open Course Builder', href: '/courses' },
      { label: 'View Gradebook', href: '/gradebook' },
      { label: 'View Simulation Activity', href: '/simulation-activity' },
      { label: 'Send Course Mail', href: '/mail' },
    ] : [
      { label: 'View Assigned Courses', href: '/courses' },
      { label: 'View Gradebook', href: '/gradebook' },
      { label: 'View Simulation Activity', href: '/simulation-activity' },
      { label: 'Send Mail', href: '/mail' },
    ],
    notifications: { unread: unreadNotifications, recent: [] },
    messages: { unread: unreadMessages, recent: [] },
    recent_activity: recentActivity,
  };
}

module.exports = { buildTeachingDashboard };
