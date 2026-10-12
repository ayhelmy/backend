'use strict';

const { param, query } = require('express-validator');

exports.getDashboard = [
  param('courseId').isUUID(),
  param('simulationId').isUUID(),
  query('experimentId').optional().isString(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];
