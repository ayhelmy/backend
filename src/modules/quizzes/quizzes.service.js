'use strict';

/**
 * Quizzes service — Phase 1: authoring CRUD + question management scaffolding.
 * QTI import/export is Phase 2. Attempt/scoring engine is Phase 3.
 *
 * Tenant isolation: every op asserts course.institution_id == actor.institutionId
 * (404, not 403, on mismatch — prevents cross-tenant resource enumeration).
 * Write ops (create/update/delete/publish/questions) are instructor-owns-course
 * only; middleware already gates on the quizzes.* permission set (migration 051),
 * this is a defense-in-depth re-check matching the modules-lessons pattern.
 */

const sanitizeHtml = require('sanitize-html');
const {
  QuizModel, QuizQuestionModel, ModuleModel, CourseModel, AuditModel,
} = require('../../db/models');
const ApiError = require('../../utils/apiError');
const eventDispatcher = require('../notifications/event-dispatcher.service');
const recipientResolver = require('../notifications/recipient-resolver.service');

// ── Helpers ───────────────────────────────────────────────────────────────────

function assertCourseScope(course, actor) {
  if (!course) throw ApiError.notFound('Course not found.');
  if (actor.roles?.includes('super_admin')) return;
  if (course.institution_id !== actor.institutionId) throw ApiError.notFound('Course not found.');
}

function assertOwnsCourse(course, actor) {
  if (actor.roles?.includes('super_admin')) return;
  if (course.instructor_id !== actor.id) {
    throw ApiError.forbidden('You can only manage quizzes for courses you own.');
  }
}

function canSeeAnswers(course, actor) {
  return actor.roles?.includes('super_admin') || course.instructor_id === actor.id;
}

// Correct-answer field names per question_type inside question_data — stripped for
// students taking a quiz so the wire response never leaks answers before submission
// (SRS requirement: "do not expose correct answers before submission"). Keys not
// listed here (sourceChoices/targetChoices/items/wordBank/blanks[].gapId, etc.) are
// the non-answer structural parts students need to see the question and are kept.
function sanitizeQuestionDataForStudent(questionType, questionData) {
  const data = { ...(questionData ?? {}) };
  switch (questionType) {
    case 'short_text':
      delete data.acceptedAnswers;
      break;
    case 'numeric':
    case 'numeric_tolerance':
      delete data.correctValue;
      delete data.tolerance;
      delete data.toleranceMode;
      break;
    case 'matching':
      delete data.pairs;
      break;
    case 'ordering':
      delete data.correctOrder;
      break;
    case 'fill_in_blank':
    case 'multiple_fill_in_blank':
      if (Array.isArray(data.blanks)) {
        data.blanks = data.blanks.map((b) => ({ gapId: b.gapId }));
      }
      break;
    default:
      break;
  }
  return data;
}

function sanitizeQuestionForStudent(mappedQuestion) {
  return {
    ...mappedQuestion,
    questionData: sanitizeQuestionDataForStudent(mappedQuestion.questionType, mappedQuestion.questionData),
    responseDeclaration: {},
    scoringConfig: {},
    options: mappedQuestion.options.map((o) => ({
      id: o.id, optionIdentifier: o.optionIdentifier, content: o.content, position: o.position,
      // isCorrect / feedback intentionally omitted
    })),
  };
}

// Rich-text fields (prompt, description, instructions, option content, feedback)
// are sanitized on write from day one — the QTI importer (qti-import.service.js)
// reuses this same function for externally-sourced HTML.
function sanitizeRichText(html) {
  if (html == null) return html;
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
    allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, img: ['src', 'alt'] },
  });
}

// Exported for reuse by the QTI import/export services.
exports.assertCourseScope = assertCourseScope;
exports.assertOwnsCourse = assertOwnsCourse;
exports.sanitizeRichText = sanitizeRichText;

async function loadQuizInCourse(courseId, quizId) {
  const quiz = await QuizModel.findById(quizId);
  if (!quiz || quiz.course_id !== courseId) throw ApiError.notFound('Quiz not found in this course.');
  return quiz;
}

