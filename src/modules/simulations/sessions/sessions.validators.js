'use strict';

const { body } = require('express-validator');

exports.start = [
  body('simulationId').isUUID(),
  body('courseId').optional().isUUID(),
  body('lessonId').optional().isUUID(),
];

exports.update = [
  body('scormSuspendData').optional().isString(),
  body('scormLessonLocation').optional().isString(),
  body('score').optional().isFloat({ min: 0, max: 100 }),
  body('timeSpentSec').optional().isInt({ min: 0 }),
];
