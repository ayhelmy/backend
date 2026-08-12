'use strict';

/**
 * Quiz attempts service — read/list scaffolding plus the full attempt-taking
 * lifecycle (start/save-responses/submit/auto-grade). Tenant isolation: 404
 * (not 403) on cross-institution course access.
 */

const { pool } = require('../../config/database');
const {
  QuizModel, QuizQuestionModel, QuizAttemptModel, CourseModel, AuditModel, GradeModel,
} = require('../../db/models');
const ApiError = require('../../utils/apiError');
const { scoreResponse } = require('./quiz-scoring.util');
const eventDispatcher = require('../notifications/event-dispatcher.service');
const recipientResolver = require('../notifications/recipient-resolver.service');

function assertCourseScope(course, actor) {
  if (!course) throw ApiError.notFound('Course not found.');
  if (actor.roles?.includes('super_admin')) return;
  if (course.institution_id !== actor.institutionId) throw ApiError.notFound('Course not found.');
}

function canViewAllAttempts(actor) {
  return actor.roles?.includes('super_admin')
    || actor.permissions?.includes('quiz_attempts.view_course');
}

function mapAttempt(row) {
  if (!row) return null;
  return {
    id:               row.id,
    quizId:           row.quiz_id,
    userId:           row.user_id,
    institutionId:    row.institution_id,
    departmentId:     row.department_id ?? null,
    courseId:         row.course_id,
    lessonId:         row.lesson_id ?? null,
    attemptNumber:    row.attempt_number,
    status:           row.status,
    startedAt:        row.started_at,
    submittedAt:      row.submitted_at ?? null,
    gradedAt:         row.graded_at ?? null,
    timeSpentSeconds: row.time_spent_seconds,
    autoScore:        row.auto_score        != null ? Number(row.auto_score)        : null,
    manualScore:      row.manual_score      != null ? Number(row.manual_score)      : null,
    finalScore:       row.final_score       != null ? Number(row.final_score)       : null,
    pointsPossible:   row.points_possible   != null ? Number(row.points_possible)   : null,
    percentage:       row.percentage        != null ? Number(row.percentage)        : null,
    passed:           row.passed,
    gradedBy:         row.graded_by ?? null,
    createdAt:        row.created_at,
    updatedAt:        row.updated_at ?? null,
    ...(row.student_first_name !== undefined && {
      studentName:  `${row.student_first_name} ${row.student_last_name}`,
      studentEmail: row.student_email,
    }),
  };
}

// Shared by submitAttempt (auto-grading) and gradeAttempt (manual grading) so both paths
// derive pass/fail from the quiz's configured threshold identically.
function computePassed(quiz, finalScore, percentage) {
  if (quiz.passing_percentage != null) return percentage != null && percentage >= Number(quiz.passing_percentage);
  if (quiz.passing_score != null) return finalScore >= Number(quiz.passing_score);
  return null;
}

function mapResponse(row) {
  return {
    id:             row.id,
    attemptId:      row.attempt_id,
    questionId:     row.question_id,
    responsePayload: row.response_payload ?? {},
    isCorrect:      row.is_correct,
    autoScore:      row.auto_score   != null ? Number(row.auto_score)   : null,
    manualScore:    row.manual_score != null ? Number(row.manual_score) : null,
    finalScore:     row.final_score  != null ? Number(row.final_score)  : null,
    feedback:       row.feedback ?? null,
    answeredAt:     row.answered_at ?? null,
    gradedBy:       row.graded_by ?? null,
    gradedAt:       row.graded_at ?? null,
  };
}

async function loadQuizInCourse(courseId, quizId) {
  const quiz = await QuizModel.findById(quizId);
  if (!quiz || quiz.course_id !== courseId) throw ApiError.notFound('Quiz not found in this course.');
  return quiz;
}

// ── Score/answer visibility gates (server-side enforcement of show_score_policy /
// show_answers_policy — the frontend also branches on these for UX, but this is the
// actual boundary, matching the SRS requirement that correct answers/scores must not
// leak before the configured release point). Only applied to the owning student's own
// view; instructors/TAs/admins (canViewAllAttempts) always see everything. ──────────

