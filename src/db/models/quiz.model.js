/**
 * Quiz model — query helpers.
 * Phase 1: schema CRUD only. QTI import/export is Phase 2; attempt lifecycle
 * is Phase 3. Migration 044 (quizzes), 050 (lessons.quiz_id).
 */
'use strict';

const { pool } = require('../../config/database');

const QUIZ_COLS = `
  id, institution_id, department_id, course_id, module_id, lesson_id,
  title, description, instructions,
  qti_identifier, qti_version,
  points_possible, passing_score, passing_percentage,
  max_attempts, attempt_scoring_mode, time_limit_seconds,
  shuffle_questions, shuffle_answers, one_question_at_a_time, allow_back_navigation,
  show_score_policy, show_answers_policy, grade_release_mode,
  available_from, due_at, available_until,
  status, created_by, created_at, updated_at, deleted_at
`;

const QuizModel = {
  async findById(id) {
    const { rows } = await pool.query(
      `SELECT ${QUIZ_COLS} FROM quizzes WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  },

  async findByLessonId(lessonId) {
    const { rows } = await pool.query(
      `SELECT ${QUIZ_COLS} FROM quizzes WHERE lesson_id = $1 AND deleted_at IS NULL`,
      [lessonId],
    );
    return rows[0] ?? null;
  },

  /** Total quizzes across a department's courses — department dashboard KPI. */
  async countByDepartments(departmentIds) {
    if (!departmentIds?.length) return 0;
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM quizzes WHERE department_id = ANY($1) AND deleted_at IS NULL`,
      [departmentIds],
    );
    return parseInt(rows[0].total, 10);
  },

  /**
   * Published quizzes due soon (or overdue) in the given courses that this
   * student hasn't attempted yet — student dashboard "quizzes due" follow-up.
   */
  async listDueForStudent(userId, courseIds, { limit = 10 } = {}) {
    if (!courseIds?.length) return [];
    const { rows } = await pool.query(
      `SELECT q.id, q.course_id, q.title, q.due_at
         FROM quizzes q
        WHERE q.course_id = ANY($1) AND q.status = 'published' AND q.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM quiz_attempts qa
             WHERE qa.quiz_id = q.id AND qa.user_id = $2
               AND qa.status IN ('graded', 'pending_manual_grading', 'in_progress', 'submitted')
          )
        ORDER BY q.due_at ASC NULLS LAST
        LIMIT $3`,
      [courseIds, userId, limit],
    );
    return rows;
  },

  /** Total quizzes for a single course — instructor dashboard KPI. */
  async countByCourse(courseId) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM quizzes WHERE course_id = $1 AND deleted_at IS NULL`,
      [courseId],
    );
    return parseInt(rows[0].total, 10);
  },

  async listByCourse(courseId) {
    const { rows } = await pool.query(
      `SELECT ${QUIZ_COLS} FROM quizzes WHERE course_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
      [courseId],
    );
    return rows;
  },

  async create({
    institutionId, departmentId, courseId, moduleId, lessonId,
    title, description, instructions,
    qtiIdentifier, qtiVersion,
    pointsPossible, passingScore, passingPercentage,
    maxAttempts, attemptScoringMode, timeLimitSeconds,
    shuffleQuestions, shuffleAnswers, oneQuestionAtATime, allowBackNavigation,
    showScorePolicy, showAnswersPolicy, gradeReleaseMode,
    availableFrom, dueAt, availableUntil,
    status, createdBy,
  }) {
    const { rows } = await pool.query(
      `INSERT INTO quizzes
         (institution_id, department_id, course_id, module_id, lesson_id,
          title, description, instructions,
          qti_identifier, qti_version,
          points_possible, passing_score, passing_percentage,
          max_attempts, attempt_scoring_mode, time_limit_seconds,
          shuffle_questions, shuffle_answers, one_question_at_a_time, allow_back_navigation,
          show_score_policy, show_answers_policy, grade_release_mode,
          available_from, due_at, available_until,
          status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
               $20,$21,$22,$23,$24,$25,$26,$27,$28)
       RETURNING ${QUIZ_COLS}`,
      [
        institutionId, departmentId ?? null, courseId, moduleId ?? null, lessonId ?? null,
        title, description ?? null, instructions ?? null,
        qtiIdentifier ?? null, qtiVersion ?? null,
        pointsPossible ?? 100, passingScore ?? null, passingPercentage ?? null,
        maxAttempts ?? 1, attemptScoringMode ?? 'latest', timeLimitSeconds ?? null,
        shuffleQuestions ?? false, shuffleAnswers ?? false, oneQuestionAtATime ?? false,
        allowBackNavigation ?? true,
        showScorePolicy ?? 'immediately', showAnswersPolicy ?? 'after_final_attempt',
        gradeReleaseMode ?? 'automatic',
        availableFrom ?? null, dueAt ?? null, availableUntil ?? null,
        status ?? 'draft', createdBy,
      ],
    );
    return rows[0];
  },

  async update(id, fields) {
    const allowed = [
      'title', 'description', 'instructions',
      'qti_identifier', 'qti_version',
      'points_possible', 'passing_score', 'passing_percentage',
      'max_attempts', 'attempt_scoring_mode', 'time_limit_seconds',
      'shuffle_questions', 'shuffle_answers', 'one_question_at_a_time', 'allow_back_navigation',
      'show_score_policy', 'show_answers_policy', 'grade_release_mode',
      'available_from', 'due_at', 'available_until',
      'status', 'module_id', 'lesson_id',
    ];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        params.push(fields[key]);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (sets.length === 0) return this.findById(id);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE quizzes SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} AND deleted_at IS NULL RETURNING ${QUIZ_COLS}`,
      params,
    );
    return rows[0] ?? null;
  },

  async softDelete(id) {
    const { rows } = await pool.query(
      `UPDATE quizzes SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [id],
    );
    return rows[0] ?? null;
  },
};

module.exports = QuizModel;
