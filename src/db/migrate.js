/**
 * Simple sequential migration runner.
 * Run with: npm run migrate
 * SRS refs: §9 Database Design — all tables.
 *
 * Reads numbered SQL files from ./migrations/ in order and tracks
 * which have already been applied in a schema_migrations table.
 */
'use strict';

require('../config'); // Load env vars
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Two lines of development numbered the same migrations differently: the
// deployed branch inserted 044/045, shifting everything after it by two,
// and four local-only migrations were renumbered to 068–071 when merged.
// A database that applied a migration under its OLD filename must not run
// it again under the new one — so the old name counts as applied.
const RENAMED_FROM = {
  '046_quizzes.sql':                         '044_quizzes.sql',
  '047_quiz_questions.sql':                  '045_quiz_questions.sql',
  '048_quiz_attempts.sql':                   '046_quiz_attempts.sql',
  '049_simulation_scores.sql':               '047_simulation_scores.sql',
  '050_grade_categories.sql':                '048_grade_categories.sql',
  '051_grades_source_tracing.sql':           '049_grades_source_tracing.sql',
  '052_lesson_quiz_mode.sql':                '050_lesson_quiz_mode.sql',
  '053_quiz_permissions.sql':                '051_quiz_permissions.sql',
  '054_quiz_question_metadata.sql':          '052_quiz_question_metadata.sql',
  '055_messaging_notifications_v2.sql':      '053_messaging_notifications_v2.sql',
  '056_mail_mailbox_refactor.sql':           '054_mail_mailbox_refactor.sql',
  '057_lti_platforms.sql':                   '055_lti_platforms.sql',
  '058_lti_tool_keys.sql':                   '056_lti_tool_keys.sql',
  '059_lti_identity_stubs.sql':              '057_lti_identity_stubs.sql',
  '060_lti_permissions.sql':                 '058_lti_permissions.sql',
  '061_lti_resource_link_grading.sql':       '059_lti_resource_link_grading.sql',
  '062_lti_nrps.sql':                        '060_lti_nrps.sql',
  '063_home_page_featured_simulations.sql':  '061_home_page_featured_simulations.sql',
  '064_seed_home_page_content.sql':          '062_seed_home_page_content.sql',
  '065_relative_media_paths.sql':            '063_relative_media_paths.sql',
  '068_experiments_lms_tracking.sql':        '064_experiments_lms_tracking.sql',
  '069_experiments_seed_fm103.sql':          '065_experiments_seed_fm103.sql',
  '070_experiments_auto_registration.sql':   '066_experiments_auto_registration.sql',
  '071_academic_permissions_super_admin_fix.sql': '067_academic_permissions_super_admin_fix.sql',
};

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(client) {
  const { rows } = await client.query('SELECT version FROM schema_migrations ORDER BY version');
  return new Set(rows.map((r) => r.version));
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureMigrationsTable(client);

    const applied = await getAppliedMigrations(client);
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip  ${file}`);
        continue;
      }
      if (applied.has(RENAMED_FROM[file])) {
        console.log(`  skip  ${file} (applied as ${RENAMED_FROM[file]})`);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`  run   ${file}`);
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
    }

    await client.query('COMMIT');
    console.log('Migrations complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
