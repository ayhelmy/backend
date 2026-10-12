'use strict';

const { body, query } = require('express-validator');

exports.postEvents = [
  body().custom((value) => {
    if (value && Array.isArray(value.events)) {
      return value.events.length > 0 && value.events.length <= 200;
    }
    return typeof value === 'object' && value !== null && typeof value.eventType === 'string';
  }).withMessage('Body must be a single event payload or { events: [...] } (1-200 items).'),
];

exports.getProgress = [
  query('projectId').notEmpty().isString(),
  query('assessmentVersion').notEmpty().isString(),
  query('experimentId').notEmpty().isString(),
  query('experimentAttemptId').optional().isUUID(),
];

exports.getCompletion = [
  query('projectId').notEmpty().isString(),
  query('assessmentVersion').notEmpty().isString(),
  query('experimentId').notEmpty().isString(),
];

exports.getHistory = [
  query('projectId').notEmpty().isString(),
];
