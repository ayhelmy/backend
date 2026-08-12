'use strict';

/**
 * Jest manual mock for `archiver` — the real package ships an ESM entry
 * point that Jest's CommonJS transform can't parse, which breaks any test
 * that requires src/app.js (quizzes -> qti-export.service.js -> archiver),
 * unrelated to what those tests actually exercise. This stub is a plain
 * CJS module so `require('archiver')` succeeds under Jest; QTI export
 * itself is untested here and unaffected outside the test environment
 * (production still uses the real package).
 */

module.exports = function archiver() {
  throw new Error('archiver is mocked in the test environment');
};
