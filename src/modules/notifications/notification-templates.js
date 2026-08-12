'use strict';

/**
 * Notification templates — SRS §7. Each entry renders title/body/actionUrl
 * from event variables and declares a priority + preference category so
 * EventDispatcherService can gate on user preferences and email-worthiness
 * from a single lookup.
 */

const TEMPLATES = {
  'course.published': {
    category: 'course_announcements',
    priority: 'normal',
    title: () => 'Course published',
    body: (v) => `"${v.courseTitle}" is now published and open for enrollment.`,
    actionUrl: (v) => `/courses/${v.courseId}`,
  },
  'enrollment.confirmed': {
    category: 'enrollment_updates',
    priority: 'normal',
    title: () => 'Enrollment confirmed',
    body: (v) => `You are now enrolled in "${v.courseTitle}".`,
    actionUrl: (v) => `/courses/${v.courseId}/home`,
  },
  'enrollment.pending_approval': {
    category: 'enrollment_updates',
    priority: 'normal',
    title: () => 'New enrollment request',
    body: (v) => `${v.studentName} has requested to enroll in "${v.courseTitle}".`,
    actionUrl: (v) => `/courses/${v.courseId}/edit`,
  },
  'enrollment.approved': {
    category: 'enrollment_updates',
    priority: 'high',
    title: () => 'Enrollment approved',
    body: (v) => `Your enrollment in "${v.courseTitle}" has been approved.`,
    actionUrl: (v) => `/courses/${v.courseId}/home`,
  },
  'enrollment.rejected': {
    category: 'enrollment_updates',
    priority: 'normal',
    title: () => 'Enrollment request declined',
    body: (v) => `Your enrollment request for "${v.courseTitle}" was declined.`,
    actionUrl: (v) => `/courses/${v.courseId}`,
  },
  'module.published': {
    category: 'course_announcements',
    priority: 'normal',
    title: () => 'New module available',
    body: (v) => `A new module "${v.moduleTitle}" is available in ${v.courseTitle}.`,
    actionUrl: (v) => `/courses/${v.courseId}/home`,
  },
  'lesson.published': {
    category: 'course_announcements',
    priority: 'normal',
    title: () => 'New lesson available',
    body: (v) => `A new lesson "${v.lessonTitle}" is available in ${v.courseTitle}.`,
    actionUrl: (v) => `/courses/${v.courseId}/home`,
  },
  'quiz.published': {
    category: 'quiz_updates',
    priority: 'normal',
    title: () => 'New quiz available',
    body: (v) => `A new quiz "${v.quizTitle}" is available in ${v.courseTitle}.`,
    actionUrl: (v) => `/courses/${v.courseId}/home`,
  },
  'quiz_attempt.manual_grading_required': {
    category: 'quiz_updates',
    priority: 'high',
    title: () => 'Quiz attempt awaiting grading',
    body: (v) => `${v.studentName}'s attempt on "${v.quizTitle}" needs manual grading.`,
    actionUrl: (v) => `/courses/${v.courseId}/quizzes/${v.quizId}/attempts/${v.attemptId}/review`,
  },
  'quiz_attempt.graded': {
    category: 'grade_updates',
    priority: 'high',
    title: () => 'Quiz result available',
    body: (v) => `Your attempt on "${v.quizTitle}" has been graded.`,
    actionUrl: (v) => `/courses/${v.courseId}/quizzes/${v.quizId}/grade`,
  },
  'grade.posted': {
    category: 'grade_updates',
    priority: 'high',
    title: () => 'New grade posted',
    body: (v) => `Your grade for ${v.activityTitle} in ${v.courseTitle} is now available.`,
    actionUrl: (v) => `/courses/${v.courseId}/grade`,
  },
  'grade.overridden': {
    category: 'grade_updates',
    priority: 'high',
    title: () => 'Grade updated',
    body: (v) => `Your grade for ${v.activityTitle} in ${v.courseTitle} was updated.`,
    actionUrl: (v) => `/courses/${v.courseId}/grade`,
  },
  'simulation.completed': {
    category: 'simulation_updates',
    priority: 'normal',
    title: () => 'Simulation completed',
    body: (v) => `You completed "${v.simulationTitle}" in ${v.courseTitle}.`,
    actionUrl: (v) => `/courses/${v.courseId}/home`,
  },
  'message.new': {
    category: 'messages',
    priority: 'normal',
    title: () => 'New message',
    body: (v) => `${v.senderName} sent you a message: ${v.subject}`,
    actionUrl: (v) => `/mail/messages/${v.messageId}`,
  },
  'course_announcement.posted': {
    category: 'course_announcements',
    priority: 'high',
    title: (v) => `New announcement in ${v.courseTitle}`,
    body: (v) => `${v.senderName}: ${v.messagePreview}`,
    actionUrl: (v) => `/courses/${v.courseId}/home`,
  },
  'system.alert': {
    category: 'system_alerts',
    priority: 'urgent',
    title: (v) => v.title ?? 'System notice',
    body: (v) => v.body ?? '',
    actionUrl: () => `/dashboard`,
  },
};

function render(eventName, vars = {}) {
  const tpl = TEMPLATES[eventName];
  if (!tpl) throw new Error(`Unknown notification event "${eventName}"`);
  return {
    type: eventName,
    category: tpl.category,
    priority: tpl.priority,
    title: tpl.title(vars),
    body: tpl.body(vars),
    actionUrl: tpl.actionUrl(vars),
  };
}

module.exports = { TEMPLATES, render };
