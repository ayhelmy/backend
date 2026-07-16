'use strict';

/**
 * Permission codes — Bedo SimuLearn RBAC v2.
 * Format: <resource>.<action>  (dot-separated)
 * Total: 78 permissions across 12 groups.
 */

const P = Object.freeze({
  // ── Platform ────────────────────────────────────────────────────────────────
  PLATFORM_MANAGE:          'platform.manage',
  PLATFORM_SETTINGS_MANAGE: 'platform.settings.manage',
  PLATFORM_AUDIT_VIEW:      'platform.audit.view',
  PLATFORM_REPORTS_VIEW:    'platform.reports.view',

  // ── Institutions ────────────────────────────────────────────────────────────
  INSTITUTIONS_CREATE:       'institutions.create',
  INSTITUTIONS_VIEW_ALL:     'institutions.view_all',
  INSTITUTIONS_MANAGE_ALL:   'institutions.manage_all',
  INSTITUTIONS_VIEW_OWN:     'institutions.view_own',
  INSTITUTIONS_MANAGE_OWN:   'institutions.manage_own',
  INSTITUTIONS_ASSIGN_ADMIN: 'institutions.assign_admin',

  // ── Departments ─────────────────────────────────────────────────────────────
  DEPARTMENTS_CREATE:         'departments.create',
  DEPARTMENTS_VIEW:           'departments.view',
  DEPARTMENTS_MANAGE:         'departments.manage',
  DEPARTMENTS_ASSIGN_MANAGER: 'departments.assign_manager',

  // ── Users ───────────────────────────────────────────────────────────────────
  USERS_CREATE:             'users.create',
  USERS_VIEW_ALL:           'users.view_all',
  USERS_VIEW_INSTITUTION:   'users.view_institution',
  USERS_VIEW_DEPARTMENT:    'users.view_department',
  USERS_VIEW_COURSE:        'users.view_course',
  USERS_UPDATE_ALL:         'users.update_all',
  USERS_UPDATE_INSTITUTION: 'users.update_institution',
  USERS_UPDATE_DEPARTMENT:  'users.update_department',
  USERS_ASSIGN_ROLES:       'users.assign_roles',
  USERS_ASSIGN_DEPARTMENT:  'users.assign_department',
  USERS_ASSIGN_COURSE:      'users.assign_course',
  USERS_SUSPEND:            'users.suspend',
  USERS_DELETE:             'users.delete',

  // ── Roles / Permissions ─────────────────────────────────────────────────────
  ROLES_MANAGE:       'roles.manage',
  PERMISSIONS_MANAGE: 'permissions.manage',

  // ── Courses ─────────────────────────────────────────────────────────────────
  COURSES_CREATE:            'courses.create',
  COURSES_VIEW_ALL:          'courses.view_all',
  COURSES_VIEW_INSTITUTION:  'courses.view_institution',
  COURSES_VIEW_DEPARTMENT:   'courses.view_department',
  COURSES_VIEW_OWN:          'courses.view_own',
  COURSES_UPDATE_ALL:        'courses.update_all',
  COURSES_UPDATE_DEPARTMENT: 'courses.update_department',
  COURSES_UPDATE_OWN:        'courses.update_own',
  COURSES_PUBLISH:           'courses.publish',
  COURSES_ARCHIVE:           'courses.archive',
  COURSES_ASSIGN_INSTRUCTOR: 'courses.assign_instructor',
  COURSES_ASSIGN_TA:         'courses.assign_ta',
  COURSES_MANAGE_ENROLLMENTS:'courses.manage_enrollments',

  // ── Lessons & Content ───────────────────────────────────────────────────────
  LESSONS_CREATE: 'lessons.create',
  LESSONS_UPDATE: 'lessons.update',
  LESSONS_DELETE: 'lessons.delete',
  LESSONS_VIEW:   'lessons.view',
  MEDIA_UPLOAD:   'media.upload',

  // ── Simulation Catalogs ─────────────────────────────────────────────────────
  SIM_CATALOGS_MANAGE_GLOBAL:            'simulation_catalogs.manage_global',
  SIM_CATALOGS_ASSIGN_TO_INSTITUTION:    'simulation_catalogs.assign_to_institution',
  SIM_CATALOGS_UNASSIGN_FROM_INSTITUTION:'simulation_catalogs.unassign_from_institution',
  SIM_CATALOGS_VIEW_ASSIGNMENTS:         'simulation_catalogs.view_assignments',
  SIM_CATALOGS_VIEW_ASSIGNED:            'simulation_catalogs.view_assigned',
  SIMULATIONS_VIEW_CATALOG:         'simulations.view_catalog',
  SIMULATIONS_VIEW_DEMO:            'simulations.view_demo',
  SIMULATIONS_ADD_TO_COURSE:        'simulations.add_to_course',
  SIMULATIONS_LAUNCH:               'simulations.launch',
  SIMULATIONS_LAUNCH_DEMO:          'simulations.launch_demo',
  SIM_SESSIONS_VIEW_OWN:            'simulation_sessions.view_own',
  SIM_SESSIONS_VIEW_COURSE:         'simulation_sessions.view_course',
  SIM_SESSIONS_VIEW_DEPARTMENT:     'simulation_sessions.view_department',
  SIM_SESSIONS_MANAGE:              'simulation_sessions.manage',

  // ── Grades & Progress ───────────────────────────────────────────────────────
  GRADES_VIEW_OWN:        'grades.view_own',
  GRADES_VIEW_COURSE:     'grades.view_course',
  GRADES_VIEW_DEPARTMENT: 'grades.view_department',
  GRADES_EDIT_COURSE:     'grades.edit_course',
  GRADES_OVERRIDE:        'grades.override',
  PROGRESS_VIEW_OWN:      'progress.view_own',
  PROGRESS_VIEW_COURSE:   'progress.view_course',
  PROGRESS_VIEW_DEPARTMENT:'progress.view_department',

  // ── Reports ─────────────────────────────────────────────────────────────────
  REPORTS_VIEW_PLATFORM:    'reports.view_platform',
  REPORTS_VIEW_INSTITUTION: 'reports.view_institution',
  REPORTS_VIEW_DEPARTMENT:  'reports.view_department',
  REPORTS_VIEW_COURSE:      'reports.view_course',

  // ── Messages & Notifications ─────────────────────────────────────────────────
  MESSAGES_SEND:          'messages.send',
  MESSAGES_VIEW:          'messages.view',
  NOTIFICATIONS_VIEW:     'notifications.view',
  NOTIFICATIONS_MANAGE_OWN:'notifications.manage_own',

  // ── Audit ───────────────────────────────────────────────────────────────────
  AUDIT_VIEW_PLATFORM:    'audit.view_platform',
  AUDIT_VIEW_INSTITUTION: 'audit.view_institution',
  AUDIT_VIEW_DEPARTMENT:  'audit.view_department',
});

