'use strict';

/**
 * Role-based dashboard routes — GET /api/v1/dashboard/*.
 * /me auto-detects the caller's highest-ranked role + scope; the explicit
 * per-role routes are gated by `authorize(ROLE)` so a mismatched role gets a
 * 403 even if they guess the URL. guest matches no role here, so every route
 * 403s for guests (including /me, via the dispatcher's own check).
 */

const { Router } = require('express');
const controller = require('./dashboard.controller');
const authenticate = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const { ROLES } = require('../../constants/roles');

const router = Router();
router.use(authenticate);

router.get('/me', controller.getMe);
router.get('/platform', authorize(ROLES.SUPER_ADMIN), controller.getPlatform);
router.get('/institution', authorize(ROLES.INSTITUTION_ADMIN), controller.getInstitution);
router.get('/department', authorize(ROLES.DEPT_MANAGER), controller.getDepartment);
router.get('/instructor', authorize(ROLES.INSTRUCTOR), controller.getInstructor);
router.get('/ta', authorize(ROLES.TEACHING_ASSISTANT), controller.getTa);
router.get('/student', authorize(ROLES.STUDENT), controller.getStudent);

module.exports = router;
