'use strict';

/** Student dashboard — GET /api/v1/dashboard/student. */

const {
  CourseModel, GradeModel, QuizModel, QuizAttemptModel, ProgressModel,
  SimulationActivitySessionModel, NotificationModel, MailModel,
} = require('../../db/models');
const { mapCourse } = require('../courses/courses.service');
const activityService = require('./dashboard-activity.service');

module.exports = async function getStudentDashboard(actor, scope) {
  const { institutionId, departmentId, academicYearId, semesterTermId } = scope;

  if (!departmentId || !academicYearId || !semesterTermId) {
    // No current academic assignment yet — real empty state, not a guess.
    return emptyDashboard(scope);
  }

  const rawCourses = await CourseModel.list({
    institutionId, departmentId, academicYearId, semesterTermId, status: 'published', limit: 50,
  });
  const courses = rawCourses.map(mapCourse);
  const courseIds = courses.map((c) => c.id);

  const [
    lessonStatus, quizzesDue, quizAttemptsTotal, simSummary, progressSnapshot,
    unreadNotifications, unreadMessages, recentActivity,
  ] = await Promise.all([
    ProgressModel.countLessonStatusForUser(actor.id, courseIds),
    QuizModel.listDueForStudent(actor.id, courseIds, { limit: 10 }),
    QuizAttemptModel.countByUser(actor.id),
    SimulationActivitySessionModel.getScopedSummary({ userId: actor.id }),
    ProgressModel.dashboardSnapshot(actor.id),
    NotificationModel.unreadCount(actor.id),
    MailModel.unreadCount(actor.id),
    activityService.getRecentActivity({ courseIds, studentId: actor.id, limit: 20 }),
  ]);

  const progressByCourseId = new Map(progressSnapshot.map((p) => [p.course_id, p]));
  const grades = await Promise.all(courseIds.map((id) => GradeModel.weightedCourseGrade(id, actor.id)));
  const gradeByCourseId = new Map(courseIds.map((id, i) => [id, grades[i]]));

  const avgGrade = grades.filter((g) => g !== null).length
    ? grades.filter((g) => g !== null).reduce((s, g) => s + Number(g), 0) / grades.filter((g) => g !== null).length
    : null;

  return {
    role: 'student',
    scope: {
      institution_id: institutionId, institution_name: scope.institutionName,
      department_id: departmentId, department_name: scope.departmentName,
      academic_year_id: academicYearId, academic_year_name: scope.academicYearName,
      semester_term_id: semesterTermId, semester_term_name: scope.semesterTermName,
    },
    kpis: {
      currentCourses: courses.length,
      completedLessons: lessonStatus.completed,
      pendingLessons: lessonStatus.pending,
      quizzesDue: quizzesDue.length,
      quizAttempts: quizAttemptsTotal,
      simulationTimeSeconds: simSummary.total_duration_seconds,
      averageGrade: avgGrade,
      unreadMessages,
      unreadNotifications,
    },
    sections: {
      myCourses: courses.map((c) => {
        const progress = progressByCourseId.get(c.id);
        return {
          id: c.id, title: c.title, instructorName: c.instructorName ?? null,
          progressPercentage: progress?.completion_pct !== undefined ? Number(progress.completion_pct) : null,
          latestGrade: gradeByCourseId.get(c.id) !== null && gradeByCourseId.get(c.id) !== undefined
            ? Number(gradeByCourseId.get(c.id)) : null,
        };
      }),
      myToDo: {
        quizzesDue: quizzesDue.map((q) => ({ id: q.id, courseId: q.course_id, title: q.title, dueAt: q.due_at })),
        pendingLessons: lessonStatus.pending,
      },
      myProgress: {
        totalCourseProgress: progressSnapshot,
        completedLessons: lessonStatus.completed,
        pendingLessons: lessonStatus.pending,
        quizAttempts: quizAttemptsTotal,
        averageGrade: avgGrade,
        simulationDurationSeconds: simSummary.total_duration_seconds,
      },
    },
    quick_actions: [
      { label: 'View My Courses', href: '/courses' },
      { label: 'View My Grades', href: '/gradebook' },
      { label: 'View My Simulation Activity', href: '/simulation-activity' },
      { label: 'View Messages', href: '/mail' },
      { label: 'View Notifications', href: '/notifications' },
    ],
    notifications: { unread: unreadNotifications, recent: [] },
    messages: { unread: unreadMessages, recent: [] },
    recent_activity: recentActivity,
  };
};

function emptyDashboard(scope) {
  return {
    role: 'student',
    scope: {
      institution_id: scope.institutionId, department_id: null, academic_year_id: null, semester_term_id: null,
    },
    kpis: {
      currentCourses: 0, completedLessons: 0, pendingLessons: 0, quizzesDue: 0,
      quizAttempts: 0, simulationTimeSeconds: 0, averageGrade: null, unreadMessages: 0, unreadNotifications: 0,
    },
    sections: { myCourses: [], myToDo: { quizzesDue: [], pendingLessons: 0 }, myProgress: null },
    quick_actions: [
      { label: 'View Messages', href: '/mail' },
      { label: 'View Notifications', href: '/notifications' },
    ],
    notifications: { unread: 0, recent: [] },
    messages: { unread: 0, recent: [] },
    recent_activity: [],
  };
}