function policyAllowsNow(policy, quiz, attemptsUsed) {
  switch (policy) {
    case 'never': return false;
    case 'after_due_date': return !quiz.due_at || new Date() >= new Date(quiz.due_at);
    case 'after_final_attempt': return attemptsUsed >= quiz.max_attempts;
    case 'immediately':
    default: return true;
  }
}

function sanitizeAttemptForOwner(mappedAttempt, quiz, attemptsUsed) {
  if (policyAllowsNow(quiz.show_score_policy, quiz, attemptsUsed)) return mappedAttempt;
  return { ...mappedAttempt, autoScore: null, manualScore: null, finalScore: null, percentage: null, passed: null };
}

function sanitizeResponsesForOwner(mappedResponses, quiz, attemptsUsed) {
  if (policyAllowsNow(quiz.show_answers_policy, quiz, attemptsUsed)) return mappedResponses;
  return mappedResponses.map((r) => ({ ...r, isCorrect: null, feedback: null }));
}

// ── listAttempts ──────────────────────────────────────────────────────────────
// Instructors/TAs/admins see all attempts for the quiz; students are not
// permitted to list attempts in bulk (they use their own attempt history,
// added in Phase 3 alongside the "attempts/me" endpoint).

exports.listAttempts = async (courseId, quizId, actor, status) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  await loadQuizInCourse(courseId, quizId);

  if (!canViewAllAttempts(actor)) {
    throw ApiError.forbidden('Only instructors, TAs, and admins can view all attempts for a quiz.');
  }

  const rows = await QuizAttemptModel.listByQuiz(quizId, { status });
  return rows.map(mapAttempt);
};

// ── getAttempt ────────────────────────────────────────────────────────────────
// Owner (view_own) or instructor/TA/admin (view_course) may view a single attempt.

exports.getAttempt = async (courseId, quizId, attemptId, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  const quiz = await loadQuizInCourse(courseId, quizId);

  const attempt = await QuizAttemptModel.findById(attemptId);
  if (!attempt || attempt.quiz_id !== quizId) throw ApiError.notFound('Attempt not found for this quiz.');

  const isOwner = attempt.user_id === actor.id;
  if (!isOwner && !canViewAllAttempts(actor)) {
    throw ApiError.forbidden('You can only view your own quiz attempts.');
  }

  const responses = await QuizAttemptModel.listResponses(attemptId);
  let mappedAttempt = mapAttempt(attempt);
  let mappedResponses = responses.map(mapResponse);

  if (isOwner && !canViewAllAttempts(actor)) {
    const attemptsUsed = await QuizAttemptModel.countByQuizAndUser(quizId, actor.id);
    mappedAttempt = sanitizeAttemptForOwner(mappedAttempt, quiz, attemptsUsed);
    mappedResponses = sanitizeResponsesForOwner(mappedResponses, quiz, attemptsUsed);
  }

  return { ...mappedAttempt, responses: mappedResponses };
};

// ── getMyAttempts ─────────────────────────────────────────────────────────────
// Student's own attempt history for a quiz (score/answers gated by policy).

exports.getMyAttempts = async (courseId, quizId, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  const quiz = await loadQuizInCourse(courseId, quizId);

  const rows = await QuizAttemptModel.listByQuizAndUser(quizId, actor.id);
  const attemptsUsed = rows.length;
  const canSeeAll = canViewAllAttempts(actor);

  return rows.map((row) => {
    const mapped = mapAttempt(row);
    return canSeeAll ? mapped : sanitizeAttemptForOwner(mapped, quiz, attemptsUsed);
  });
};

// ── startAttempt ──────────────────────────────────────────────────────────────
// Enrollment + availability-window + max-attempts enforcement; resumes an
// existing in_progress attempt instead of creating a duplicate.