/** Attach/detach the lessons.quiz_id <-> quizzes.lesson_id pair together (sync invariant). */
async function syncLessonQuizLink({ quizId, oldLessonId, newLessonId }) {
  if (oldLessonId && oldLessonId !== newLessonId) {
    await ModuleModel.updateLesson(oldLessonId, { quiz_id: null });
  }
  if (newLessonId) {
    await ModuleModel.updateLesson(newLessonId, { quiz_id: quizId });
  }
}

async function resolveLessonAttachment(courseId, lessonId, moduleId) {
  if (!lessonId) return { lessonId: null, moduleId: moduleId ?? null };

  const lesson = await ModuleModel.findLessonById(lessonId);
  if (!lesson || lesson.course_id !== courseId) {
    throw ApiError.badRequest('Lesson does not belong to this course.');
  }
  const existing = await QuizModel.findByLessonId(lessonId);
  if (existing) {
    throw ApiError.conflict('This lesson already has a quiz attached.');
  }
  return { lessonId, moduleId: lesson.module_id };
}

// ── Mappers ───────────────────────────────────────────────────────────────────

function mapQuiz(row) {
  if (!row) return null;
  return {
    id:                  row.id,
    institutionId:       row.institution_id,
    departmentId:        row.department_id       ?? null,
    courseId:            row.course_id,
    moduleId:            row.module_id           ?? null,
    lessonId:            row.lesson_id           ?? null,
    title:               row.title,
    description:         row.description         ?? null,
    instructions:        row.instructions         ?? null,
    qtiIdentifier:       row.qti_identifier       ?? null,
    qtiVersion:          row.qti_version          ?? null,
    pointsPossible:      Number(row.points_possible),
    passingScore:        row.passing_score        != null ? Number(row.passing_score)      : null,
    passingPercentage:   row.passing_percentage   != null ? Number(row.passing_percentage) : null,
    maxAttempts:         row.max_attempts,
    attemptScoringMode:  row.attempt_scoring_mode,
    timeLimitSeconds:    row.time_limit_seconds   ?? null,
    shuffleQuestions:    row.shuffle_questions,
    shuffleAnswers:      row.shuffle_answers,
    oneQuestionAtATime:  row.one_question_at_a_time,
    allowBackNavigation: row.allow_back_navigation,
    showScorePolicy:     row.show_score_policy,
    showAnswersPolicy:   row.show_answers_policy,
    gradeReleaseMode:    row.grade_release_mode,
    availableFrom:       row.available_from       ?? null,
    dueAt:               row.due_at               ?? null,
    availableUntil:      row.available_until      ?? null,
    status:              row.status,
    createdBy:           row.created_by,
    createdAt:           row.created_at,
    updatedAt:           row.updated_at           ?? null,
  };
}

