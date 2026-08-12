/**
 * Quiz attempt model — quiz_attempts + quiz_responses.
 * Phase 1 built read scaffolding (list/get). The start/save/submit/autograde
 * lifecycle is added here. Migration 046.
 */
'use strict';

const { pool } = require('../../config/database');

const ATTEMPT_COLS = `
  id, quiz_id, user_id, institution_id, department_id, course_id, lesson_id,
  attempt_number, status, started_at, submitted_at, graded_at, time_spent_seconds,
  auto_score, manual_score, final_score, points_possible, percentage, passed,
  graded_by, created_at, updated_at
`;

const QuizAttemptModel = {
  async findById(id) {
    const { rows } = await pool.query(
      `SELECT ${ATTEMPT_COLS} FROM quiz_attempts WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async listByQuiz(quizId, { status } = {}) {
    const params = [quizId];
    let where = 'qa.quiz_id = $1';
    if (status) { params.push(status); where += ` AND qa.status = $${params.length}`; }
    const { rows } = await pool.query(
      `SELECT ${ATTEMPT_COLS.split(',').map((c) => `qa.${c.trim()}`).join(', ')},
              u.first_name AS student_first_name, u.last_name AS student_last_name, u.email AS student_email
         FROM quiz_attempts qa
         JOIN users u ON u.id = qa.user_id
        WHERE ${where}
        ORDER BY qa.created_at DESC`,
      params,
    );
    return rows;
  },

  /** Pending-manual-grading count, scoped by course/instructor/institution/department — dashboard KPI. */
  async countPendingManualGrading({ courseId, institutionId, departmentId, departmentIds, instructorId } = {}) {
    const params = [];
    const filters = [`qa.status = 'pending_manual_grading'`];
    const joins = [];
    if (courseId)      filters.push(`qa.course_id = $${params.push(courseId)}`);
    if (institutionId) filters.push(`qa.institution_id = $${params.push(institutionId)}`);
    if (departmentId)  filters.push(`qa.department_id = $${params.push(departmentId)}`);
    if (departmentIds?.length) filters.push(`qa.department_id = ANY($${params.push(departmentIds)})`);
    if (instructorId) {
      joins.push('JOIN courses c ON c.id = qa.course_id');
      filters.push(`c.instructor_id = $${params.push(instructorId)}`);
    }
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM quiz_attempts qa ${joins.join(' ')} WHERE ${filters.join(' AND ')}`,
      params,
    );
    return parseInt(rows[0].total, 10);
  },

  /** Active students in a course with zero quiz_attempts rows — instructor follow-up. */
  async countStudentsWithoutAttempts(courseId) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM enrollments e
        WHERE e.course_id = $1 AND e.role = 'student' AND e.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM quiz_attempts qa WHERE qa.course_id = $1 AND qa.user_id = e.user_id)`,
      [courseId],
    );
    return parseInt(rows[0].total, 10);
  },

  /** Most recent submissions, scoped — feeds the recent-activity merge. */
  async listRecentSubmissions({ courseId, instructorId, institutionId, departmentId, studentId, limit = 10 } = {}) {
    const params = [];
    const filters = [`qa.status IN ('graded', 'pending_manual_grading')`];
    if (courseId)      filters.push(`qa.course_id = $${params.push(courseId)}`);
    if (institutionId) filters.push(`qa.institution_id = $${params.push(institutionId)}`);
    if (departmentId)  filters.push(`qa.department_id = $${params.push(departmentId)}`);
    if (studentId)      filters.push(`qa.user_id = $${params.push(studentId)}`);
    if (instructorId)  filters.push(`c.instructor_id = $${params.push(instructorId)}`);
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT qa.id, qa.quiz_id, qa.course_id, qa.user_id, qa.status, qa.percentage,
              qa.submitted_at, u.first_name AS student_first_name, u.last_name AS student_last_name,
              q.title AS quiz_title
         FROM quiz_attempts qa
         JOIN users u ON u.id = qa.user_id
         JOIN quizzes q ON q.id = qa.quiz_id
         JOIN courses c ON c.id = qa.course_id
        WHERE ${filters.join(' AND ')}
        ORDER BY qa.submitted_at DESC LIMIT $${params.length}`,
      params,
    );
    return rows;
  },

  /** Total attempts a student has made across all quizzes — student dashboard KPI. */
  async countByUser(userId) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM quiz_attempts WHERE user_id = $1`,
      [userId],
    );
    return parseInt(rows[0].total, 10);
  },

  async listByQuizAndUser(quizId, userId) {
    const { rows } = await pool.query(
      `SELECT ${ATTEMPT_COLS} FROM quiz_attempts WHERE quiz_id = $1 AND user_id = $2 ORDER BY attempt_number`,
      [quizId, userId],
    );
    return rows;
  },

  /** In-progress attempt for this quiz+user, if any (resume target). Uses idx_quiz_attempts_in_progress. */
  async findInProgress(quizId, userId) {
    const { rows } = await pool.query(
      `SELECT ${ATTEMPT_COLS} FROM quiz_attempts
        WHERE quiz_id = $1 AND user_id = $2 AND status = 'in_progress' LIMIT 1`,
      [quizId, userId],
    );
    return rows[0] ?? null;
  },

  async countByQuizAndUser(quizId, userId) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) FROM quiz_attempts WHERE quiz_id = $1 AND user_id = $2`,
      [quizId, userId],
    );
    return Number(rows[0].count);
  },

  /** Graded (or pending-manual) attempts for this quiz+user, in attempt order — used for attempt_scoring_mode aggregation. */
  async listGradedByQuizAndUser(quizId, userId) {
    const { rows } = await pool.query(
      `SELECT ${ATTEMPT_COLS} FROM quiz_attempts
        WHERE quiz_id = $1 AND user_id = $2 AND status IN ('graded', 'pending_manual_grading')
        ORDER BY attempt_number`,
      [quizId, userId],
    );
    return rows;
  },

  async create({ quizId, userId, institutionId, departmentId, courseId, lessonId, attemptNumber, pointsPossible }) {
    const { rows } = await pool.query(
      `INSERT INTO quiz_attempts
         (quiz_id, user_id, institution_id, department_id, course_id, lesson_id,
          attempt_number, points_possible)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING ${ATTEMPT_COLS}`,
      [
        quizId, userId, institutionId, departmentId ?? null, courseId, lessonId ?? null,
        attemptNumber ?? 1, pointsPossible ?? null,
      ],
    );
    return rows[0];
  },

  /**
   * Finalizes an in_progress attempt. Guarded by WHERE status='in_progress' so a
   * concurrent double-submit only lets one caller through (the other gets no row back).
   */
  async submit(attemptId, {
    status, submittedAt, gradedAt, autoScore, manualScore, finalScore,
    pointsPossible, percentage, passed, timeSpentSeconds,
  }) {
    const { rows } = await pool.query(
      `UPDATE quiz_attempts SET
         status = $1, submitted_at = $2, graded_at = $3,
         auto_score = $4, manual_score = $5, final_score = $6,
         points_possible = $7, percentage = $8, passed = $9,
         time_spent_seconds = $10, updated_at = NOW()
       WHERE id = $11 AND status = 'in_progress'
       RETURNING ${ATTEMPT_COLS}`,
      [
        status, submittedAt, gradedAt ?? null, autoScore ?? null, manualScore ?? null, finalScore ?? null,
        pointsPossible ?? null, percentage ?? null, passed ?? null, timeSpentSeconds ?? 0, attemptId,
      ],
    );
    return rows[0] ?? null;
  },

  /**
   * Finalizes manual grading for an attempt already in 'pending_manual_grading' (or
   * re-grades a 'graded' one for corrections) — unlike submit(), does not require
   * status='in_progress'.
   */
  async grade(attemptId, { gradedAt, gradedBy, manualScore, finalScore, percentage, passed }) {
    const { rows } = await pool.query(
      `UPDATE quiz_attempts SET
         status = 'graded', graded_at = $1, graded_by = $2,
         manual_score = $3, final_score = $4, percentage = $5, passed = $6,
         updated_at = NOW()
       WHERE id = $7 AND status IN ('pending_manual_grading', 'graded')
       RETURNING ${ATTEMPT_COLS}`,
      [gradedAt, gradedBy, manualScore ?? null, finalScore, percentage ?? null, passed ?? null, attemptId],
    );
    return rows[0] ?? null;
  },

  // ── Responses ───────────────────────────────────────────────────────────────

  async listResponses(attemptId) {
    const { rows } = await pool.query(
      `SELECT id, attempt_id, question_id, response_payload, is_correct,
              auto_score, manual_score, final_score, feedback,
              answered_at, graded_by, graded_at, created_at, updated_at
         FROM quiz_responses WHERE attempt_id = $1`,
      [attemptId],
    );
    return rows;
  },

  async upsertResponse({ attemptId, questionId, responsePayload }) {
    const { rows } = await pool.query(
      `INSERT INTO quiz_responses (attempt_id, question_id, response_payload, answered_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (attempt_id, question_id) DO UPDATE
         SET response_payload = EXCLUDED.response_payload,
             answered_at      = NOW(),
             updated_at       = NOW()
       RETURNING *`,
      [attemptId, questionId, JSON.stringify(responsePayload ?? {})],
    );
    return rows[0];
  },

  async updateResponseScore(responseId, { isCorrect, autoScore, finalScore }) {
    const { rows } = await pool.query(
      `UPDATE quiz_responses SET
         is_correct = $1, auto_score = $2, final_score = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [isCorrect ?? null, autoScore ?? null, finalScore ?? null, responseId],
    );
    return rows[0] ?? null;
  },

  /** Manual-grading pass for one response — sets feedback + grader identity, unlike updateResponseScore. */
  async gradeResponse(responseId, { isCorrect, finalScore, feedback, gradedBy }) {
    const { rows } = await pool.query(
      `UPDATE quiz_responses SET
         is_correct = $1, final_score = $2, manual_score = $2, feedback = $3,
         graded_by = $4, graded_at = NOW(), updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [isCorrect ?? null, finalScore, feedback ?? null, gradedBy, responseId],
    );
    return rows[0] ?? null;
  },
};

module.exports = QuizAttemptModel;
