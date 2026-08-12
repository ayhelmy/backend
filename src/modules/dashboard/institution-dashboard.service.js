'use strict';

/** Institution-admin dashboard — GET /api/v1/dashboard/institution. */

const { CourseModel, NotificationModel, MailModel, AcademicYearModel, SemesterTermModel, RoleModel, SimulationModel } = require('../../db/models');
const institutionsService = require('../institutions/institutions.service');
const usersService = require('../users/users.service');
const catalogService = require('../simulation-catalogs/catalog.service');
const activityService = require('./dashboard-activity.service');

module.exports = async function getInstitutionDashboard(actor, scope) {
  const institutionId = scope.institutionId;

  const [
    departments, academicYearsCount, semesterTermsCount, userCounts, roleCounts,
    publishedCourses, draftCourses, coursesWithoutModules,
    deptsWithoutManager, missingAssignmentUsers, unreadNotifications, unreadMessages, recentActivity,
    assignedCatalogs, buildStatus,
  ] = await Promise.all([
    institutionsService.listDepartments(institutionId),
    AcademicYearModel.countByInstitution(institutionId),
    SemesterTermModel.countByInstitution(institutionId),
    usersService.countByStatus({ institutionId }),
    RoleModel.countUsersByRole(institutionId),
    CourseModel.countByFilters({ institutionId, status: 'published' }),
    CourseModel.countByFilters({ institutionId, status: 'draft' }),
    CourseModel.listWithoutModules({ institutionId, limit: 10 }),
    institutionsService.listDepartmentsWithoutManager(institutionId),
    usersService.usersMissingAcademicAssignment({ institutionId, limit: 10 }),
    NotificationModel.unreadCount(actor.id),
    MailModel.unreadCount(actor.id),
    activityService.getRecentActivity({ institutionId, limit: 20 }),
    catalogService.listForInstitution(institutionId, actor).catch(() => []),
    SimulationModel.countByBuildStatus({ institutionId }),
  ]);

  return {
    role: 'institution_admin',
    scope: {
      institution_id: institutionId, institution_name: scope.institutionName,
      department_id: null, academic_year_id: null, semester_term_id: null,
    },
    kpis: {
      departmentsCount: departments.length,
      academicYearsCount,
      semesterTermsCount,
      totalUsers: userCounts.total,
      studentsCount: roleCounts.student ?? 0,
      instructorsCount: roleCounts.instructor ?? 0,
      deptManagersCount: roleCounts.dept_manager ?? 0,
      activeCourses: publishedCourses + draftCourses,
      publishedCourses,
      draftCourses,
      pendingUserTasks: missingAssignmentUsers.length,
      unreadNotifications,
      assignedSimulationCatalogs: assignedCatalogs.length,
      webglReady: buildStatus.ready,
      webglFailed: buildStatus.failed,
    },
    sections: {
      academicStructure: departments.map((d) => ({ id: d.id, name: d.name, code: d.code })),
      usersFollowUp: {
        usersMissingAcademicAssignment: missingAssignmentUsers,
        departmentsWithoutManager: deptsWithoutManager,
      },
      coursesFollowUp: {
        draftCourses,
        publishedCourses,
        coursesWithoutModules: coursesWithoutModules.map((c) => ({ id: c.id, title: c.title, status: c.status })),
      },
      simulationCatalogs: {
        catalogs: assignedCatalogs.slice(0, 10),
        webglReady: buildStatus.ready,
        webglFailed: buildStatus.failed,
      },
    },
    quick_actions: [
      { label: 'Create Department', href: '/departments/new' },
      { label: 'Create Academic Year', href: '/institutions' },
      { label: 'Create User', href: '/users/new' },
      { label: 'Manage Users', href: '/users' },
      { label: 'View Notifications', href: '/notifications' },
      { label: 'View Mail', href: '/mail' },
    ],
    notifications: { unread: unreadNotifications, recent: [] },
    messages: { unread: unreadMessages, recent: [] },
    recent_activity: recentActivity,
  };
};
