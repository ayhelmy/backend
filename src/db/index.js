/**
 * Re-exports the database query helpers for use across all modules.
 * SRS refs: §9 Database Design — PostgreSQL 15, UUID PKs, soft-delete.
 */
'use strict';

module.exports = require('../config/database');
