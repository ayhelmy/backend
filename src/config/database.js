/**
 * PostgreSQL connection pool.
 * SRS refs: §2.3 (Database: PostgreSQL 15), §9 Database Design
 * NFR-10: DB replication with automatic failover < 30 seconds.
 */
'use strict';

const { Pool } = require('pg');
const config = require('./index');
const logger = require('../utils/logger');

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.name,
  user: config.db.user,
  password: config.db.password,
  min: config.db.pool.min,
  max: config.db.pool.max,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
  logger.debug('PostgreSQL client connected');
});

pool.on('error', (err) => {
  logger.error('PostgreSQL pool error', { error: err.message });
});

/**
 * Execute a parameterised query.
 * @param {string} text  SQL statement with $1, $2… placeholders
 * @param {Array}  params  Bound values
 */
const query = (text, params) => pool.query(text, params);

/**
 * Grab a dedicated client for transactions.
 * Always call client.release() in a finally block.
 */
const getClient = () => pool.connect();

module.exports = { pool, query, getClient };