// Convenient groupings for route guards
const INSTITUTION_ADMIN_PERMS = [
  P.INSTITUTIONS_VIEW_OWN, P.INSTITUTIONS_MANAGE_OWN,
  P.DEPARTMENTS_CREATE, P.DEPARTMENTS_VIEW, P.DEPARTMENTS_MANAGE, P.DEPARTMENTS_ASSIGN_MANAGER,
  P.USERS_CREATE, P.USERS_VIEW_INSTITUTION, P.USERS_UPDATE_INSTITUTION,
  P.USERS_ASSIGN_ROLES, P.USERS_ASSIGN_DEPARTMENT, P.USERS_SUSPEND, P.USERS_DELETE,
  P.COURSES_VIEW_INSTITUTION, P.COURSES_UPDATE_ALL, P.COURSES_ASSIGN_INSTRUCTOR,
  P.COURSES_ASSIGN_TA, P.COURSES_MANAGE_ENROLLMENTS, P.COURSES_ARCHIVE,
  // P.SIM_CATALOGS_VIEW_ASSIGNED, P.SIMULATIONS_VIEW_CATALOG,
  P.GRADES_VIEW_COURSE, P.GRADES_VIEW_DEPARTMENT,
  P.REPORTS_VIEW_INSTITUTION,
  P.MESSAGES_SEND, P.MESSAGES_VIEW, P.NOTIFICATIONS_VIEW, P.NOTIFICATIONS_MANAGE_OWN,
  P.AUDIT_VIEW_INSTITUTION, P.PLATFORM_SETTINGS_MANAGE,
];