function mapQuestion(row, options) {
  if (!row) return null;
  return {
    id:                  row.id,
    quizId:              row.quiz_id,
    qtiIdentifier:       row.qti_identifier      ?? null,
    questionType:        row.question_type,
    title:               row.title               ?? null,
    prompt:              row.prompt,
    responseIdentifier:  row.response_identifier ?? null,
    points:              Number(row.points),
    position:            row.position,
    required:            row.required,
    manualGrading:       row.manual_grading,
    shuffleOptions:      row.shuffle_options,
    difficultyLevel:     row.difficulty_level    ?? null,
    taxonomyLevel:       row.taxonomy_level      ?? null,
    questionData:        row.question_data       ?? {},
    responseDeclaration: row.response_declaration ?? {},
    scoringConfig:       row.scoring_config       ?? {},
    feedbackConfig:      row.feedback_config      ?? {},
    options: (options ?? []).map((o) => ({
      id:               o.id,
      optionIdentifier: o.option_identifier,
      content:          o.content,
      isCorrect:        o.is_correct,
      position:         o.position,
      feedback:         o.feedback ?? null,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
  };
}

// ── listQuizzes ───────────────────────────────────────────────────────────────

exports.listQuizzes = async (courseId, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  const rows = await QuizModel.listByCourse(courseId);
  return rows.map(mapQuiz);
};

// ── getQuiz ───────────────────────────────────────────────────────────────────

exports.getQuiz = async (courseId, quizId, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  const quiz = await loadQuizInCourse(courseId, quizId);
  return mapQuiz(quiz);
};

// ── createQuiz ────────────────────────────────────────────────────────────────

exports.createQuiz = async (courseId, body, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  assertOwnsCourse(course, actor);

  const { lessonId, moduleId } = await resolveLessonAttachment(courseId, body.lessonId ?? null, body.moduleId ?? null);

  const quiz = await QuizModel.create({
    institutionId:       course.institution_id,
    departmentId:        course.department_id ?? null,
    courseId,
    moduleId,
    lessonId,
    title:               body.title,
    description:         sanitizeRichText(body.description ?? null),
    instructions:        sanitizeRichText(body.instructions ?? null),
    qtiIdentifier:       body.qtiIdentifier       ?? null,
    qtiVersion:          body.qtiVersion          ?? null,
    pointsPossible:      body.pointsPossible      ?? 100,
    passingScore:        body.passingScore        ?? null,
    passingPercentage:   body.passingPercentage   ?? null,
    maxAttempts:         body.maxAttempts         ?? 1,
    attemptScoringMode:  body.attemptScoringMode  ?? 'latest',
    timeLimitSeconds:    body.timeLimitSeconds    ?? null,
    shuffleQuestions:    body.shuffleQuestions    ?? false,
    shuffleAnswers:      body.shuffleAnswers      ?? false,
    oneQuestionAtATime:  body.oneQuestionAtATime  ?? false,
    allowBackNavigation: body.allowBackNavigation ?? true,
    showScorePolicy:     body.showScorePolicy     ?? 'immediately',
    showAnswersPolicy:   body.showAnswersPolicy   ?? 'after_final_attempt',
    gradeReleaseMode:    body.gradeReleaseMode    ?? 'automatic',
    availableFrom:       body.availableFrom       ?? null,
    dueAt:               body.dueAt               ?? null,
    availableUntil:      body.availableUntil      ?? null,
    status:              'draft',
    createdBy:           actor.id,
  });

  if (lessonId) {
    await syncLessonQuizLink({ quizId: quiz.id, oldLessonId: null, newLessonId: lessonId });
  }

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'quiz.create', entityType: 'Quiz', entityId: quiz.id,
    delta: { after: { courseId, title: quiz.title, lessonId } },
  });

  return mapQuiz(quiz);
};

// ── updateQuiz ────────────────────────────────────────────────────────────────

exports.updateQuiz = async (courseId, quizId, body, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  assertOwnsCourse(course, actor);

  const quiz = await loadQuizInCourse(courseId, quizId);

  const fields = {};
  const simpleFields = [
    ['title', 'title'], ['maxAttempts', 'max_attempts'], ['attemptScoringMode', 'attempt_scoring_mode'],
    ['timeLimitSeconds', 'time_limit_seconds'], ['shuffleQuestions', 'shuffle_questions'],
    ['shuffleAnswers', 'shuffle_answers'], ['oneQuestionAtATime', 'one_question_at_a_time'],
    ['allowBackNavigation', 'allow_back_navigation'], ['showScorePolicy', 'show_score_policy'],
    ['showAnswersPolicy', 'show_answers_policy'], ['gradeReleaseMode', 'grade_release_mode'],
    ['availableFrom', 'available_from'], ['dueAt', 'due_at'], ['availableUntil', 'available_until'],
    ['pointsPossible', 'points_possible'], ['passingScore', 'passing_score'],
    ['passingPercentage', 'passing_percentage'], ['qtiIdentifier', 'qti_identifier'], ['qtiVersion', 'qti_version'],
  ];
  for (const [bodyKey, col] of simpleFields) {
    if (body[bodyKey] !== undefined) fields[col] = body[bodyKey];
  }
  if (body.description  !== undefined) fields.description  = sanitizeRichText(body.description);
  if (body.instructions !== undefined) fields.instructions = sanitizeRichText(body.instructions);

  let newLessonId = quiz.lesson_id;
  if (body.lessonId !== undefined) {
    const resolved = body.lessonId
      ? await resolveLessonAttachment(courseId, body.lessonId, undefined)
      : { lessonId: null, moduleId: quiz.module_id };
    fields.lesson_id = resolved.lessonId;
    fields.module_id = resolved.moduleId;
    newLessonId = resolved.lessonId;
  }

  const updated = await QuizModel.update(quizId, fields);

  if (body.lessonId !== undefined && newLessonId !== quiz.lesson_id) {
    await syncLessonQuizLink({ quizId, oldLessonId: quiz.lesson_id, newLessonId });
  }

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'quiz.update', entityType: 'Quiz', entityId: quizId,
    delta: { before: { title: quiz.title }, after: { title: updated?.title } },
  });

  return mapQuiz(updated);
};

