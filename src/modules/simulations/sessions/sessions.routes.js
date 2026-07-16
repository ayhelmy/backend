/**
 * Simulation session routes — SRS §4.7 SIM-03, §4.8 GRD-01.
 * POST /api/v1/simulation-sessions          — start a new session
 * GET  /api/v1/simulation-sessions/:id      — get session state
 * PATCH /api/v1/simulation-sessions/:id     — update SCORM state (suspend_data, score)
 * POST /api/v1/simulation-sessions/:id/complete
 * GET  /api/v1/simulation-sessions/:id/events
 */
'use strict';

const { Router } = require('express');
const sessionsController = require('./sessions.controller');
const validate = require('../../../middleware/validate');
const authenticate = require('../../../middleware/authenticate');
const sessionsValidators = require('./sessions.validators');

const router = Router();
router.use(authenticate);

router.post('/',            sessionsValidators.start,  validate, sessionsController.start);
router.get('/:id',                                              sessionsController.getOne);
router.patch('/:id',        sessionsValidators.update, validate, sessionsController.update);
router.post('/:id/complete',                                    sessionsController.complete);
router.get('/:id/events',                                       sessionsController.listEvents);

module.exports = router;
