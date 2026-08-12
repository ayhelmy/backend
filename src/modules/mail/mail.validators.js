'use strict';

const { body } = require('express-validator');

const MAX_BODY_LENGTH = 20000;

function recipientArrays() {
  return [
    body('to').optional().isArray(),
    body('to.*').optional().isUUID(),
    body('cc').optional().isArray(),
    body('cc.*').optional().isUUID(),
    body('bcc').optional().isArray(),
    body('bcc.*').optional().isUUID(),
  ];
}

exports.compose = [
  ...recipientArrays(),
  body('subject').optional().trim().isLength({ max: 255 }),
  body('body').trim().notEmpty().isLength({ max: MAX_BODY_LENGTH }),
  body('courseId').optional().isUUID(),
  body('attachments').optional().isArray(),
  body().custom((value) => {
    if (!(value.to?.length || value.cc?.length || value.bcc?.length)) {
      throw new Error('At least one recipient (to/cc/bcc) is required.');
    }
    return true;
  }),
];

exports.saveDraft = [
  ...recipientArrays(),
  body('subject').optional().trim().isLength({ max: 255 }),
  body('body').optional().isLength({ max: MAX_BODY_LENGTH }),
  body('courseId').optional().isUUID(),
  body('attachments').optional().isArray(),
];

exports.updateDraft = exports.saveDraft;

exports.reply = [
  body('body').trim().notEmpty().isLength({ max: MAX_BODY_LENGTH }),
  body('attachments').optional().isArray(),
];

exports.forward = [
  ...recipientArrays(),
  body('body').trim().notEmpty().isLength({ max: MAX_BODY_LENGTH }),
  body('courseId').optional().isUUID(),
  body('attachments').optional().isArray(),
  body().custom((value) => {
    if (!(value.to?.length || value.cc?.length || value.bcc?.length)) {
      throw new Error('At least one recipient (to/cc/bcc) is required.');
    }
    return true;
  }),
];
