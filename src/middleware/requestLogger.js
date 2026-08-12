/**
 * HTTP request logger using morgan + winston.
 * SRS refs: §5 NFR-13 — centralized structured logging.
 */
'use strict';

const morgan = require('morgan');
const logger = require('../utils/logger');

const stream = {
  write: (message) => logger.http(message.trim()),
};

const skip = () => process.env.NODE_ENV === 'test';

const requestLogger = morgan(
  ':method :url :status :res[content-length] - :response-time ms',
  { stream, skip }
);

module.exports = requestLogger;