exports.startAttempt = async (courseId, quizId, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  const quiz = await loadQuizInCourse(courseId, quizId);

  if (quiz.status !== 'published') throw ApiError.badRequest('This quiz is not published.');

  const now = new Date();
  if (quiz.available_from && now < new Date(quiz.available_from)) {
    throw ApiError.forbidden('This quiz is not yet available.');
  }
  if (quiz.available_until && now > new Date(quiz.available_until)) {
    throw ApiError.forbidden('This quiz is no longer available.');
  }

  if (!actor.roles?.includes('super_admin')) {
    const enrollment = await CourseModel.findEnrollment(courseId, actor.id);
    if (!enrollment || enrollment.status !== 'active') {
      throw ApiError.forbidden('You must be enrolled in this course to take this quiz.');
    }
  }

  const existing = await QuizAttemptModel.findInProgress(quizId, actor.id);
  if (existing) return mapAttempt(existing);

  const attemptCount = await QuizAttemptModel.countByQuizAndUser(quizId, actor.id);
  if (attemptCount >= quiz.max_attempts) {
    throw ApiError.badRequest('You have used the maximum number of attempts for this quiz.');
  }

  const questions = await QuizQuestionModel.listByQuiz(quizId);
  if (!questions.length) throw ApiError.badRequest('This quiz has no questions yet.');
  const pointsPossible = questions.reduce((sum, q) => sum + Number(q.points), 0);

  let attempt;
  try {
    attempt = await QuizAttemptModel.create({
      quizId,
      userId: actor.id,
      institutionId: quiz.institution_id,
      departmentId: quiz.department_id ?? null,
      courseId,
      lessonId: quiz.lesson_id ?? null,
      attemptNumber: attemptCount + 1,
      pointsPossible,
    });
  } catch (err) {
    // Two concurrent start calls (double click, double-mounted effect) can both pass the
    // count check above and race to insert the same attempt_number. The loser hits
    // quiz_attempts_quiz_user_number_unique — the winner's row is already committed by
    // then, so resume it instead of erroring (same semantics as the normal resume branch).
    if (err.code === '23505') {
      const winner = await QuizAttemptModel.findInProgress(quizId, actor.id);
      if (winner) return mapAttempt(winner);
      throw ApiError.conflict('Please try starting the quiz again.');
    }
    throw err;
  }

  await AuditModel.log({
    institutionId: quiz.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'quiz_attempt.start', entityType: 'QuizAttempt', entityId: attempt.id,
    delta: { after: { quizId, courseId, attemptNumber: attempt.attempt_number } },
  });

  return mapAttempt(attempt);
};

// ── saveResponses ─────────────────────────────────────────────────────────────
// quizId is derived from the attempt row, not the URL (route shape is
// /courses/:courseId/quiz-attempts/:attemptId/responses — no :quizId segment).

exports.saveResponses = async (courseId, attemptId, responses, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);

  const attempt = await QuizAttemptModel.findById(attemptId);
  if (!attempt || attempt.course_id !== courseId) throw ApiError.notFound('Attempt not found in this course.');
  if (attempt.user_id !== actor.id) throw ApiError.forbidden('You can only save your own attempt responses.');
  if (attempt.status !== 'in_progress') throw ApiError.badRequest('This attempt is no longer in progress.');

  const questions = await QuizQuestionModel.listByQuiz(attempt.quiz_id);
  const questionIds = new Set(questions.map((q) => q.id));

  for (const r of responses) {
    if (!questionIds.has(r.questionId)) {
      throw ApiError.badRequest(`Question ${r.questionId} does not belong to this attempt's quiz.`);
    }
  }

  for (const r of responses) {
    await QuizAttemptModel.upsertResponse({
      attemptId, questionId: r.questionId, responsePayload: r.responsePayload,
    });
  }

  return { saved: responses.length };
};

// ── submitAttempt ─────────────────────────────────────────────────────────────

