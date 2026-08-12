'use strict';

/**
 * Analytics routes — SRS §4.14 ANL-01 to ANL-07. RBAC v2.
 *
 * GET /api/v1/analytics/institution      — institution-wide KPIs (admin/manager)
 * GET /api/v1/analytics/courses/:id      — course engagement (instructor/TA)
 * GET /api/v1/analytics/simulations/:id  — simulation performance (instructor/TA)
 * GET /api/v1/analytics/students/:id     — individual student dashboard (self or instructor)
 */

const { Router }           = require('express');
const analyticsController  = require('./analytics.controller');
const authenticate         = require('../../middleware/authenticate');
const { requirePermission, requireAnyPermission } = require('../../middleware/authorize');

const router = Router();
router.use(authenticate);

// Institution-level: admins and dept managers
router.get('/institution',
  requireAnyPermission('reports.view_institution', 'reports.view_department', 'reports.view_platform'),
  analyticsController.institution,
);

// Course-level: instructors, TAs, managers
router.get('/courses/:id',
  requireAnyPermission('reports.view_course', 'grades.view_course', 'progress.view_course'),
  analyticsController.course,
);

// Simulation performance: instructor or TA (simulation_sessions.view_course)
router.get('/simulations/:id',
  requireAnyPermission('simulation_sessions.view_course', 'simulation_sessions.view_department'),
  analyticsController.simulation,
);

// Student-level: own data or instructor/admin
router.get('/students/:id',
  analyticsController.student,   // service enforces own-data vs instructor check
);

module.exports = router;