// ── deleteQuiz (soft delete) ──────────────────────────────────────────────────

exports.deleteQuiz = async (courseId, quizId, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  assertOwnsCourse(course, actor);

  const quiz = await loadQuizInCourse(courseId, quizId);
  await QuizModel.softDelete(quizId);

  if (quiz.lesson_id) {
    await ModuleModel.updateLesson(quiz.lesson_id, { quiz_id: null });
  }

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'quiz.delete', entityType: 'Quiz', entityId: quizId,
    delta: { before: { title: quiz.title, courseId } },
  });
};

// ── publishQuiz ───────────────────────────────────────────────────────────────

exports.publishQuiz = async (courseId, quizId, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  assertOwnsCourse(course, actor);

  const quiz = await loadQuizInCourse(courseId, quizId);
  const questions = await QuizQuestionModel.listByQuiz(quizId);
  if (!questions.length) {
    throw ApiError.badRequest('Quiz must have at least one question before it can be published.');
  }

  const updated = await QuizModel.update(quizId, { status: 'published' });

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'quiz.publish', entityType: 'Quiz', entityId: quizId,
    delta: { before: { status: quiz.status }, after: { status: 'published' } },
  });

  recipientResolver.courseStudents(courseId).then((recipientIds) => eventDispatcher.emit('quiz.published', {
    recipientIds,
    senderId: actor.id,
    institutionId: course.institution_id,
    departmentId: course.department_id ?? null,
    courseId,
    data: { quizTitle: updated.title, courseTitle: course.title, courseId },
  })).catch(() => {});

  return mapQuiz(updated);
};

// ── Questions ─────────────────────────────────────────────────────────────────

exports.listQuestions = async (courseId, quizId, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  await loadQuizInCourse(courseId, quizId);

  const questions = await QuizQuestionModel.listByQuiz(quizId);
  const withOptions = await Promise.all(questions.map(async (q) => {
    const options = QuizQuestionModel.OPTION_BASED_TYPES.includes(q.question_type)
      ? await QuizQuestionModel.listOptions(q.id)
      : [];
    return mapQuestion(q, options);
  }));

  if (canSeeAnswers(course, actor)) return withOptions;
  return withOptions.map(sanitizeQuestionForStudent);
};

