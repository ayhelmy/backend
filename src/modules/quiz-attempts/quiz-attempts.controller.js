'use strict';

const svc = require('./quiz-attempts.service');
const ApiResponse = require('../../utils/apiResponse');

exports.listAttempts = async (req, res, next) => {
  try { ApiResponse.ok(res, 'Quiz attempts', await svc.listAttempts(req.params.courseId, req.params.quizId, req.user, req.query.status)); }
  catch (e) { next(e); }
};

exports.getAttempt = async (req, res, next) => {
  try { ApiResponse.ok(res, 'Quiz attempt', await svc.getAttempt(req.params.courseId, req.params.quizId, req.params.attemptId, req.user)); }
  catch (e) { next(e); }
};

exports.getMyAttempts = async (req, res, next) => {
  try { ApiResponse.ok(res, 'My quiz attempts', await svc.getMyAttempts(req.params.courseId, req.params.quizId, req.user)); }
  catch (e) { next(e); }
};

exports.startAttempt = async (req, res, next) => {
  try { ApiResponse.ok(res, 'Quiz attempt started', await svc.startAttempt(req.params.courseId, req.params.quizId, req.user)); }
  catch (e) { next(e); }
};

exports.saveResponses = async (req, res, next) => {
  try { ApiResponse.ok(res, 'Responses saved', await svc.saveResponses(req.params.courseId, req.params.attemptId, req.body.responses, req.user)); }
  catch (e) { next(e); }
};

exports.submitAttempt = async (req, res, next) => {
  try { ApiResponse.ok(res, 'Quiz submitted', await svc.submitAttempt(req.params.courseId, req.params.attemptId, req.user)); }
  catch (e) { next(e); }
};

exports.gradeAttempt = async (req, res, next) => {
  try { ApiResponse.ok(res, 'Quiz attempt graded', await svc.gradeAttempt(req.params.courseId, req.params.attemptId, req.body.responses, req.user)); }
  catch (e) { next(e); }
};
