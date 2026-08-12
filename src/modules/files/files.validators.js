'use strict';

const { body } = require('express-validator');

exports.requestUpload = [
  body('fileName').trim().notEmpty(),
  body('contentType').trim().notEmpty(),
  body('folder').optional().isIn(['avatars','course-covers','lesson-content','simulation-packages']),
];