exports.createQuestion = async (courseId, quizId, body, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  assertOwnsCourse(course, actor);
  await loadQuizInCourse(courseId, quizId);

  const isOptionBased = QuizQuestionModel.OPTION_BASED_TYPES.includes(body.questionType);
  if (isOptionBased && (!Array.isArray(body.options) || !body.options.length)) {
    throw ApiError.badRequest(`questionType "${body.questionType}" requires at least one option.`);
  }

  const existing = await QuizQuestionModel.listByQuiz(quizId);
  const position = body.position ?? existing.length;

  const question = await QuizQuestionModel.create({
    quizId,
    qtiIdentifier:       body.qtiIdentifier ?? null,
    questionType:        body.questionType,
    title:               body.title  ?? null,
    prompt:              sanitizeRichText(body.prompt),
    responseIdentifier:  body.responseIdentifier ?? null,
    points:              body.points ?? 1,
    position,
    required:            body.required       ?? true,
    manualGrading:       body.manualGrading  ?? false,
    shuffleOptions:      body.shuffleOptions ?? false,
    difficultyLevel:     body.difficultyLevel ?? null,
    taxonomyLevel:       body.taxonomyLevel   ?? null,
    questionData:        isOptionBased ? {} : (body.questionData ?? {}),
    responseDeclaration: body.responseDeclaration ?? {},
    scoringConfig:       body.scoringConfig       ?? {},
    feedbackConfig:      body.feedbackConfig      ?? {},
  });

  let options = [];
  if (isOptionBased) {
    options = await QuizQuestionModel.replaceOptions(
      question.id,
      body.options.map((o) => ({ ...o, content: sanitizeRichText(o.content), feedback: sanitizeRichText(o.feedback ?? null) })),
    );
  }

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'quiz_question.create', entityType: 'QuizQuestion', entityId: question.id,
    delta: { after: { quizId, questionType: question.question_type, position } },
  });

  return mapQuestion(question, options);
};

exports.updateQuestion = async (courseId, quizId, questionId, body, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  assertOwnsCourse(course, actor);
  await loadQuizInCourse(courseId, quizId);

  const question = await QuizQuestionModel.findById(questionId);
  if (!question || question.quiz_id !== quizId) throw ApiError.notFound('Question not found in this quiz.');

  const fields = {};
  const simpleFields = [
    ['qtiIdentifier', 'qti_identifier'], ['title', 'title'], ['responseIdentifier', 'response_identifier'],
    ['points', 'points'], ['position', 'position'], ['required', 'required'],
    ['manualGrading', 'manual_grading'], ['shuffleOptions', 'shuffle_options'],
    ['difficultyLevel', 'difficulty_level'], ['taxonomyLevel', 'taxonomy_level'],
    ['responseDeclaration', 'response_declaration'], ['scoringConfig', 'scoring_config'],
    ['feedbackConfig', 'feedback_config'],
  ];
  for (const [bodyKey, col] of simpleFields) {
    if (body[bodyKey] !== undefined) fields[col] = body[bodyKey];
  }
  if (body.prompt !== undefined) fields.prompt = sanitizeRichText(body.prompt);

  const isOptionBased = QuizQuestionModel.OPTION_BASED_TYPES.includes(question.question_type);
  if (!isOptionBased && body.questionData !== undefined) fields.question_data = body.questionData;

  const updated = await QuizQuestionModel.update(questionId, fields);

  let options = isOptionBased ? await QuizQuestionModel.listOptions(questionId) : [];
  if (isOptionBased && Array.isArray(body.options)) {
    options = await QuizQuestionModel.replaceOptions(
      questionId,
      body.options.map((o) => ({ ...o, content: sanitizeRichText(o.content), feedback: sanitizeRichText(o.feedback ?? null) })),
    );
  }

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'quiz_question.update', entityType: 'QuizQuestion', entityId: questionId,
    delta: { after: { quizId } },
  });

  return mapQuestion(updated, options);
};

exports.deleteQuestion = async (courseId, quizId, questionId, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  assertOwnsCourse(course, actor);
  await loadQuizInCourse(courseId, quizId);

  const question = await QuizQuestionModel.findById(questionId);
  if (!question || question.quiz_id !== quizId) throw ApiError.notFound('Question not found in this quiz.');

  await QuizQuestionModel.softDelete(questionId);

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'quiz_question.delete', entityType: 'QuizQuestion', entityId: questionId,
    delta: { before: { quizId, questionType: question.question_type } },
  });
};

exports.reorderQuestions = async (courseId, quizId, order, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  assertOwnsCourse(course, actor);
  await loadQuizInCourse(courseId, quizId);

  if (!Array.isArray(order)) throw ApiError.badRequest('order must be an array of UUIDs.');

  const reordered = await QuizQuestionModel.reorder(quizId, order);
  return reordered.map((q) => mapQuestion(q));
};
