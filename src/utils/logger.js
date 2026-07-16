/**
 * Structured logger (Winston).
 * SRS refs: §5 NFR-13 — centralized structured logging.
 */
'use strict';

const { createLogger, format, transports } = require('winston');
const config = require('../config');

const logger = createLogger({
  level: config.env === 'production' ? 'info' : 'debug',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    config.env === 'production'
      ? format.json()
      : format.prettyPrint()
  ),
  transports: [new transports.Console()],
});

module.exports = logger;
