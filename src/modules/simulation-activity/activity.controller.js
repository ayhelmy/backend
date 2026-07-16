'use strict';

const svc         = require('./activity.service');
const ApiResponse = require('../../utils/apiResponse');

exports.start = async (req, res, next) => {
  try {
    const { courseId, lessonId } = req.params;
    const data = await svc.start(
      { courseId, lessonId, simulationId: req.body.simulation_id ?? null },
      req.user,
      req,
    );
    ApiResponse.created(res, 'Simulation activity session started.', data);
  } catch (e) { next(e); }
};

exports.heartbeat = async (req, res, next) => {
  try {
    const data = await svc.heartbeat(req.params.sessionId, req.user);
    ApiResponse.ok(res, 'Heartbeat recorded.', data);
  } catch (e) { next(e); }
};

exports.end = async (req, res, next) => {
  try {
    const data = await svc.end(
      req.params.sessionId,
      { exitReason: req.body.exit_reason ?? null },
      req.user,
      req,
    );
    ApiResponse.ok(res, 'Simulation activity session ended.', data);
  } catch (e) { next(e); }
};

exports.listMyActivity = async (req, res, next) => {
  try {
    const { sessions, meta } = await svc.listMyActivity(req.query, req.user);
    ApiResponse.ok(res, 'My simulation activity.', sessions, meta);
  } catch (e) { next(e); }
};

exports.listCourseActivity = async (req, res, next) => {
  try {
    const { sessions, summary, meta } = await svc.listCourseActivity(
      req.params.courseId, req.query, req.user,
    );
    ApiResponse.ok(res, 'Course simulation activity.', { sessions, summary }, meta);
  } catch (e) { next(e); }
};

exports.listLessonActivity = async (req, res, next) => {
  try {
    const { sessions, meta } = await svc.listLessonActivity(
      req.params.courseId, req.params.lessonId, req.query, req.user,
    );
    ApiResponse.ok(res, 'Lesson simulation activity.', sessions, meta);
  } catch (e) { next(e); }
};

exports.getLatestSessionForLesson = async (req, res, next) => {
  try {
    const data = await svc.getLatestSessionForLesson(
      req.params.lessonId,
      req.query.simulation_id,
      req.user,
    );
    ApiResponse.ok(res, 'Latest session.', data);
  } catch (e) { next(e); }
};

exports.recordClicks = async (req, res, next) => {
  try {
    const data = await svc.recordClicks(
      req.params.sessionId,
      req.body.clicks,
      req.user,
    );
    ApiResponse.ok(res, 'Clicks recorded.', data);
  } catch (e) { next(e); }
};

exports.downloadClicksCsv = async (req, res, next) => {
  try {
    const { csv, filename, clickCount } = await svc.downloadClicksCsv(
      req.params.sessionId,
      req.user,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Click-Count', String(clickCount));
    res.send(csv);
  } catch (e) { next(e); }
};

exports.getSimulationAnalytics = async (req, res, next) => {
  try {
    const data = await svc.getSimulationAnalytics(
      req.params.courseId, req.params.simulationId, req.user,
    );
    ApiResponse.ok(res, 'Simulation analytics.', data);
  } catch (e) { next(e); }
};

exports.getClickEvents = async (req, res, next) => {
  try {
    const data = await svc.getClickEvents(req.params.sessionId, req.user);
    ApiResponse.ok(res, 'Click events.', data);
  } catch (e) { next(e); }
};

exports.getClickStats = async (req, res, next) => {
  try {
    const data = await svc.getClickStats(req.params.sessionId, req.user);
    ApiResponse.ok(res, 'Click stats.', data);
  } catch (e) { next(e); }
};

exports.cleanupStaleSessions = async (req, res, next) => {
  try {
    const timeoutMinutes = parseInt(req.query.timeout_minutes, 10) || 5;
    const result = await svc.cleanupStaleSessions(timeoutMinutes);
    ApiResponse.ok(res, 'Stale sessions cleaned up.', result);
  } catch (e) { next(e); }
};
