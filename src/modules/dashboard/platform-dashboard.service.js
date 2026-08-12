'use strict';

/** Super-admin platform dashboard — GET /api/v1/dashboard/platform. */

const {
  CourseModel, NotificationModel, MailModel, SimulationModel, QuizAttemptModel, SimulationCatalogModel,
} = require('../../db/models');
const institutionsService = require('../institutions/institutions.service');
const usersService = require('../users/users.service');
const catalogService = require('../simulation-catalogs/catalog.service');
const activityService = require('./dashboard-activity.service');

module.exports = async function getPlatformDashboard(actor) {
  const [
    institutionCounts, userCounts, courseCounts, activeCourses,
    catalogsTotal, buildStatus, pendingQuizGrading, unreadNotifications, unreadMessages,
    institutionOverview, catalogOverview, recentActivity,
  ] = await Promise.all([
    institutionsService.countByStatus(),
    usersService.countByStatus({}),
    CourseModel.countByFilters({}),
    CourseModel.countByFilters({ status: 'published' }),
    SimulationCatalogModel.list({}).then((rows) => rows.length),
    SimulationModel.countByBuildStatus({}),
    QuizAttemptModel.countPendingManualGrading({}),
    NotificationModel.unreadCount(actor.id),
    MailModel.unreadCount(actor.id),
    institutionsService.listOverview(),
    catalogService.platformAssignmentOverview(),
    activityService.getRecentActivity({ limit: 20 }),
  ]);

  return {
    role: 'super_admin',
    scope: { institution_id: null, department_id: null, academic_year_id: null, semester_term_id: null },
    kpis: {
      totalInstitutions: institutionCounts.total,
      activeInstitutions: institutionCounts.active,
      suspendedInstitutions: institutionCounts.suspended,
      totalUsers: userCounts.total,
      activeUsers: userCounts.active,
      totalCourses: courseCounts,
      activeCourses,
      totalSimulationCatalogs: catalogsTotal,
      totalWebGLSimulations: buildStatus.ready + buildStatus.failed + buildStatus.processing,
      webglBuildsReady: buildStatus.ready,
      webglBuildsFailed: buildStatus.failed,
      pendingQuizGrading,
      // No storage-accounting or system-alerting subsystem exists yet — real
      // zero, not a fabricated number. Revisit once those land.
      storageUsedGb: null,
      systemAlerts: 0,
      unreadPlatformNotifications: unreadNotifications,
    },
    sections: {
      institutionOverview: institutionOverview.slice(0, 20),
      simulationCatalogAssignment: catalogOverview,
      systemHealth: {
        webglBuildsReady: buildStatus.ready,
        webglBuildsFailed: buildStatus.failed,
        webglBuildsProcessing: buildStatus.processing,
        backgroundJobs: null,
      },
    },
    quick_actions: [
      { label: 'Create Institution', href: '/institutions/new' },
      { label: 'Manage Institutions', href: '/institutions' },
      { label: 'Manage Simulation Catalogs', href: '/simulation-catalogs' },
      { label: 'View Audit Logs', href: '/audit-logs' },
      { label: 'System Settings', href: '/settings' },
    ],
    notifications: { unread: unreadNotifications, recent: [] },
    messages: { unread: unreadMessages, recent: [] },
    recent_activity: recentActivity,
  };
};
