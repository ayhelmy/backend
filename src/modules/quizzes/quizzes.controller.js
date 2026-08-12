'use strict';

const svc = require('./quizzes.service');
const qtiImportSvc = require('./qti-import.service');
const qtiExportSvc = require('./qti-export.service');
const ApiResponse = require('../../utils/apiResponse');

exports.listQuizzes = async (req, res, next) => { try { ApiResponse.ok(res, 'Quizzes', await svc.listQuizzes(req.params.courseId, req.user)); } catch (e) { next(e); } };
exports.getQuiz     = async (req, res, next) => { try { ApiResponse.ok(res, 'Quiz', await svc.getQuiz(req.params.courseId, req.params.quizId, req.user)); } catch (e) { next(e); } };
exports.createQuiz  = async (req, res, next) => { try { ApiResponse.created(res, 'Quiz created', await svc.createQuiz(req.params.courseId, req.body, req.user)); } catch (e) { next(e); } };
exports.updateQuiz  = async (req, res, next) => { try { ApiResponse.ok(res, 'Quiz updated', await svc.updateQuiz(req.params.courseId, req.params.quizId, req.body, req.user)); } catch (e) { next(e); } };
exports.deleteQuiz  = async (req, res, next) => { try { await svc.deleteQuiz(req.params.courseId, req.params.quizId, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };
exports.publishQuiz = async (req, res, next) => { try { ApiResponse.ok(res, 'Quiz published', await svc.publishQuiz(req.params.courseId, req.params.quizId, req.user)); } catch (e) { next(e); } };

exports.listQuestions    = async (req, res, next) => { try { ApiResponse.ok(res, 'Questions', await svc.listQuestions(req.params.courseId, req.params.quizId, req.user)); } catch (e) { next(e); } };
exports.createQuestion   = async (req, res, next) => { try { ApiResponse.created(res, 'Question created', await svc.createQuestion(req.params.courseId, req.params.quizId, req.body, req.user)); } catch (e) { next(e); } };
exports.updateQuestion   = async (req, res, next) => { try { ApiResponse.ok(res, 'Question updated', await svc.updateQuestion(req.params.courseId, req.params.quizId, req.params.questionId, req.body, req.user)); } catch (e) { next(e); } };
exports.deleteQuestion   = async (req, res, next) => { try { await svc.deleteQuestion(req.params.courseId, req.params.quizId, req.params.questionId, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };
exports.reorderQuestions = async (req, res, next) => { try { ApiResponse.ok(res, 'Questions reordered', await svc.reorderQuestions(req.params.courseId, req.params.quizId, req.body.order, req.user)); } catch (e) { next(e); } };

exports.importQtiNewQuiz = async (req, res, next) => {
  try {
    const result = await qtiImportSvc.importQtiPackage({
      courseId: req.params.courseId, quizId: null, body: req.body,
      tempZipPath: req.file.path, actor: req.user,
    });
    ApiResponse.created(res, 'QTI package imported', result);
  } catch (e) { next(e); }
};

exports.importQtiIntoQuiz = async (req, res, next) => {
  try {
    const result = await qtiImportSvc.importQtiPackage({
      courseId: req.params.courseId, quizId: req.params.quizId, body: req.body,
      tempZipPath: req.file.path, actor: req.user,
    });
    ApiResponse.ok(res, 'QTI package imported', result);
  } catch (e) { next(e); }
};

exports.exportQti = async (req, res, next) => {
  try {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="quiz-${req.params.quizId}-qti.zip"`);
    await qtiExportSvc.streamQuizAsQti(req.params.courseId, req.params.quizId, req.user, res);
  } catch (e) { next(e); }
};
