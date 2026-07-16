'use strict';

const { body, query, param } = require('express-validator');

const EXIT_REASONS = ['user_exit', 'navigation', 'browser_close', 'timeout', 'error'];
const VALID_STATUSES = ['active', 'ended', 'abandoned', 'expired'];

exports.start = [
  param('courseId').isUUID(),
  param('lessonId').isUUID(),
  body('simulation_id').optional({ nullable: true }).isUUID(),
];

exports.end = [
  param('sessionId').isUUID(),
  body('exit_reason').optional({ nullable: true }).isIn(EXIT_REASONS),
];

exports.recordClicks = [
  param('sessionId').isUUID(),
  body('clicks').isArray({ min: 1, max: 200 }),
  body('clicks.*.sequence_no').isInt({ min: 1 }),
  body('clicks.*.event_type').optional({ nullable: true }).isIn(['click', 'keydown']),
  body('clicks.*.x').optional({ nullable: true }).isFloat(),
  body('clicks.*.y').optional({ nullable: true }).isFloat(),
  body('clicks.*.norm_x').optional({ nullable: true }).isFloat({ min: 0, max: 1 }),
  body('clicks.*.norm_y').optional({ nullable: true }).isFloat({ min: 0, max: 1 }),
  body('clicks.*.key_name').optional({ nullable: true }).isString().isLength({ max: 100 }),
  body('clicks.*.clicked_at').isISO8601(),
];

exports.listActivity = [
  query('course_id').optional().isUUID(),
  query('lesson_id').optional().isUUID(),
  query('simulation_id').optional().isUUID(),
  query('student_id').optional().isUUID(),
  query('status').optional().isIn(VALID_STATUSES),
  query('date_from').optional().isISO8601(),
  query('date_to').optional().isISO8601(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];
