'use strict';

/**
 * Seeds "Bedo University" as a standalone institution:
 *   - 1 'institution_admin' account
 *   - 5 people, each with TWO SEPARATE login accounts — one 'student'
 *     account and one 'instructor' account (10 users total)
 *   - one "Engineering" department (required before an academic year can
 *     be created — academic years hang off /departments/:id/academic-years)
 *   - simulation catalog access limited to the existing "Fluid Mechanics"
 *     and "Renewable Energy Laboratory" catalog nodes only
 *
 * Does NOT touch existing institutions, users, simulations, or catalogs —
 * unlike src/db/seed.js, this script never wipes simulation/catalog data.
 * It looks up the two catalog nodes by name, so `npm run seed` (or an
 * equivalent) must have already created them.
 *
 * Idempotent: safe to re-run.
 * Run with: node scripts/seed-bedo-university.js
 */

require('../src/config');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/database');

const SALT_ROUNDS = 12;

const INSTITUTION_DOMAIN = 'bedo-university.edu';

const people = [
  { firstName: 'Shipil', lastName: 'Export' },
  { firstName: 'Hosny', lastName: 'Export' },
  { firstName: 'Said', lastName: 'Export' },
  { firstName: 'Rahem', lastName: 'Export' },
  { firstName: 'Kilany', lastName: 'Export' },
];

// Two accounts per person — one per role — each with its own login.
const usersSpec = [
  {
    firstName: 'Bedo',
    lastName: 'Admin',
    role: 'institution_admin',
    email: `admin@${INSTITUTION_DOMAIN}`,
    password: 'BedoAdmin123!',
  },
  ...people.flatMap((p) => ['student', 'instructor'].map((role) => ({
    firstName: p.firstName,
    lastName: p.lastName,
    role,
    email: `${p.firstName.toLowerCase()}.${role}@${INSTITUTION_DOMAIN}`,
    password: `${p.firstName}${role === 'student' ? 'Student' : 'Instructor'}123!`,
  }))),
];

async function seedBedoUniversity() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── 1. Institution ────────────────────────────────────────────────────
    const { rows: [inst] } = await client.query(`
      INSERT INTO institutions
        (name, slug, domain, primary_color, timezone, locale,
         subscription_plan, max_users, max_storage_gb, status, settings)
      VALUES
        ('Bedo University', 'bedo-university', $1, '#0057B7',
         'UTC', 'en', 'professional', 200, 20.00, 'active', '{}')
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name, status = 'active', updated_at = NOW()
      RETURNING id
    `, [INSTITUTION_DOMAIN]);
    const institutionId = inst.id;

    await client.query(`
      INSERT INTO institution_domains (institution_id, domain, is_primary)
      VALUES ($1, $2, TRUE)
      ON CONFLICT (institution_id, domain) DO NOTHING
    `, [institutionId, INSTITUTION_DOMAIN]);

    // ── 2. Users — one account per role per person ──────────────────────────
    const userIds = [];
    for (const u of usersSpec) {
      const hash = await bcrypt.hash(u.password, SALT_ROUNDS);
      const { rows: [user] } = await client.query(`
        INSERT INTO users
          (email, password_hash, first_name, last_name, institution_id, status)
        VALUES ($1, $2, $3, $4, $5, 'active')
        ON CONFLICT (email) DO UPDATE SET
          password_hash  = EXCLUDED.password_hash,
          first_name     = EXCLUDED.first_name,
          last_name      = EXCLUDED.last_name,
          institution_id = EXCLUDED.institution_id,
          status         = 'active',
          updated_at     = NOW()
        RETURNING id
      `, [u.email, hash, u.firstName, u.lastName, institutionId]);

      userIds.push(user.id);

      await client.query(
        `DELETE FROM user_roles WHERE user_id = $1 AND institution_id = $2`,
        [user.id, institutionId],
      );
      await client.query(`
        INSERT INTO user_roles (user_id, role_id, institution_id, context_type, context_id)
        SELECT $1, id, $2, 'institution', $2 FROM roles WHERE name = $3
        ON CONFLICT DO NOTHING
      `, [user.id, institutionId, u.role]);
    }

    // ── 3. Department — required so academic years can be created ──────────
    const { rows: [dept] } = await client.query(`
      INSERT INTO departments (institution_id, name, code)
      VALUES ($1, 'Engineering', 'ENG')
      ON CONFLICT (institution_id, code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, [institutionId]);
    const departmentId = dept.id;

    // ── 4. Simulation catalog — Fluid Mechanics + Renewable Energy only ────
    const { rows: [fluidMechanicsCat] } = await client.query(
      `SELECT id FROM simulation_catalogs WHERE name = 'Fluid Mechanics' AND status = 'active' LIMIT 1`,
    );
    const { rows: [renewableEnergyCat] } = await client.query(
      `SELECT id FROM simulation_catalogs WHERE name = 'Renewable Energy Laboratory' AND status = 'active' LIMIT 1`,
    );

    if (!fluidMechanicsCat) {
      throw new Error('Catalog "Fluid Mechanics" not found — run `npm run seed` first to create it.');
    }
    if (!renewableEnergyCat) {
      throw new Error('Catalog "Renewable Energy Laboratory" not found — run `npm run seed` first to create it.');
    }

    async function assignCatalogToInstitution(catalogId) {
      await client.query(`
        INSERT INTO institution_simulation_catalogs
          (institution_id, simulation_catalog_id, assigned_by, include_subtree, status)
        VALUES ($1, $2, $3, TRUE, 'active')
        ON CONFLICT (institution_id, simulation_catalog_id) WHERE status = 'active'
          DO UPDATE SET include_subtree = TRUE, assigned_by = EXCLUDED.assigned_by, updated_at = NOW()
      `, [institutionId, catalogId, userIds[0]]);
    }

    await assignCatalogToInstitution(fluidMechanicsCat.id);
    await assignCatalogToInstitution(renewableEnergyCat.id);

    await client.query('COMMIT');

    console.log('Bedo University seeded successfully.');
    console.log(`  Institution: Bedo University (${institutionId})`);
    console.log(`  Department: Engineering (${departmentId}) — add academic years under this department`);
    console.log('  Accounts:');
    usersSpec.forEach((u) => {
      console.log(`    ${u.firstName} ${u.lastName} [${u.role}]  ${u.email} / ${u.password}`);
    });
    console.log('  Catalog access: Fluid Mechanics, Renewable Energy Laboratory');
    console.log('  NOTE: "Renewable Energy Laboratory" has no simulations linked yet in');
    console.log('        this database (it is an empty catalog node) — upload/link one via');
    console.log('        the catalog admin UI if the institution needs a playable sim there.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seeding Bedo University failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seedBedoUniversity();