exports.submitAttempt = async (courseId, attemptId, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);

  const attempt = await QuizAttemptModel.findById(attemptId);
  if (!attempt || attempt.course_id !== courseId) throw ApiError.notFound('Attempt not found in this course.');
  if (attempt.user_id !== actor.id) throw ApiError.forbidden('You can only submit your own attempt.');
  if (attempt.status !== 'in_progress') throw ApiError.badRequest('This attempt has already been submitted.');

  const quiz = await QuizModel.findById(attempt.quiz_id);
  const questions = await QuizQuestionModel.listByQuiz(attempt.quiz_id);
  const responses = await QuizAttemptModel.listResponses(attemptId);
  const responseByQuestion = new Map(responses.map((r) => [r.question_id, r]));

  let totalAutoScore = 0;
  let anyManual = false;

  for (const question of questions) {
    const responseRow = responseByQuestion.get(question.id);
    const payload = responseRow?.response_payload ?? {};
    const options = QuizQuestionModel.OPTION_BASED_TYPES.includes(question.question_type)
      ? await QuizQuestionModel.listOptions(question.id)
      : [];

    const result = scoreResponse(question, options, payload);
    if (result.requiresManualGrading) {
      anyManual = true;
    } else {
      totalAutoScore += result.autoScore ?? 0;
    }

    if (responseRow) {
      await QuizAttemptModel.updateResponseScore(responseRow.id, {
        isCorrect: result.isCorrect,
        autoScore: result.autoScore,
        finalScore: result.requiresManualGrading ? null : result.autoScore,
      });
    }
  }

  const pointsPossible = attempt.points_possible != null
    ? Number(attempt.points_possible)
    : questions.reduce((sum, q) => sum + Number(q.points), 0);
  const now = new Date();
  const timeSpentSeconds = Math.max(0, Math.round((now.getTime() - new Date(attempt.started_at).getTime()) / 1000));

  let status, finalScore, percentage, passed, gradedAt;
  if (anyManual) {
    status = 'pending_manual_grading';
    finalScore = null; percentage = null; passed = null; gradedAt = null;
  } else {
    status = 'graded';
    finalScore = Math.round(totalAutoScore * 100) / 100;
    percentage = pointsPossible > 0 ? Math.round((finalScore / pointsPossible) * 10000) / 100 : null;
    passed = computePassed(quiz, finalScore, percentage);
    gradedAt = now;
  }

  const updated = await QuizAttemptModel.submit(attemptId, {
    status, submittedAt: now, gradedAt,
    autoScore: Math.round(totalAutoScore * 100) / 100, manualScore: null, finalScore,
    pointsPossible, percentage, passed, timeSpentSeconds,
  });
  if (!updated) throw ApiError.badRequest('This attempt has already been submitted.');

  if (status === 'graded') {
    await applyGradeSync(quiz, actor.id, courseId);
  }

  await AuditModel.log({
    institutionId: quiz.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'quiz_attempt.submit', entityType: 'QuizAttempt', entityId: attemptId,
    delta: { after: { status, finalScore, percentage } },
  });

  if (status === 'pending_manual_grading' && course.instructor_id) {
    eventDispatcher.emit('quiz_attempt.manual_grading_required', {
      recipientIds: [course.instructor_id],
      senderId: actor.id,
      institutionId: quiz.institution_id,
      departmentId: quiz.department_id ?? null,
      courseId,
      data: { studentName: `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim() || 'A student', quizTitle: quiz.title, quizId: quiz.id, attemptId, courseId },
    });
  } else if (status === 'graded') {
    eventDispatcher.emit('quiz_attempt.graded', {
      recipientIds: [actor.id],
      institutionId: quiz.institution_id,
      departmentId: quiz.department_id ?? null,
      courseId,
      data: { quizTitle: quiz.title, quizId: quiz.id, courseId },
    });
  }

  const finalResponses = await QuizAttemptModel.listResponses(attemptId);
  return { ...mapAttempt(updated), responses: finalResponses.map(mapResponse) };
};

// ── gradeAttempt ──────────────────────────────────────────────────────────────
// Instructor/TA manual grading pass for questions scoreResponse() couldn't auto-grade
// (long_text, or any question with manual_grading=true) — the ones submitAttempt left
// with final_score=null and the attempt stuck in 'pending_manual_grading'.

exports.gradeAttempt = async (courseId, attemptId, responses, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);

  if (!actor.roles?.includes('super_admin') && !actor.permissions?.includes('quiz_attempts.manage')) {
    throw ApiError.forbidden('Only instructors, TAs, and admins can grade quiz attempts.');
  }

  const attempt = await QuizAttemptModel.findById(attemptId);
  if (!attempt || attempt.course_id !== courseId) throw ApiError.notFound('Attempt not found in this course.');
  if (!['pending_manual_grading', 'graded'].includes(attempt.status)) {
    throw ApiError.badRequest('This attempt is not awaiting grading.');
  }

  const quiz = await QuizModel.findById(attempt.quiz_id);
  const questions = await QuizQuestionModel.listByQuiz(attempt.quiz_id);
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const existingResponses = await QuizAttemptModel.listResponses(attemptId);
  const responseById = new Map(existingResponses.map((r) => [r.id, r]));

  let manualScore = 0;
  for (const { responseId, score, feedback } of responses) {
    const responseRow = responseById.get(responseId);
    if (!responseRow) throw ApiError.badRequest(`Response ${responseId} does not belong to this attempt.`);
    const question = questionById.get(responseRow.question_id);
    const points = Number(question?.points ?? 0);
    const clamped = Math.max(0, Math.min(points, Number(score) || 0));
    const isCorrect = clamped === points ? true : clamped === 0 ? false : null;
    manualScore += clamped;
    await QuizAttemptModel.gradeResponse(responseId, {
      isCorrect, finalScore: clamped, feedback: feedback ?? null, gradedBy: actor.id,
    });
  }
  manualScore = Math.round(manualScore * 100) / 100;

  const finalResponses = await QuizAttemptModel.listResponses(attemptId);
  const finalScore = Math.round(
    finalResponses.reduce((sum, r) => sum + (r.final_score != null ? Number(r.final_score) : 0), 0) * 100,
  ) / 100;
  const pointsPossible = attempt.points_possible != null
    ? Number(attempt.points_possible)
    : questions.reduce((sum, q) => sum + Number(q.points), 0);
  const percentage = pointsPossible > 0 ? Math.round((finalScore / pointsPossible) * 10000) / 100 : null;
  const passed = computePassed(quiz, finalScore, percentage);
  const now = new Date();

  const updated = await QuizAttemptModel.grade(attemptId, {
    gradedAt: now, gradedBy: actor.id, manualScore, finalScore, percentage, passed,
  });
  if (!updated) throw ApiError.badRequest('This attempt could not be graded.');

  await applyGradeSync(quiz, attempt.user_id, courseId);

  await AuditModel.log({
    institutionId: quiz.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'quiz_attempt.grade', entityType: 'QuizAttempt', entityId: attemptId,
    delta: { after: { finalScore, percentage, passed } },
  });

  eventDispatcher.emit('quiz_attempt.graded', {
    recipientIds: [attempt.user_id],
    senderId: actor.id,
    institutionId: quiz.institution_id,
    departmentId: quiz.department_id ?? null,
    courseId,
    data: { quizTitle: quiz.title, quizId: quiz.id, courseId },
  });

  return { ...mapAttempt(updated), responses: finalResponses.map(mapResponse) };
};

// ── applyGradeSync (private) ──────────────────────────────────────────────────
// Selects a grade per quiz.attempt_scoring_mode across the user's graded
// attempts and upserts it into the gradebook. The grade_items row is created
// lazily on the first graded result for this quiz — never eagerly at
// quiz-creation/publish time (matches the migration-compatibility rule).

async function applyGradeSync(quiz, userId, courseId) {
  const attempts = await QuizAttemptModel.listGradedByQuizAndUser(quiz.id, userId);
  const finals = attempts.filter((a) => a.status === 'graded' && a.final_score != null);
  if (!finals.length) return;

  let chosen;
  switch (quiz.attempt_scoring_mode) {
    case 'first':
      chosen = finals[0];
      break;
    case 'highest':
      chosen = finals.reduce((best, a) => (Number(a.final_score) > Number(best.final_score) ? a : best));
      break;
    case 'average': {
      const avg = finals.reduce((sum, a) => sum + Number(a.final_score), 0) / finals.length;
      // No single "correct" attempt to trace an averaged score back to — point at the
      // latest attempt for quiz_attempt_id traceability, with the averaged score value.
      chosen = { ...finals[finals.length - 1], final_score: avg };
      break;
    }
    case 'latest':
    default:
      chosen = finals[finals.length - 1];
  }

  const { rows: existingItems } = await pool.query(
    `SELECT id FROM grade_items WHERE course_id = $1 AND quiz_id = $2 AND item_type = 'quiz'`,
    [courseId, quiz.id],
  );
  let itemId = existingItems[0]?.id;
  if (!itemId) {
    const item = await GradeModel.createGradeItem({
      courseId, title: quiz.title, itemType: 'quiz', quizId: quiz.id,
      maxPoints: Number(chosen.points_possible ?? quiz.points_possible), weight: 1, dueDate: quiz.due_at ?? null,
    });
    itemId = item.id;
  }

  await GradeModel.upsertGrade({
    gradeItemId: itemId,
    userId,
    score: Number(chosen.final_score),
    pointsPossible: Number(chosen.points_possible ?? quiz.points_possible),
    isOverride: false,
    overrideNote: null,
    gradedBy: null,
    quizAttemptId: chosen.id,
  });
}