const DEPT_MANAGER_PERMS = [
  P.DEPARTMENTS_VIEW,
  P.USERS_VIEW_DEPARTMENT, P.USERS_UPDATE_DEPARTMENT, P.USERS_ASSIGN_DEPARTMENT,
  P.COURSES_VIEW_DEPARTMENT, P.COURSES_UPDATE_DEPARTMENT,
  P.COURSES_ASSIGN_INSTRUCTOR, P.COURSES_ASSIGN_TA, P.COURSES_MANAGE_ENROLLMENTS,
  P.GRADES_VIEW_DEPARTMENT, P.GRADES_VIEW_COURSE,
  P.PROGRESS_VIEW_DEPARTMENT, P.PROGRESS_VIEW_COURSE,
  P.REPORTS_VIEW_DEPARTMENT,
  P.MESSAGES_SEND, P.MESSAGES_VIEW, P.NOTIFICATIONS_VIEW, P.NOTIFICATIONS_MANAGE_OWN,
  P.AUDIT_VIEW_DEPARTMENT,
  P.SIM_SESSIONS_VIEW_DEPARTMENT,
  P.SIM_CATALOGS_VIEW_ASSIGNED, P.SIMULATIONS_VIEW_CATALOG,
];

const INSTRUCTOR_PERMS = [
  P.COURSES_CREATE, P.COURSES_VIEW_OWN, P.COURSES_UPDATE_OWN,
  P.COURSES_PUBLISH, P.COURSES_ARCHIVE, P.COURSES_ASSIGN_TA, P.COURSES_MANAGE_ENROLLMENTS,
  P.COURSES_VIEW_INSTITUTION,
  P.LESSONS_CREATE, P.LESSONS_UPDATE, P.LESSONS_DELETE, P.LESSONS_VIEW,
  P.MEDIA_UPLOAD,
  P.SIM_CATALOGS_VIEW_ASSIGNED, P.SIMULATIONS_VIEW_CATALOG,
  P.SIMULATIONS_ADD_TO_COURSE, P.SIMULATIONS_LAUNCH,
  P.SIM_SESSIONS_VIEW_COURSE, P.SIM_SESSIONS_MANAGE,
  P.GRADES_VIEW_COURSE, P.GRADES_EDIT_COURSE, P.GRADES_OVERRIDE,
  P.PROGRESS_VIEW_COURSE,
  P.REPORTS_VIEW_COURSE,
  P.MESSAGES_SEND, P.MESSAGES_VIEW, P.NOTIFICATIONS_VIEW, P.NOTIFICATIONS_MANAGE_OWN,
];

const TEACHING_ASSISTANT_PERMS = [
  P.COURSES_VIEW_OWN, P.LESSONS_VIEW,
  P.SIMULATIONS_LAUNCH,
  P.SIM_SESSIONS_VIEW_COURSE,
  P.GRADES_VIEW_COURSE, P.PROGRESS_VIEW_COURSE,
  P.MESSAGES_SEND, P.MESSAGES_VIEW, P.NOTIFICATIONS_VIEW, P.NOTIFICATIONS_MANAGE_OWN,
];

const STUDENT_PERMS = [
  P.COURSES_VIEW_OWN, P.LESSONS_VIEW,
  P.SIMULATIONS_LAUNCH,
  P.SIM_SESSIONS_VIEW_OWN,
  P.GRADES_VIEW_OWN, P.PROGRESS_VIEW_OWN,
  P.MESSAGES_SEND, P.MESSAGES_VIEW, P.NOTIFICATIONS_VIEW, P.NOTIFICATIONS_MANAGE_OWN,
];

const GUEST_PERMS = [
  P.SIMULATIONS_VIEW_DEMO, P.SIMULATIONS_LAUNCH_DEMO,
];

module.exports = {
  P,
  INSTITUTION_ADMIN_PERMS,
  DEPT_MANAGER_PERMS,
  INSTRUCTOR_PERMS,
  TEACHING_ASSISTANT_PERMS,
  STUDENT_PERMS,
  GUEST_PERMS,
};
