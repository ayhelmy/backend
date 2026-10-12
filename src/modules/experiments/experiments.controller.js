'use strict';

const trackingService    = require('./tracking.service');
const progressService    = require('./progress.service');
const completionService  = require('./completion-lookup.service');
const { LmsExperimentAttemptModel } = require('../../db/models');
const ApiResponse = require('../../utils/apiResponse');

/**
 * Accepts either a single event payload or { events: [...] }. Each event is
 * processed independently and in order — one bad event in a batch never
 * aborts the rest, so the client's durable queue gets a precise per-eventId
 * status to decide what to retry.
 */
exports.postEvents = async (req, res, next) => {
  try {
    const isBatch = Array.isArray(req.body?.events);
    const events = isBatch ? req.body.events : [req.body];

    const results = [];
    for (const evt of events) {
      try {
        results.push(await trackingService.processEvent(evt, req.user));
      } catch (err) {
        results.push({ eventId: evt?.eventId ?? null, status: 'rejected', reason: err.message });
      }
    }

    ApiResponse.ok(res, 'Events processed.', isBatch ? results : results[0]);
  } catch (e) { next(e); }
};

exports.getProgress = async (req, res, next) => {
  try {
    const data = await progressService.getProgress({
      learnerId:           req.user.id,
      projectId:           req.query.projectId,
      assessmentVersion:   req.query.assessmentVersion,
      experimentId:        req.query.experimentId,
      experimentAttemptId: req.query.experimentAttemptId || null,
    });
    ApiResponse.ok(res, 'Progress.', data);
  } catch (e) { next(e); }
};

exports.getCompletion = async (req, res, next) => {
  try {
    const data = await completionService.getCompletion({
      learnerId:         req.user.id,
      projectId:         req.query.projectId,
      assessmentVersion: req.query.assessmentVersion,
      experimentId:      req.query.experimentId,
    });
    ApiResponse.ok(res, 'Completion.', data);
  } catch (e) { next(e); }
};

exports.getHistory = async (req, res, next) => {
  try {
    const attempts = await LmsExperimentAttemptModel.listByLearner(req.user.id, req.query.projectId);
    const data = attempts.map((a) => ({
      experimentAttemptId: a.experiment_attempt_id,
      sessionId:           a.session_id,
      projectVersion:      a.project_version,
      assessmentVersion:   a.assessment_version,
      experimentId:        a.experiment_id,
      status:              a.status,
      startedAt:           a.started_at,
      endedAt:             a.ended_at,
    }));
    ApiResponse.ok(res, 'History.', data);
  } catch (e) { next(e); }
};
