/**
 * Pagination helpers.
 * Used by list endpoints returning paginated results (e.g. GET /users, GET /courses).
 */
'use strict';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Extract and sanitise pagination params from request query.
 * @param {object} query  req.query
 * @returns {{ page, limit, offset }}
 */
function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || DEFAULT_PAGE);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/**
 * Build a meta object for paginated responses.
 * @param {number} total   Total item count from DB
 * @param {number} page
 * @param {number} limit
 */
function buildPaginationMeta(total, page, limit) {
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    hasNextPage: page * limit < total,
    hasPrevPage: page > 1,
  };
}

module.exports = { parsePagination, buildPaginationMeta };
