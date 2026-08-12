'use strict';

const { body } = require('express-validator');
const { QuizQuestionModel } = require('../../db/models');

const QUESTION_TYPES = [
  'single_choice', 'multiple_choice', 'true_false',
  'short_text', 'long_text',
  'numeric', 'numeric_tolerance',
  'matching', 'ordering',
  'fill_in_blank', 'multiple_fill_in_blank',
  'hotspot', 'file_upload', 'formula',
];

const DIFFICULTY_LEVELS = ['easy', 'medium', 'hard'];
const TAXONOMY_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

const quizFields = (optional) => {
  const opt = (chain) => (optional ? chain.optional() : chain);
  return [
    opt(body('title').trim().notEmpty()).withMessage('Quiz title is required.'),
    body('description').optional({ nullable: true }).isString(),
    body('instructions').optional({ nullable: true }).isString(),
    body('lessonId').optional({ nullable: true }).isUUID(),
    body('moduleId').optional({ nullable: true }).isUUID(),
    body('pointsPossible').optional().isFloat({ min: 0 }),
    body('passingScore').optional({ nullable: true }).isFloat({ min: 0 }),
    body('passingPercentage').optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
    body('maxAttempts').optional().isInt({ min: 1 }),
    body('attemptScoringMode').optional().isIn(['latest', 'highest', 'first', 'average']),
    body('timeLimitSeconds').optional({ nullable: true }).isInt({ min: 1 }),
    body('shuffleQuestions').optional().isBoolean(),
    body('shuffleAnswers').optional().isBoolean(),
    body('oneQuestionAtATime').optional().isBoolean(),
    body('allowBackNavigation').optional().isBoolean(),
    body('showScorePolicy').optional().isIn(['immediately', 'after_due_date', 'after_final_attempt', 'never']),
    body('showAnswersPolicy').optional().isIn(['immediately', 'after_due_date', 'after_final_attempt', 'never']),
    body('gradeReleaseMode').optional().isIn(['automatic', 'instructor_approval']),
    body('availableFrom').optional({ nullable: true }).isISO8601(),
    body('dueAt').optional({ nullable: true }).isISO8601(),
    body('availableUntil').optional({ nullable: true }).isISO8601(),
    body('qtiIdentifier').optional({ nullable: true }).isString(),
    body('qtiVersion').optional({ nullable: true }).isString(),
  ];
};

exports.createQuiz = quizFields(false);
exports.updateQuiz = quizFields(true);

exports.createQuestion = [
  body('questionType').isIn(QUESTION_TYPES).withMessage(`questionType must be one of: ${QUESTION_TYPES.join(', ')}.`),
  body('prompt').trim().notEmpty().withMessage('Question prompt is required.'),
  body('title').optional({ nullable: true }).isString(),
  body('qtiIdentifier').optional({ nullable: true }).isString(),
  body('responseIdentifier').optional({ nullable: true }).isString(),
  body('points').optional().isFloat({ min: 0 }),
  body('position').optional().isInt({ min: 0 }),
  body('required').optional().isBoolean(),
  body('manualGrading').optional().isBoolean(),
  body('shuffleOptions').optional().isBoolean(),
  body('difficultyLevel').optional({ nullable: true }).isIn(DIFFICULTY_LEVELS),
  body('taxonomyLevel').optional({ nullable: true }).isIn(TAXONOMY_LEVELS),
  body('options').optional().isArray(),
  body('options.*.optionIdentifier').optional().isString().notEmpty(),
  body('options.*.content').optional().isString().notEmpty(),
  body('options.*.isCorrect').optional().isBoolean(),
  body('questionData').optional().isObject(),
  body('responseDeclaration').optional().isObject(),
  body('scoringConfig').optional().isObject(),
  body('feedbackConfig').optional().isObject(),
  body().custom((value) => {
    if (QuizQuestionModel.OPTION_BASED_TYPES.includes(value.questionType)) {
      if (!Array.isArray(value.options) || !value.options.length) {
        throw new Error(`questionType "${value.questionType}" requires at least one option.`);
      }
    }
    return true;
  }),
];

exports.updateQuestion = [
  body('prompt').optional().trim().notEmpty(),
  body('title').optional({ nullable: true }).isString(),
  body('qtiIdentifier').optional({ nullable: true }).isString(),
  body('responseIdentifier').optional({ nullable: true }).isString(),
  body('points').optional().isFloat({ min: 0 }),
  body('position').optional().isInt({ min: 0 }),
  body('required').optional().isBoolean(),
  body('manualGrading').optional().isBoolean(),
  body('shuffleOptions').optional().isBoolean(),
  body('difficultyLevel').optional({ nullable: true }).isIn(DIFFICULTY_LEVELS),
  body('taxonomyLevel').optional({ nullable: true }).isIn(TAXONOMY_LEVELS),
  body('options').optional().isArray(),
  body('questionData').optional().isObject(),
  body('responseDeclaration').optional().isObject(),
  body('scoringConfig').optional().isObject(),
  body('feedbackConfig').optional().isObject(),
];

exports.reorderQuestions = [
  body('order').isArray().withMessage('order must be an array of UUIDs.'),
  body('order.*').isUUID(),
];

exports.importQti = [
  body('title').optional({ nullable: true }).isString(),
  body('lessonId').optional({ nullable: true }).isUUID(),
  body('moduleId').optional({ nullable: true }).isUUID(),
  body().custom((_value, { req }) => {
    if (!req.file) throw new Error('A qti_package file is required.');
    return true;
  }),
];
