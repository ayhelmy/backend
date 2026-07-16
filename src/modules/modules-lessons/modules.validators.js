'use strict';

const { body } = require('express-validator');

exports.createModule = [
  body('title').trim().notEmpty().withMessage('Module title is required.'),
  body('description').optional().isString(),
  body('position').optional().isInt({ min: 0 }),
  body('isPublished').optional().isBoolean(),
  body('unlockAt').optional({ nullable: true }).isISO8601(),
  body('prerequisiteModuleId').optional({ nullable: true }).isUUID(),
];

exports.updateModule = [
  body('title').optional().trim().notEmpty(),
  body('description').optional().isString(),
  body('isPublished').optional().isBoolean(),
  body('unlockAt').optional({ nullable: true }).isISO8601(),
  body('prerequisiteModuleId').optional({ nullable: true }).isUUID(),
];

exports.createLesson = [
  body('title').trim().notEmpty().withMessage('Lesson title is required.'),
  body('lessonMode')
    .isIn(['content', 'simulation', 'content_and_simulation'])
    .withMessage('lessonMode must be content, simulation, or content_and_simulation.'),
  body('contentType')
    .optional({ nullable: true })
    .isIn(['rich_text', 'video', 'file', 'url', 'scorm'])
    .withMessage('contentType must be rich_text, video, file, url, or scorm.'),
  body('simulationId').optional({ nullable: true }).isUUID(),
  body('catalogId').optional({ nullable: true }).isUUID(),
  body('content').optional().isObject(),
  body('position').optional().isInt({ min: 0 }),
  body('estimatedMinutes').optional({ nullable: true }).isInt({ min: 1 }),
  body('isRequired').optional().isBoolean(),
  body('isPublished').optional().isBoolean(),
];

exports.updateLesson = [
  body('title').optional().trim().notEmpty(),
  body('lessonMode')
    .optional()
    .isIn(['content', 'simulation', 'content_and_simulation']),
  body('contentType')
    .optional({ nullable: true })
    .isIn(['rich_text', 'video', 'file', 'url', 'scorm']),
  body('simulationId').optional({ nullable: true }).isUUID(),
  body('catalogId').optional({ nullable: true }).isUUID(),
  body('content').optional().isObject(),
  body('estimatedMinutes').optional({ nullable: true }).isInt({ min: 1 }),
  body('isRequired').optional().isBoolean(),
  body('isPublished').optional().isBoolean(),
];

exports.reorder = [
  body('order').isArray().withMessage('order must be an array of UUIDs.'),
  body('order.*').isUUID(),
];
