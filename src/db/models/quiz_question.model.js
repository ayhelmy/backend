/**
 * Quiz question model — quiz_questions + quiz_question_options.
 * Migration 045. Question-type split: normalized options table for
 * single_choice/multiple_choice/true_false; question_data JSONB for the rest.
 */
'use strict';

const { pool } = require('../../config/database');

const QUESTION_COLS = `
  id, quiz_id, qti_identifier, question_type, title, prompt, response_identifier,
  points, position, required, manual_grading, shuffle_options,
  difficulty_level, taxonomy_level,
  question_data, response_declaration, scoring_config, feedback_config,
  created_at, updated_at, deleted_at
`;

// Question types that use the normalized quiz_question_options table.
const OPTION_BASED_TYPES = ['single_choice', 'multiple_choice', 'true_false'];

const QuizQuestionModel = {
  OPTION_BASED_TYPES,

  async findById(id) {
    const { rows } = await pool.query(
      `SELECT ${QUESTION_COLS} FROM quiz_questions WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  },

  async listByQuiz(quizId) {
    const { rows } = await pool.query(
      `SELECT ${QUESTION_COLS} FROM quiz_questions WHERE quiz_id = $1 AND deleted_at IS NULL ORDER BY position`,
      [quizId],
    );
    return rows;
  },

  async create({
    quizId, qtiIdentifier, questionType, title, prompt, responseIdentifier,
    points, position, required, manualGrading, shuffleOptions,
    difficultyLevel, taxonomyLevel,
    questionData, responseDeclaration, scoringConfig, feedbackConfig,
  }) {
    const { rows } = await pool.query(
      `INSERT INTO quiz_questions
         (quiz_id, qti_identifier, question_type, title, prompt, response_identifier,
          points, position, required, manual_grading, shuffle_options,
          difficulty_level, taxonomy_level,
          question_data, response_declaration, scoring_config, feedback_config)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING ${QUESTION_COLS}`,
      [
        quizId, qtiIdentifier ?? null, questionType, title ?? null, prompt, responseIdentifier ?? null,
        points ?? 1, position ?? 0, required ?? true, manualGrading ?? false, shuffleOptions ?? false,
        difficultyLevel ?? null, taxonomyLevel ?? null,
        JSON.stringify(questionData ?? {}), JSON.stringify(responseDeclaration ?? {}),
        JSON.stringify(scoringConfig ?? {}), JSON.stringify(feedbackConfig ?? {}),
      ],
    );
    return rows[0];
  },

  async update(id, fields) {
    const allowed = [
      'qti_identifier', 'question_type', 'title', 'prompt', 'response_identifier',
      'points', 'position', 'required', 'manual_grading', 'shuffle_options',
      'difficulty_level', 'taxonomy_level',
      'question_data', 'response_declaration', 'scoring_config', 'feedback_config',
    ];
    const jsonFields = new Set(['question_data', 'response_declaration', 'scoring_config', 'feedback_config']);
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        const val = jsonFields.has(key) ? JSON.stringify(fields[key]) : fields[key];
        params.push(val);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (sets.length === 0) return this.findById(id);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE quiz_questions SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} AND deleted_at IS NULL RETURNING ${QUESTION_COLS}`,
      params,
    );
    return rows[0] ?? null;
  },

  async softDelete(id) {
    const { rows } = await pool.query(
      `UPDATE quiz_questions SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [id],
    );
    return rows[0] ?? null;
  },

  async reorder(quizId, order) {
    await Promise.all(order.map((id, idx) => pool.query(
      `UPDATE quiz_questions SET position = $1, updated_at = NOW() WHERE id = $2 AND quiz_id = $3`,
      [idx, id, quizId],
    )));
    return this.listByQuiz(quizId);
  },

  // ── Options (single_choice / multiple_choice / true_false only) ────────────

  async listOptions(questionId) {
    const { rows } = await pool.query(
      `SELECT id, question_id, option_identifier, content, is_correct, position, feedback,
              created_at, updated_at
         FROM quiz_question_options WHERE question_id = $1 ORDER BY position`,
      [questionId],
    );
    return rows;
  },

  /**
   * Options are fully replaced on each question write (an authoring-time
   * operation, not a high-frequency path) -- simpler and safer than diffing.
   */
  async replaceOptions(questionId, options) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM quiz_question_options WHERE question_id = $1`, [questionId]);
      for (const [idx, opt] of options.entries()) {
        await client.query(
          `INSERT INTO quiz_question_options
             (question_id, option_identifier, content, is_correct, position, feedback)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            questionId, opt.optionIdentifier, opt.content, opt.isCorrect ?? false,
            opt.position ?? idx, opt.feedback ?? null,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.listOptions(questionId);
  },
};

module.exports = QuizQuestionModel;
