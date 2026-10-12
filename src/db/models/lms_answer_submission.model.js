'use strict';

const { pool } = require('../../config/database');

const SUBMISSION_COLS = `
  experiment_attempt_id, question_id, attempt, question_type, answer, result,
  answered_event_id, result_event_id, updated_at
`;

const LmsAnswerSubmissionModel = {
  async findByAttempt(experimentAttemptId) {
    const { rows } = await pool.query(
      `SELECT ${SUBMISSION_COLS} FROM lms_answer_submissions
        WHERE experiment_attempt_id = $1
        ORDER BY question_id, attempt`,
      [experimentAttemptId],
    );
    return rows;
  },

  async findOne(experimentAttemptId, questionId, attempt) {
    const { rows } = await pool.query(
      `SELECT ${SUBMISSION_COLS} FROM lms_answer_submissions
        WHERE experiment_attempt_id = $1 AND question_id = $2 AND attempt = $3`,
      [experimentAttemptId, questionId, attempt],
    );
    return rows[0] ?? null;
  },

  /**
   * QuestionAnswered — stores the chosen answer for this submission number.
   * Upsert rather than plain insert: if the paired result already arrived
   * first (out-of-order per guide §6 step 5), a placeholder row exists with
   * result set and answer NULL — this fills in the answer without touching
   * the already-recorded result.
   */
  async upsertAnswered(experimentAttemptId, questionId, attempt, { questionType, answer, eventId }, db = pool) {
    const { rows } = await db.query(
      `INSERT INTO lms_answer_submissions
         (experiment_attempt_id, question_id, attempt, question_type, answer, answered_event_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (experiment_attempt_id, question_id, attempt) DO UPDATE SET
         question_type     = EXCLUDED.question_type,
         answer             = EXCLUDED.answer,
         answered_event_id = EXCLUDED.answered_event_id,
         updated_at         = NOW()
       RETURNING ${SUBMISSION_COLS}`,
      [experimentAttemptId, questionId, attempt, questionType ?? null, answer ?? null, eventId],
    );
    return rows[0];
  },

  /**
   * QuestionCorrect/QuestionIncorrect — attaches the result to the matching
   * submission. Upsert for the same out-of-order reason as upsertAnswered:
   * if this arrives first, a placeholder row is created with answer NULL,
   * left for QuestionAnswered to fill in — never fabricated here.
   */
  async upsertResult(experimentAttemptId, questionId, attempt, { result, eventId }, db = pool) {
    const { rows } = await db.query(
      `INSERT INTO lms_answer_submissions
         (experiment_attempt_id, question_id, attempt, result, result_event_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (experiment_attempt_id, question_id, attempt) DO UPDATE SET
         result           = EXCLUDED.result,
         result_event_id = EXCLUDED.result_event_id,
         updated_at       = NOW()
       RETURNING ${SUBMISSION_COLS}`,
      [experimentAttemptId, questionId, attempt, result, eventId],
    );
    return rows[0];
  },

  /** Instructor dashboard: submissions for many attempts in one query, no per-attempt N+1. */
  async findByAttempts(attemptIds) {
    if (attemptIds.length === 0) return [];
    const { rows } = await pool.query(
      `SELECT ${SUBMISSION_COLS} FROM lms_answer_submissions
        WHERE experiment_attempt_id = ANY($1::uuid[])
        ORDER BY experiment_attempt_id, question_id, attempt`,
      [attemptIds],
    );
    return rows;
  },

  /**
   * Instructor dashboard KPI tile: correct/incorrect counts across every
   * submission for a page of students on one experiment. Counts raw rows
   * (one per answer/result event, per the guide's own event stream) rather
   * than a "final result per question" rollup, so a naming/pairing mismatch
   * can never hide a right/wrong tally the client actually reported.
   */
  async aggregateResultsForExperiment(projectId, experimentId, learnerIds) {
    if (learnerIds.length === 0) return { correct: 0, incorrect: 0 };
    const { rows: [row] } = await pool.query(
      `SELECT
          COUNT(*) FILTER (WHERE s.result = 'correct')   AS correct,
          COUNT(*) FILTER (WHERE s.result = 'incorrect') AS incorrect
         FROM lms_answer_submissions s
         JOIN lms_experiment_attempts a ON a.experiment_attempt_id = s.experiment_attempt_id
        WHERE a.project_id = $1 AND a.experiment_id = $2 AND a.learner_id = ANY($3::uuid[])`,
      [projectId, experimentId, learnerIds],
    );
    return { correct: Number(row.correct), incorrect: Number(row.incorrect) };
  },
};

module.exports = LmsAnswerSubmissionModel;
