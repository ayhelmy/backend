'use strict';

const { body } = require('express-validator');

exports.createThread = [
  body('participantIds').isArray({ min: 1 }),
  body('participantIds.*').isUUID(),
  body('subject').optional().trim().notEmpty(),
];

exports.sendMessage = [
  body('body').trim().notEmpty(),
];
