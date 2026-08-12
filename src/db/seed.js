/**
 * Development seed — RBAC v2 + Multi-tenant + BEDO Catalog Tree. NOT for production.
 * Run with: npm run seed
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutions:  Cairo University (primary)  |  Test University (cross-tenant)
 *
 * Cairo University accounts:
 *   super_admin        superadmin@cairo-university.edu     / SuperAdmin123!
 *   institution_admin  admin@cairo-university.edu          / Admin1234!
 *   dept_manager       deptmanager@cairo-university.edu    / Manager123!
 *   instructor         instructor@cairo-university.edu     / Instructor1!
 *   teaching_assistant ta@cairo-university.edu             / Teaching1!
 *   student            student1@cairo-university.edu       / Student123!    ME / AY1 / S1
 *   student            student2@cairo-university.edu       / Student234!    ME / AY1 / S2
 *
 * Test University accounts:
 *   institution_admin  admin@test-university.edu          / TestAdmin1!
 *   instructor         instructor@test-university.edu     / TestInstr1!
 *   student            student3@test-university.edu       / Student345!    SEC / AY1 / S1
 *
 * Catalog tree (BEDO structure):
 *   Visibility:
 *     demo_and_institution — visible publicly AND accessible to institution users
 *     demo_public          — public only (no institution assignment)
 *     institution          — institution-assigned only
 *
 * Idempotent: safe to re-run.
 */
'use strict';

const config = require('../config');
const bcrypt   = require('bcryptjs');
const { pool } = require('../config/database');

const SALT_ROUNDS = 12;

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── 1. Institutions ──────────────────────────────────────────────────────

    const { rows: [inst] } = await client.query(`
      INSERT INTO institutions
        (name, slug, domain, primary_color, timezone, locale,
         subscription_plan, max_users, max_storage_gb, status, settings)
      VALUES
        ('Cairo University', 'cairo-university', 'cairo-university.edu', '#0057B7',
         'UTC', 'en', 'enterprise', 500, 50.00, 'active', '{}')
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name, status = 'active', updated_at = NOW()
      RETURNING id
    `);
    const institutionId = inst.id;

    await client.query(`
      INSERT INTO institution_domains (institution_id, domain, is_primary)
      VALUES ($1, 'cairo-university.edu', TRUE)
      ON CONFLICT (institution_id, domain) DO NOTHING
    `, [institutionId]);

    const { rows: [testInst] } = await client.query(`
      INSERT INTO institutions
        (name, slug, domain, primary_color, timezone, locale,
         subscription_plan, max_users, max_storage_gb, status, settings)
      VALUES
        ('Test University', 'test-university', 'test-university.edu', '#CC0000',
         'UTC', 'en', 'starter', 200, 20.00, 'active', '{}')
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name, status = 'active', updated_at = NOW()
      RETURNING id
    `);
    const testInstitutionId = testInst.id;

    await client.query(`
      INSERT INTO institution_domains (institution_id, domain, is_primary)
      VALUES ($1, 'test-university.edu', TRUE)
      ON CONFLICT (institution_id, domain) DO NOTHING
    `, [testInstitutionId]);

    // ── 2. Departments ───────────────────────────────────────────────────────

    const CairoDeptsSpec = [
      ['Computer Science',       'CS'],
      ['Biology',                'BIO'],
      ['Physics',                'PHY'],
      ['Chemistry',              'CHEM'],
      ['Mechanical Engineering', 'ME'],
      ['Electrical Engineering', 'EE'],
    ];
    const deptIds = {};
    for (const [name, code] of CairoDeptsSpec) {
      const { rows: [d] } = await client.query(`
        INSERT INTO departments (institution_id, name, code)
        VALUES ($1, $2, $3)
        ON CONFLICT (institution_id, code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `, [institutionId, name, code]);
      deptIds[code] = d.id;
    }

    const { rows: [testCS] } = await client.query(`
      INSERT INTO departments (institution_id, name, code)
      VALUES ($1, 'Cybersecurity', 'SEC')
      ON CONFLICT (institution_id, code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, [testInstitutionId]);
    const testDeptId = testCS.id;

    // ── 3. Academic terms ────────────────────────────────────────────────────

    const { rows: [term] } = await client.query(`
      INSERT INTO academic_terms (institution_id, name, start_date, end_date, is_current)
      VALUES ($1, 'Fall 2026', '2026-09-01', '2026-12-20', TRUE)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [institutionId]);

    const { rows: [termRow] } = await client.query(
      `SELECT id FROM academic_terms WHERE institution_id = $1 AND name = 'Fall 2026' LIMIT 1`,
      [institutionId],
    );
    const termId = term?.id ?? termRow?.id ?? null;

    const { rows: [testTerm] } = await client.query(`
      INSERT INTO academic_terms (institution_id, name, start_date, end_date, is_current)
      VALUES ($1, 'Fall 2026', '2026-09-01', '2026-12-20', TRUE)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [testInstitutionId]);
    const { rows: [testTermRow] } = await client.query(
      `SELECT id FROM academic_terms WHERE institution_id = $1 AND name = 'Fall 2026' LIMIT 1`,
      [testInstitutionId],
    );
    const testTermId = testTerm?.id ?? testTermRow?.id ?? null;

    // ── 4. Users ─────────────────────────────────────────────────────────────

    const usersSpec = [
      { key: 'superadmin', email: 'superadmin@cairo-university.edu', password: 'SuperAdmin123!', firstName: 'Super',  lastName: 'Admin',     role: 'super_admin',        instId: institutionId },
      { key: 'admin',      email: 'admin@cairo-university.edu',       password: 'Admin1234!',    firstName: 'System', lastName: 'Admin',     role: 'institution_admin',  instId: institutionId },
      { key: 'manager',    email: 'deptmanager@cairo-university.edu', password: 'Manager123!',   firstName: 'Dana',   lastName: 'Manager',   role: 'dept_manager',       instId: institutionId },
      { key: 'instructor', email: 'instructor@cairo-university.edu',  password: 'Instructor1!',  firstName: 'Jane',   lastName: 'Smith',     role: 'instructor',         instId: institutionId },
      { key: 'ta',         email: 'ta@cairo-university.edu',          password: 'Teaching1!',    firstName: 'Tom',    lastName: 'Assist',    role: 'teaching_assistant', instId: institutionId },
      { key: 'student1',   email: 'student1@cairo-university.edu',    password: 'Student123!',   firstName: 'Alex',   lastName: 'Johnson',   role: 'student',            instId: institutionId },
      { key: 'student2',   email: 'student2@cairo-university.edu',    password: 'Student234!',   firstName: 'Sam',    lastName: 'Rivera',    role: 'student',            instId: institutionId },
      { key: 'testAdmin',  email: 'admin@test-university.edu',        password: 'TestAdmin1!',   firstName: 'Tim',    lastName: 'TestAdmin', role: 'institution_admin',  instId: testInstitutionId },
      { key: 'testInstr',  email: 'instructor@test-university.edu',   password: 'TestInstr1!',   firstName: 'Iris',   lastName: 'TestInstr', role: 'instructor',         instId: testInstitutionId },
      { key: 'student3',   email: 'student3@test-university.edu',     password: 'Student345!',   firstName: 'Taylor', lastName: 'Brown',     role: 'student',            instId: testInstitutionId },
    ];

    const userIds = {};
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
      `, [u.email, hash, u.firstName, u.lastName, u.instId]);

      userIds[u.key] = user.id;

      await client.query(
        `DELETE FROM user_roles WHERE user_id = $1 AND institution_id = $2`,
        [user.id, u.instId],
      );
      await client.query(`
        INSERT INTO user_roles (user_id, role_id, institution_id, context_type, context_id)
        SELECT $1, id, $2, 'institution', $2 FROM roles WHERE name = $3
        ON CONFLICT DO NOTHING
      `, [user.id, u.instId, u.role]);
    }

    await client.query(`
      INSERT INTO user_departments (user_id, department_id, assigned_by)
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING
    `, [userIds.manager, deptIds['CS'], userIds.admin]);

    // ── 5. Global domain ─────────────────────────────────────────────────────

    const { rows: [csDomain] } = await client.query(
      `SELECT id FROM domains WHERE name = 'Computer Science' AND institution_id IS NULL LIMIT 1`,
    );
    const csDomainId = csDomain?.id ?? null;

    // ── 6. Courses — Cairo University ────────────────────────────────────────

    const now      = new Date();
    const twoDays  = new Date(now.getTime() - 2  * 24 * 60 * 60 * 1000).toISOString();
    const oneMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const coursesSpec = [
      { key: 'networkSecurity', code: 'SEC101', title: 'Network Security Basics',        description: 'Firewalls, VPNs, intrusion detection, and packet analysis.',   status: 'published', enrollmentType: 'open',     settings: {},                         passingGrade: 70, publishedAt: twoDays,  startDate: '2026-09-01', endDate: '2026-12-20' },
      { key: 'malware',         code: 'SEC301', title: 'Advanced Malware Analysis',      description: 'Reverse-engineer malware using IDA Pro, x64dbg, Ghidra.',       status: 'published', enrollmentType: 'approval', settings: {},                         passingGrade: 75, publishedAt: twoDays,  startDate: '2026-09-01', endDate: '2026-12-20' },
      { key: 'python',          code: 'SEC201', title: 'Python for Penetration Testing', description: 'Write offensive security tools in Python.',                      status: 'published', enrollmentType: 'code',     settings: { enrollmentCode: 'HACK2025' }, passingGrade: 70, publishedAt: twoDays, startDate: '2026-09-01', endDate: '2026-12-20' },
      { key: 'crypto',          code: 'SEC102', title: 'Cryptography Fundamentals',      description: 'Symmetric/asymmetric encryption, hashing, PKI, and TLS/SSL.',   status: 'draft',     enrollmentType: 'open',     settings: {},                         passingGrade: 70, publishedAt: null,     startDate: '2026-10-01', endDate: '2026-12-20' },
      { key: 'legacy',          code: 'SEC001', title: 'Legacy Security Concepts',       description: 'Historical overview of early network security.',                  status: 'archived',  enrollmentType: 'open',     settings: {},                         passingGrade: 60, publishedAt: oneMonth, startDate: null,         endDate: null         },
      { key: 'zeroTrust',       code: 'SEC401', title: 'Zero Trust Architecture',        description: 'Micro-segmentation, identity-based access, and monitoring.',     status: 'published', enrollmentType: 'admin',    settings: {},                         passingGrade: 80, publishedAt: twoDays,  startDate: '2026-09-01', endDate: '2026-12-20' },
    ];

    const courseIds = {};
    for (const c of coursesSpec) {
      const { rows: [course] } = await client.query(`
        INSERT INTO courses
          (institution_id, department_id, term_id, domain_id, instructor_id,
           code, title, description, status, enrollment_type, enrollment_cap,
           start_date, end_date, passing_grade, settings, published_at, created_by)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, $11, $12, $13, $14, $15, $5)
        ON CONFLICT (institution_id, code) DO UPDATE SET
          title           = EXCLUDED.title,
          description     = EXCLUDED.description,
          status          = EXCLUDED.status,
          enrollment_type = EXCLUDED.enrollment_type,
          settings        = EXCLUDED.settings,
          passing_grade   = EXCLUDED.passing_grade,
          published_at    = EXCLUDED.published_at,
          start_date      = EXCLUDED.start_date,
          end_date        = EXCLUDED.end_date,
          updated_at      = NOW()
        RETURNING id
      `, [
        institutionId, deptIds['CS'], termId, csDomainId, userIds.instructor,
        c.code, c.title, c.description, c.status, c.enrollmentType,
        c.startDate ?? null, c.endDate ?? null,
        c.passingGrade, JSON.stringify(c.settings), c.publishedAt ?? null,
      ]);
      courseIds[c.key] = course.id;
    }

    // ── 6a. Test University course ───────────────────────────────────────────

    const { rows: [testCourse] } = await client.query(`
      INSERT INTO courses
        (institution_id, department_id, term_id, instructor_id,
         code, title, description, status, enrollment_type,
         start_date, end_date, passing_grade, settings, published_at, created_by)
      VALUES
        ($1, $2, $3, $4, 'CYB101', 'Introduction to Cybersecurity',
         'Foundations of cybersecurity: CIA triad, threat models, and basic defenses.',
         'published', 'open', '2026-09-01', '2026-12-20', 70, '{}', $5, $4)
      ON CONFLICT (institution_id, code) DO UPDATE SET
        title = EXCLUDED.title, updated_at = NOW()
      RETURNING id
    `, [testInstitutionId, testDeptId, testTermId, userIds.testInstr, twoDays]);
    const testCourseId = testCourse.id;

    // ── 6b. TA assignment ────────────────────────────────────────────────────

    await client.query(`
      INSERT INTO course_teaching_assistants (course_id, user_id, assigned_by)
      VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
    `, [courseIds.networkSecurity, userIds.ta, userIds.instructor]);

    // ── 7. Enrollments ───────────────────────────────────────────────────────

    await client.query(`
      INSERT INTO enrollments (course_id, user_id, role, status)
      VALUES ($1, $2, 'student', 'active')
      ON CONFLICT (course_id, user_id) DO UPDATE SET status = 'active'
    `, [courseIds.networkSecurity, userIds.student1]);

    await client.query(`
      INSERT INTO enrollments (course_id, user_id, role, status)
      VALUES ($1, $2, 'student', 'pending')
      ON CONFLICT (course_id, user_id) DO UPDATE SET status = 'pending'
    `, [courseIds.malware, userIds.student2]);

    await client.query(`
      INSERT INTO enrollments (course_id, user_id, role, status)
      VALUES ($1, $2, 'student', 'active')
      ON CONFLICT (course_id, user_id) DO UPDATE SET status = 'active'
    `, [testCourseId, userIds.student3]);

    // ── 8. Course progress ───────────────────────────────────────────────────

    await client.query(`
      INSERT INTO course_progress (user_id, course_id, completion_pct, status)
      VALUES ($1, $2, 25.00, 'in_progress')
      ON CONFLICT (user_id, course_id) DO UPDATE SET
        completion_pct = 25.00, status = 'in_progress', updated_at = NOW()
    `, [userIds.student1, courseIds.networkSecurity]);

    await client.query(`
      INSERT INTO course_progress (user_id, course_id, completion_pct, status)
      VALUES ($1, $2, 0.00, 'not_started')
      ON CONFLICT (user_id, course_id) DO UPDATE SET
        completion_pct = 0.00, status = 'not_started', updated_at = NOW()
    `, [userIds.student3, testCourseId]);

    // ── 9. Clean slate — wipe old simulation / catalog data ──────────────────
    // Delete in FK dependency order so the catalog tree can be rebuilt cleanly.

    await client.query(`DELETE FROM simulation_sessions`);
    await client.query(`DELETE FROM grades WHERE grade_item_id IN (
      SELECT id FROM grade_items WHERE simulation_id IS NOT NULL
    )`);
    await client.query(`DELETE FROM grade_items WHERE simulation_id IS NOT NULL`);
    await client.query(`DELETE FROM institution_simulation_catalogs`);
    await client.query(`DELETE FROM department_simulation_catalogs`);
    await client.query(`DELETE FROM simulation_catalog_items`);
    // NULL out self-referencing FKs before bulk-deleting catalog rows
    await client.query(`UPDATE simulation_catalogs SET parent_id = NULL, root_catalog_id = NULL`);
    await client.query(`DELETE FROM simulation_catalogs`);
    await client.query(`DELETE FROM simulations`);
    // Lessons that referenced deleted simulations now have simulation_id = NULL (ON DELETE SET NULL)

    // ── 10. Simulations (WebGL stubs) ─────────────────────────────────────────
    //
    // All simulations are assigned to a BEDO catalog node below.
    // Visibility:
    //   demo_and_institution — public demo + institution-assigned access
    //   demo_public          — public demo only
    //   institution          — institution-assigned only

    const fs   = require('fs');
    const path = require('path');

    const storageBase = process.env.SIMULATION_STORAGE_PATH
      ? path.resolve(process.env.SIMULATION_STORAGE_PATH)
      : path.resolve(__dirname, '../../../storage/simulations');

    function makeStubBuild(buildUuid, simTitle) {
      const buildDir = path.join(storageBase, buildUuid, 'Build');
      fs.mkdirSync(buildDir, { recursive: true });
      const html = path.join(storageBase, buildUuid, 'index.html');
      if (!fs.existsSync(html)) {
        fs.writeFileSync(html,
          `<!DOCTYPE html><html><head><title>${simTitle}</title><meta charset="utf-8"></head>` +
          `<body style="background:#0d1117;color:#e6edf3;display:flex;align-items:center;` +
          `justify-content:center;height:100vh;margin:0;font-family:system-ui,sans-serif;` +
          `flex-direction:column;gap:16px">` +
          `<h1 style="margin:0;font-size:1.5rem">${simTitle}</h1>` +
          `<p style="color:#8b949e;margin:0">BEDO stub — upload a real Unity WebGL build to replace this.</p>` +
          `</body></html>`,
        );
      }
      ['stub.loader.js', 'stub.wasm.gz', 'stub.data.gz'].forEach((f) => {
        const fp = path.join(buildDir, f);
        if (!fs.existsSync(fp)) fs.writeFileSync(fp, '');
      });
    }

    // Fixed UUIDs — idempotent across re-seeds
    const SEED_SIMS = {
      plcControl:         '00000000-0000-4000-8000-000000000001',
      sensorActuators:    '00000000-0000-4000-8000-000000000002',
      robotics:           '00000000-0000-4000-8000-000000000003',
      fluidMechanics:     '00000000-0000-4000-8000-000000000004',
      thermodynamics:     '00000000-0000-4000-8000-000000000005',
      electricalMachines: '00000000-0000-4000-8000-000000000006',
      powerElectronics:   '00000000-0000-4000-8000-000000000007',
      engineSystems:      '00000000-0000-4000-8000-000000000008',
      physicsMechanics:   '00000000-0000-4000-8000-000000000009',
      lightOptics:        '00000000-0000-4000-8000-000000000010',
      aiLab:              '00000000-0000-4000-8000-000000000011',
      networkSecurity:    '00000000-0000-4000-8000-000000000012',
      safetyProcedures:   '00000000-0000-4000-8000-000000000013',
      electronicsLab:     '00000000-0000-4000-8000-000000000014',
      pumpPerformance:    '00000000-0000-4000-8000-000000000015',
      circuitAnalysis:    '00000000-0000-4000-8000-000000000016',
      refrigeration:      '00000000-0000-4000-8000-000000000017',
    };

    async function insertSim({ uuid, title, description, difficulty, estimatedMinutes, visibility, objectives }) {
      await client.query(`
        INSERT INTO simulations
          (institution_id, title, description, type, launch_type,
           build_uuid, original_zip_filename, storage_path, public_entry_url, entry_file,
           build_status, build_validation, estimated_minutes,
           difficulty, max_score, pass_score, max_attempts, scoring_config,
           learning_objectives, status, visibility, version, created_by)
        VALUES
          (NULL, $1, $2, 'webgl', 'webgl',
           $3, $4, $5, $6, 'index.html',
           'ready', '{"valid":true,"stub":true}', $7,
           $8, 100, 70, 3, '{"hints_penalty":5,"max_hints":3}',
           $9, 'active', $10, '1.0.0', $11)
        ON CONFLICT DO NOTHING
      `, [
        title, description,
        uuid,
        `${title.toLowerCase().replace(/\s+/g, '-')}.zip`,
        // Relative — same convention as webgl.service.js's getRelativeBuildPath().
        // `storageBase` (absolute) is only used below for the actual stub-file writes.
        `${config.storage.simulationsDir}/${uuid}`.replace(/\\/g, '/'),
        `/simulations-runtime/${uuid}/index.html`,
        estimatedMinutes, difficulty,
        objectives, visibility,
        userIds.superadmin,
      ]);
      makeStubBuild(uuid, title);
      const { rows: [r] } = await client.query(
        `SELECT id FROM simulations WHERE build_uuid=$1 LIMIT 1`, [uuid],
      );
      return r?.id ?? null;
    }

    const simIds = {};

    simIds.plcControl = await insertSim({
      uuid: SEED_SIMS.plcControl, title: 'PLC Control Systems Lab',
      description: 'Programme and simulate PLC ladder logic for industrial automation tasks.',
      difficulty: 'intermediate', estimatedMinutes: 45, visibility: 'demo_and_institution',
      objectives: ['Write ladder logic programs', 'Configure I/O modules', 'Simulate process control'],
    });

    simIds.sensorActuators = await insertSim({
      uuid: SEED_SIMS.sensorActuators, title: 'Sensor & Actuators Lab',
      description: 'Connect and calibrate industrial sensors and actuators in a virtual environment.',
      difficulty: 'beginner', estimatedMinutes: 30, visibility: 'demo_and_institution',
      objectives: ['Identify sensor types', 'Wire sensor circuits', 'Interpret sensor readings'],
    });

    simIds.robotics = await insertSim({
      uuid: SEED_SIMS.robotics, title: 'Robotics Programming Lab',
      description: 'Programme robotic arms and mobile robots using ROS-style task blocks.',
      difficulty: 'intermediate', estimatedMinutes: 50, visibility: 'demo_and_institution',
      objectives: ['Define robot kinematics', 'Write motion programs', 'Test pick-and-place tasks'],
    });

    simIds.fluidMechanics = await insertSim({
      uuid: SEED_SIMS.fluidMechanics, title: 'Fluid Mechanics Lab',
      description: 'Apply Bernoulli\'s equation and continuity to analyse pipe-flow systems.',
      difficulty: 'intermediate', estimatedMinutes: 40, visibility: 'demo_and_institution',
      objectives: ['Solve continuity equations', 'Apply Bernoulli principle', 'Measure pressure drop'],
    });

    simIds.thermodynamics = await insertSim({
      uuid: SEED_SIMS.thermodynamics, title: 'Thermodynamics Lab',
      description: 'Explore thermodynamic cycles, heat engines, and entropy concepts interactively.',
      difficulty: 'intermediate', estimatedMinutes: 45, visibility: 'demo_and_institution',
      objectives: ['Analyse Carnot cycle', 'Calculate thermal efficiency', 'Identify heat transfer modes'],
    });

    simIds.refrigeration = await insertSim({
      uuid: SEED_SIMS.refrigeration, title: 'Refrigeration & HVAC Lab',
      description: 'Simulate vapour-compression refrigeration cycles and HVAC system design.',
      difficulty: 'advanced', estimatedMinutes: 50, visibility: 'demo_and_institution',
      objectives: ['Calculate COP', 'Size refrigerant components', 'Diagnose HVAC faults'],
    });

    simIds.electricalMachines = await insertSim({
      uuid: SEED_SIMS.electricalMachines, title: 'Electrical Machines & Transformer Lab',
      description: 'Test DC/AC machines and transformers under various load conditions.',
      difficulty: 'intermediate', estimatedMinutes: 45, visibility: 'institution',
      objectives: ['Measure no-load/full-load characteristics', 'Compute transformer efficiency', 'Analyse motor torque curves'],
    });

    simIds.powerElectronics = await insertSim({
      uuid: SEED_SIMS.powerElectronics, title: 'Power Electronics Lab',
      description: 'Design and test rectifiers, inverters, and DC-DC converters.',
      difficulty: 'advanced', estimatedMinutes: 55, visibility: 'institution',
      objectives: ['Analyse converter topologies', 'Compute ripple voltage', 'Design gate drive circuits'],
    });

    simIds.engineSystems = await insertSim({
      uuid: SEED_SIMS.engineSystems, title: 'Engine Systems Lab',
      description: 'Explore internal combustion engine operation, valve timing, and diagnostics.',
      difficulty: 'intermediate', estimatedMinutes: 40, visibility: 'institution',
      objectives: ['Explain 4-stroke cycle', 'Adjust valve timing', 'Read engine diagnostic codes'],
    });

    simIds.physicsMechanics = await insertSim({
      uuid: SEED_SIMS.physicsMechanics, title: 'Physics Mechanics Lab',
      description: 'Investigate Newton\'s laws, projectile motion, and conservation of momentum.',
      difficulty: 'beginner', estimatedMinutes: 30, visibility: 'demo_public',
      objectives: ['Verify Newton\'s second law', 'Analyse projectile trajectories', 'Apply conservation of momentum'],
    });

    simIds.lightOptics = await insertSim({
      uuid: SEED_SIMS.lightOptics, title: 'Light & Optics Lab',
      description: 'Explore reflection, refraction, lenses, and wave optics through interactive experiments.',
      difficulty: 'beginner', estimatedMinutes: 35, visibility: 'demo_public',
      objectives: ['Apply Snell\'s law', 'Design lens systems', 'Observe interference patterns'],
    });

    simIds.aiLab = await insertSim({
      uuid: SEED_SIMS.aiLab, title: 'AI Fundamentals Lab',
      description: 'Train simple classifiers and observe machine-learning concepts in action.',
      difficulty: 'beginner', estimatedMinutes: 35, visibility: 'demo_and_institution',
      objectives: ['Train a decision tree', 'Evaluate model accuracy', 'Identify overfitting'],
    });

    simIds.networkSecurity = await insertSim({
      uuid: SEED_SIMS.networkSecurity, title: 'Network Security Lab',
      description: 'Configure firewall rules and analyse packet captures to detect intrusions.',
      difficulty: 'intermediate', estimatedMinutes: 40, visibility: 'demo_and_institution',
      objectives: ['Write stateful firewall rules', 'Identify attack signatures in PCAP', 'Harden network configuration'],
    });

    simIds.safetyProcedures = await insertSim({
      uuid: SEED_SIMS.safetyProcedures, title: 'Safety Procedures & PPE Lab',
      description: 'Practice hazard identification and select correct PPE for industrial scenarios.',
      difficulty: 'beginner', estimatedMinutes: 25, visibility: 'demo_and_institution',
      objectives: ['Identify workplace hazards', 'Select appropriate PPE', 'Follow lockout-tagout procedures'],
    });

    simIds.electronicsLab = await insertSim({
      uuid: SEED_SIMS.electronicsLab, title: 'Electronics Lab',
      description: 'Build and test analogue and digital circuits on a virtual breadboard.',
      difficulty: 'beginner', estimatedMinutes: 35, visibility: 'institution',
      objectives: ['Read circuit schematics', 'Measure voltage and current', 'Troubleshoot faulty circuits'],
    });

    simIds.pumpPerformance = await insertSim({
      uuid: SEED_SIMS.pumpPerformance, title: 'Pump Performance Lab',
      description: 'Analyse centrifugal pump curves and select operating points for given system requirements.',
      difficulty: 'intermediate', estimatedMinutes: 40, visibility: 'demo_and_institution',
      objectives: ['Read pump performance curves', 'Identify BEP', 'Match pump to system curve'],
    });

    simIds.circuitAnalysis = await insertSim({
      uuid: SEED_SIMS.circuitAnalysis, title: 'Circuit Analysis Lab',
      description: 'Build and solve DC circuits using KVL, KCL, and Thevenin/Norton equivalents.',
      difficulty: 'intermediate', estimatedMinutes: 50, visibility: 'institution',
      objectives: ['Apply KVL and KCL', 'Compute Thevenin equivalent', 'Verify with simulation'],
    });

    // ── 11. BEDO Catalog Tree ─────────────────────────────────────────────────

    async function insertCatalog({ name, description, visibility, parentId, parentPath, rootCatalogId, depth, sortOrder }) {
      const slug = name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 200);
      const { rows: [cat] } = await client.query(`
        INSERT INTO simulation_catalogs
          (name, description, parent_id, root_catalog_id, depth, path, sort_order, slug,
           visibility, is_global, is_demo, created_by, status)
        VALUES ($1,$2,$3,$4,$5,'',$6,$7,$8,$9,$10,$11,'active')
        RETURNING id
      `, [
        name, description ?? null,
        parentId ?? null, rootCatalogId ?? null,
        depth, sortOrder ?? 0, slug,
        visibility,
        visibility === 'global',
        visibility === 'demo_public',
        userIds.superadmin,
      ]);
      const id = cat.id;
      const finalPath   = parentPath ? `${parentPath}/${id}` : id;
      const finalRootId = rootCatalogId ?? id;
      await client.query(
        `UPDATE simulation_catalogs SET path=$1, root_catalog_id=$2 WHERE id=$3`,
        [finalPath, finalRootId, id],
      );
      return { id, path: finalPath };
    }

    async function addSimToCat(catalogId, simId) {
      if (!simId) return;
      await client.query(
        `INSERT INTO simulation_catalog_items (catalog_id, simulation_id, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [catalogId, simId, userIds.superadmin],
      );
    }

    async function assignToInst(instId, catalogId) {
      await client.query(`
        INSERT INTO institution_simulation_catalogs
          (institution_id, simulation_catalog_id, assigned_by, include_subtree, status)
        VALUES ($1,$2,$3,TRUE,'active')
        ON CONFLICT (institution_id, simulation_catalog_id) WHERE status = 'active'
          DO UPDATE SET include_subtree=TRUE, assigned_by=EXCLUDED.assigned_by, updated_at=NOW()
      `, [instId, catalogId, userIds.superadmin]);
    }

    // ── Root 1: Mechatronics — demo_and_institution ────────────────────────────

    const mecha = await insertCatalog({ name: 'Mechatronics', description: 'Control, robotics and embedded systems.', visibility: 'demo_and_institution', depth: 0, sortOrder: 0 });

    const mechaCtrl = await insertCatalog({ name: 'Control Technology', visibility: 'demo_and_institution', parentId: mecha.id, parentPath: mecha.path, rootCatalogId: mecha.id, depth: 1, sortOrder: 0 });
    await insertCatalog({ name: 'Process Control & PID System Control', visibility: 'demo_and_institution', parentId: mechaCtrl.id, parentPath: mechaCtrl.path, rootCatalogId: mecha.id, depth: 2, sortOrder: 0 });
    const mechaPLC    = await insertCatalog({ name: 'PLC Control System', visibility: 'demo_and_institution', parentId: mechaCtrl.id, parentPath: mechaCtrl.path, rootCatalogId: mecha.id, depth: 2, sortOrder: 1 });
    await insertCatalog({ name: 'Classic Control', visibility: 'demo_and_institution', parentId: mechaCtrl.id, parentPath: mechaCtrl.path, rootCatalogId: mecha.id, depth: 2, sortOrder: 2 });
    await insertCatalog({ name: 'Hydraulics & Pneumatic', visibility: 'demo_and_institution', parentId: mechaCtrl.id, parentPath: mechaCtrl.path, rootCatalogId: mecha.id, depth: 2, sortOrder: 3 });
    const mechaSensor = await insertCatalog({ name: 'Sensor & Actuators', visibility: 'demo_and_institution', parentId: mechaCtrl.id, parentPath: mechaCtrl.path, rootCatalogId: mecha.id, depth: 2, sortOrder: 4 });
    await insertCatalog({ name: 'Motor Control', visibility: 'demo_and_institution', parentId: mechaCtrl.id, parentPath: mechaCtrl.path, rootCatalogId: mecha.id, depth: 2, sortOrder: 5 });

    const mechaRob = await insertCatalog({ name: 'Robotics & Embedde', visibility: 'demo_and_institution', parentId: mecha.id, parentPath: mecha.path, rootCatalogId: mecha.id, depth: 1, sortOrder: 1 });
    await insertCatalog({ name: 'Embedded', visibility: 'demo_and_institution', parentId: mechaRob.id, parentPath: mechaRob.path, rootCatalogId: mecha.id, depth: 2, sortOrder: 0 });
    const mechaRobLeaf = await insertCatalog({ name: 'Robotics', visibility: 'demo_and_institution', parentId: mechaRob.id, parentPath: mechaRob.path, rootCatalogId: mecha.id, depth: 2, sortOrder: 1 });
    await insertCatalog({ name: 'Mechatronics training system', visibility: 'demo_and_institution', parentId: mechaRob.id, parentPath: mechaRob.path, rootCatalogId: mecha.id, depth: 2, sortOrder: 2 });

    await insertCatalog({ name: 'Measurements', visibility: 'demo_and_institution', parentId: mecha.id, parentPath: mecha.path, rootCatalogId: mecha.id, depth: 1, sortOrder: 2 });

    await addSimToCat(mechaPLC.id,     simIds.plcControl);
    await addSimToCat(mechaSensor.id,  simIds.sensorActuators);
    await addSimToCat(mechaRobLeaf.id, simIds.robotics);
    await assignToInst(institutionId,     mecha.id);
    await assignToInst(testInstitutionId, mecha.id);

    // ── Root 2: Civil — institution ────────────────────────────────────────────

    const civil = await insertCatalog({ name: 'Civil', description: 'Civil engineering simulation labs.', visibility: 'institution', depth: 0, sortOrder: 1 });
    await insertCatalog({ name: 'Fundemetal of Fluids', visibility: 'institution', parentId: civil.id, parentPath: civil.path, rootCatalogId: civil.id, depth: 1, sortOrder: 0 });
    await insertCatalog({ name: 'Hydraulic & Irrigation', visibility: 'institution', parentId: civil.id, parentPath: civil.path, rootCatalogId: civil.id, depth: 1, sortOrder: 1 });
    await insertCatalog({ name: 'Plumbing', visibility: 'institution', parentId: civil.id, parentPath: civil.path, rootCatalogId: civil.id, depth: 1, sortOrder: 2 });
    await insertCatalog({ name: 'Structure', visibility: 'institution', parentId: civil.id, parentPath: civil.path, rootCatalogId: civil.id, depth: 1, sortOrder: 3 });
    await assignToInst(institutionId, civil.id);

    // ── Root 3: Occupational health, security and industrial — demo_and_institution ──

    const ohsai = await insertCatalog({ name: 'Occupational health, security and industrial', description: 'Workplace safety and industrial health simulations.', visibility: 'demo_and_institution', depth: 0, sortOrder: 2 });
    const ohsaiSafety = await insertCatalog({ name: 'Safety Procedures & PPE', visibility: 'demo_and_institution', parentId: ohsai.id, parentPath: ohsai.path, rootCatalogId: ohsai.id, depth: 1, sortOrder: 0 });
    await insertCatalog({ name: 'Mechanical Safety', visibility: 'demo_and_institution', parentId: ohsai.id, parentPath: ohsai.path, rootCatalogId: ohsai.id, depth: 1, sortOrder: 1 });
    await insertCatalog({ name: 'Power System & Protection', visibility: 'demo_and_institution', parentId: ohsai.id, parentPath: ohsai.path, rootCatalogId: ohsai.id, depth: 1, sortOrder: 2 });
    await insertCatalog({ name: 'Electrical Installation', visibility: 'demo_and_institution', parentId: ohsai.id, parentPath: ohsai.path, rootCatalogId: ohsai.id, depth: 1, sortOrder: 3 });
    await insertCatalog({ name: 'Electrical Installation Workbench', visibility: 'demo_and_institution', parentId: ohsai.id, parentPath: ohsai.path, rootCatalogId: ohsai.id, depth: 1, sortOrder: 4 });
    await insertCatalog({ name: 'Electrical Maintenance & Troubleshooting', visibility: 'demo_and_institution', parentId: ohsai.id, parentPath: ohsai.path, rootCatalogId: ohsai.id, depth: 1, sortOrder: 5 });
    await addSimToCat(ohsaiSafety.id, simIds.safetyProcedures);
    await assignToInst(institutionId, ohsai.id);

    // ── Root 4: Mechanical — demo_and_institution ──────────────────────────────

    const mech = await insertCatalog({ name: 'Mechanical', description: 'Mechanical engineering simulation labs.', visibility: 'demo_and_institution', depth: 0, sortOrder: 3 });
    const mechFM  = await insertCatalog({ name: 'Fluid Mechanics',             visibility: 'demo_and_institution', parentId: mech.id, parentPath: mech.path, rootCatalogId: mech.id, depth: 1, sortOrder: 0 });
    const mechFMa = await insertCatalog({ name: 'Fluid Machanery',             visibility: 'demo_and_institution', parentId: mech.id, parentPath: mech.path, rootCatalogId: mech.id, depth: 1, sortOrder: 1 });
    const mechTh  = await insertCatalog({ name: 'Thermodynamics',              visibility: 'demo_and_institution', parentId: mech.id, parentPath: mech.path, rootCatalogId: mech.id, depth: 1, sortOrder: 2 });
    const mechRef = await insertCatalog({ name: 'Refrigeration & Air Conditioning', visibility: 'demo_and_institution', parentId: mech.id, parentPath: mech.path, rootCatalogId: mech.id, depth: 1, sortOrder: 3 });
    await insertCatalog({ name: 'Heat Transfer',          visibility: 'demo_and_institution', parentId: mech.id, parentPath: mech.path, rootCatalogId: mech.id, depth: 1, sortOrder: 4 });
    await insertCatalog({ name: 'Mechanical Maintenance', visibility: 'demo_and_institution', parentId: mech.id, parentPath: mech.path, rootCatalogId: mech.id, depth: 1, sortOrder: 5 });
    await insertCatalog({ name: 'Material testing',       visibility: 'demo_and_institution', parentId: mech.id, parentPath: mech.path, rootCatalogId: mech.id, depth: 1, sortOrder: 6 });
    const mechEng = await insertCatalog({ name: 'Mechanical engineering',      visibility: 'demo_and_institution', parentId: mech.id, parentPath: mech.path, rootCatalogId: mech.id, depth: 1, sortOrder: 7 });
    await insertCatalog({ name: 'Statics',    visibility: 'demo_and_institution', parentId: mechEng.id, parentPath: mechEng.path, rootCatalogId: mech.id, depth: 2, sortOrder: 0 });
    await insertCatalog({ name: 'Dynamics',   visibility: 'demo_and_institution', parentId: mechEng.id, parentPath: mechEng.path, rootCatalogId: mech.id, depth: 2, sortOrder: 1 });
    await insertCatalog({ name: 'Vibrations', visibility: 'demo_and_institution', parentId: mechEng.id, parentPath: mechEng.path, rootCatalogId: mech.id, depth: 2, sortOrder: 2 });

    await addSimToCat(mechFM.id,  simIds.fluidMechanics);
    await addSimToCat(mechFMa.id, simIds.pumpPerformance);
    await addSimToCat(mechTh.id,  simIds.thermodynamics);
    await addSimToCat(mechRef.id, simIds.refrigeration);
    await assignToInst(institutionId, mech.id);

    // ── Root 5: Calibration — institution ─────────────────────────────────────

    const calib = await insertCatalog({ name: 'Calibration', description: 'Precision calibration and measurement simulations.', visibility: 'institution', depth: 0, sortOrder: 4 });
    await insertCatalog({ name: 'Calibration Workbenches',               visibility: 'institution', parentId: calib.id, parentPath: calib.path, rootCatalogId: calib.id, depth: 1, sortOrder: 0 });
    await insertCatalog({ name: 'Electrical Test & Measurement Benches', visibility: 'institution', parentId: calib.id, parentPath: calib.path, rootCatalogId: calib.id, depth: 1, sortOrder: 1 });
    await assignToInst(institutionId, calib.id);

    // ── Root 6: Electrical — institution ──────────────────────────────────────

    const elec = await insertCatalog({ name: 'Electrical', description: 'Electrical engineering simulation labs.', visibility: 'institution', depth: 0, sortOrder: 5 });
    const elecMach = await insertCatalog({ name: 'Electrical Machines & Transformer Lab',    visibility: 'institution', parentId: elec.id, parentPath: elec.path, rootCatalogId: elec.id, depth: 1, sortOrder: 0 });
    const elecPE   = await insertCatalog({ name: 'Power Electronics',                         visibility: 'institution', parentId: elec.id, parentPath: elec.path, rootCatalogId: elec.id, depth: 1, sortOrder: 1 });
    await insertCatalog({ name: 'Power System & Protection',                visibility: 'institution', parentId: elec.id, parentPath: elec.path, rootCatalogId: elec.id, depth: 1, sortOrder: 2 });
    await insertCatalog({ name: 'Electrical Installation',                  visibility: 'institution', parentId: elec.id, parentPath: elec.path, rootCatalogId: elec.id, depth: 1, sortOrder: 3 });
    await insertCatalog({ name: 'Electrical Installation Workbench',        visibility: 'institution', parentId: elec.id, parentPath: elec.path, rootCatalogId: elec.id, depth: 1, sortOrder: 4 });
    await insertCatalog({ name: 'Electrical Maintenance & Troubleshooting', visibility: 'institution', parentId: elec.id, parentPath: elec.path, rootCatalogId: elec.id, depth: 1, sortOrder: 5 });

    await addSimToCat(elecMach.id, simIds.electricalMachines);
    await addSimToCat(elecMach.id, simIds.circuitAnalysis);
    await addSimToCat(elecPE.id,   simIds.powerElectronics);
    await assignToInst(institutionId,     elec.id);
    await assignToInst(testInstitutionId, elec.id);

    // ── Root 7: Renewable Energy Laboratory — demo_public ─────────────────────

    await insertCatalog({ name: 'Renewable Energy Laboratory', description: 'Renewable energy system simulations.', visibility: 'demo_public', depth: 0, sortOrder: 6 });

    // ── Root 8: Automotive — institution ──────────────────────────────────────

    const auto = await insertCatalog({ name: 'Automotive', description: 'Automotive systems and vehicle technology.', visibility: 'institution', depth: 0, sortOrder: 7 });
    const autoEng = await insertCatalog({ name: 'Engine Systems',              visibility: 'institution', parentId: auto.id, parentPath: auto.path, rootCatalogId: auto.id, depth: 1, sortOrder: 0 });
    await insertCatalog({ name: 'Brake, Suspension',             visibility: 'institution', parentId: auto.id, parentPath: auto.path, rootCatalogId: auto.id, depth: 1, sortOrder: 1 });
    await insertCatalog({ name: 'Electrical System',             visibility: 'institution', parentId: auto.id, parentPath: auto.path, rootCatalogId: auto.id, depth: 1, sortOrder: 2 });
    await insertCatalog({ name: 'Hybrid',                        visibility: 'institution', parentId: auto.id, parentPath: auto.path, rootCatalogId: auto.id, depth: 1, sortOrder: 3 });
    await insertCatalog({ name: 'Autotronics',                   visibility: 'institution', parentId: auto.id, parentPath: auto.path, rootCatalogId: auto.id, depth: 1, sortOrder: 4 });
    await insertCatalog({ name: 'Air Conditioning',              visibility: 'institution', parentId: auto.id, parentPath: auto.path, rootCatalogId: auto.id, depth: 1, sortOrder: 5 });
    await insertCatalog({ name: 'Engines',                       visibility: 'institution', parentId: auto.id, parentPath: auto.path, rootCatalogId: auto.id, depth: 1, sortOrder: 6 });
    await insertCatalog({ name: 'Drive, Power & Transmission',   visibility: 'institution', parentId: auto.id, parentPath: auto.path, rootCatalogId: auto.id, depth: 1, sortOrder: 7 });
    await insertCatalog({ name: 'Compele Vehicle Cutaway',       visibility: 'institution', parentId: auto.id, parentPath: auto.path, rootCatalogId: auto.id, depth: 1, sortOrder: 8 });
    await insertCatalog({ name: 'Workshop Equipment',            visibility: 'institution', parentId: auto.id, parentPath: auto.path, rootCatalogId: auto.id, depth: 1, sortOrder: 9 });
    await insertCatalog({ name: 'Electrical Vehicles',           visibility: 'institution', parentId: auto.id, parentPath: auto.path, rootCatalogId: auto.id, depth: 1, sortOrder: 10 });

    await addSimToCat(autoEng.id, simIds.engineSystems);
    await assignToInst(institutionId, auto.id);

    // ── Root 9: Stem Education — demo_public (standalone, no sims) ────────────

    await insertCatalog({ name: 'Stem Education', description: 'STEM education overview.', visibility: 'demo_public', depth: 0, sortOrder: 8 });

    // ── Root 10: Physics — demo_public ────────────────────────────────────────

    const phys = await insertCatalog({ name: 'Physics', description: 'Physics simulation labs.', visibility: 'demo_public', depth: 0, sortOrder: 9 });
    const physMech   = await insertCatalog({ name: 'Mechanics',            visibility: 'demo_public', parentId: phys.id, parentPath: phys.path, rootCatalogId: phys.id, depth: 1, sortOrder: 0 });
    await insertCatalog({ name: 'Electricity & Magnitisime', visibility: 'demo_public', parentId: phys.id, parentPath: phys.path, rootCatalogId: phys.id, depth: 1, sortOrder: 1 });
    await insertCatalog({ name: 'Modern Physics',            visibility: 'demo_public', parentId: phys.id, parentPath: phys.path, rootCatalogId: phys.id, depth: 1, sortOrder: 2 });
    const physOpt    = await insertCatalog({ name: 'Light & Optics',       visibility: 'demo_public', parentId: phys.id, parentPath: phys.path, rootCatalogId: phys.id, depth: 1, sortOrder: 3 });
    await insertCatalog({ name: 'Thermodynamics',            visibility: 'demo_public', parentId: phys.id, parentPath: phys.path, rootCatalogId: phys.id, depth: 1, sortOrder: 4 });
    await insertCatalog({ name: 'Vibrations And Waves',      visibility: 'demo_public', parentId: phys.id, parentPath: phys.path, rootCatalogId: phys.id, depth: 1, sortOrder: 5 });
    await insertCatalog({ name: 'Atomic & Nuclear',          visibility: 'demo_public', parentId: phys.id, parentPath: phys.path, rootCatalogId: phys.id, depth: 1, sortOrder: 6 });
    await insertCatalog({ name: 'Solid State Physics',       visibility: 'demo_public', parentId: phys.id, parentPath: phys.path, rootCatalogId: phys.id, depth: 1, sortOrder: 7 });
    await insertCatalog({ name: 'Heat',                      visibility: 'demo_public', parentId: phys.id, parentPath: phys.path, rootCatalogId: phys.id, depth: 1, sortOrder: 8 });

    await addSimToCat(physMech.id, simIds.physicsMechanics);
    await addSimToCat(physOpt.id,  simIds.lightOptics);

    // ── Root 11: Computer Science & AI — demo_and_institution ──────────────────

    const csai = await insertCatalog({ name: 'Computer Science & AI', description: 'AI, IoT and networking simulations.', visibility: 'demo_and_institution', depth: 0, sortOrder: 10 });
    const csaiAI  = await insertCatalog({ name: 'AI',       visibility: 'demo_and_institution', parentId: csai.id, parentPath: csai.path, rootCatalogId: csai.id, depth: 1, sortOrder: 0 });
    await insertCatalog({ name: 'IOT',      visibility: 'demo_and_institution', parentId: csai.id, parentPath: csai.path, rootCatalogId: csai.id, depth: 1, sortOrder: 1 });
    const csaiNet = await insertCatalog({ name: 'Networks', visibility: 'demo_and_institution', parentId: csai.id, parentPath: csai.path, rootCatalogId: csai.id, depth: 1, sortOrder: 2 });

    await addSimToCat(csaiAI.id,  simIds.aiLab);
    await addSimToCat(csaiNet.id, simIds.networkSecurity);
    await assignToInst(institutionId,     csai.id);
    await assignToInst(testInstitutionId, csai.id);

    // ── Root 12: Electronics & Communication — institution ─────────────────────

    const ecomm = await insertCatalog({ name: 'Electronics & Communication', description: 'Electronics, communication and embedded systems labs.', visibility: 'institution', depth: 0, sortOrder: 11 });
    const ecommElec = await insertCatalog({ name: 'Electronics',           visibility: 'institution', parentId: ecomm.id, parentPath: ecomm.path, rootCatalogId: ecomm.id, depth: 1, sortOrder: 0 });
    await insertCatalog({ name: 'Communication',          visibility: 'institution', parentId: ecomm.id, parentPath: ecomm.path, rootCatalogId: ecomm.id, depth: 1, sortOrder: 1 });
    await insertCatalog({ name: 'Advanced Communication', visibility: 'institution', parentId: ecomm.id, parentPath: ecomm.path, rootCatalogId: ecomm.id, depth: 1, sortOrder: 2 });
    await insertCatalog({ name: 'Embedded',               visibility: 'institution', parentId: ecomm.id, parentPath: ecomm.path, rootCatalogId: ecomm.id, depth: 1, sortOrder: 3 });

    await addSimToCat(ecommElec.id, simIds.electronicsLab);
    await assignToInst(testInstitutionId, ecomm.id);

    // ── 12. Department → Catalog assignments ──────────────────────────────────

    if (deptIds['ME']) {
      await client.query(`
        INSERT INTO department_simulation_catalogs
          (institution_id, department_id, simulation_catalog_id, assigned_by, include_subtree)
        VALUES ($1,$2,$3,$4,TRUE)
        ON CONFLICT (department_id, simulation_catalog_id)
          DO UPDATE SET include_subtree=TRUE, assigned_by=$4, updated_at=NOW()
      `, [institutionId, deptIds['ME'], mech.id, userIds.admin]);

      await client.query(`
        INSERT INTO user_departments (user_id, department_id, assigned_by)
        VALUES ($1,$2,$3) ON CONFLICT DO NOTHING
      `, [userIds.manager, deptIds['ME'], userIds.admin]);
    }

    if (deptIds['EE']) {
      await client.query(`
        INSERT INTO department_simulation_catalogs
          (institution_id, department_id, simulation_catalog_id, assigned_by, include_subtree)
        VALUES ($1,$2,$3,$4,TRUE)
        ON CONFLICT (department_id, simulation_catalog_id)
          DO UPDATE SET include_subtree=TRUE, assigned_by=$4, updated_at=NOW()
      `, [institutionId, deptIds['EE'], elec.id, userIds.admin]);
    }

    // ── 13. Academic Years & Semester Terms ────────────────────────────────────

    const academicYearIds = {};
    const termIds         = {};

    if (deptIds['ME']) {
      for (let y = 1; y <= 4; y++) {
        const { rows: [ayRow] } = await client.query(`
          INSERT INTO academic_years (institution_id, department_id, name, code, year_order, status, created_by)
          VALUES ($1,$2,$3,$4,$5,'active',$6) ON CONFLICT DO NOTHING RETURNING id
        `, [institutionId, deptIds['ME'], `Academic Year ${y}`, `AY${y}`, y, userIds.admin]);
        const { rows: [ex] } = await client.query(
          `SELECT id FROM academic_years WHERE department_id=$1 AND code=$2 AND deleted_at IS NULL`, [deptIds['ME'], `AY${y}`],
        );
        const ayId = ayRow?.id ?? ex?.id;
        academicYearIds[`ME-AY${y}`] = ayId;
        for (let s = 1; s <= 2; s++) {
          const { rows: [stRow] } = await client.query(`
            INSERT INTO semester_terms (institution_id, department_id, academic_year_id, name, code, term_order, status, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,'active',$7) ON CONFLICT DO NOTHING RETURNING id
          `, [institutionId, deptIds['ME'], ayId, `Semester ${s}`, `S${s}`, s, userIds.admin]);
          const { rows: [exSt] } = await client.query(
            `SELECT id FROM semester_terms WHERE academic_year_id=$1 AND code=$2 AND deleted_at IS NULL`, [ayId, `S${s}`],
          );
          termIds[`ME-AY${y}-S${s}`] = stRow?.id ?? exSt?.id;
        }
      }
    }

    if (deptIds['EE']) {
      for (let y = 1; y <= 2; y++) {
        const { rows: [ayRow] } = await client.query(`
          INSERT INTO academic_years (institution_id, department_id, name, code, year_order, status, created_by)
          VALUES ($1,$2,$3,$4,$5,'active',$6) ON CONFLICT DO NOTHING RETURNING id
        `, [institutionId, deptIds['EE'], `Academic Year ${y}`, `AY${y}`, y, userIds.admin]);
        const { rows: [ex] } = await client.query(
          `SELECT id FROM academic_years WHERE department_id=$1 AND code=$2 AND deleted_at IS NULL`, [deptIds['EE'], `AY${y}`],
        );
        const ayId = ayRow?.id ?? ex?.id;
        academicYearIds[`EE-AY${y}`] = ayId;
        for (let s = 1; s <= 2; s++) {
          const { rows: [stRow] } = await client.query(`
            INSERT INTO semester_terms (institution_id, department_id, academic_year_id, name, code, term_order, status, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,'active',$7) ON CONFLICT DO NOTHING RETURNING id
          `, [institutionId, deptIds['EE'], ayId, `Semester ${s}`, `S${s}`, s, userIds.admin]);
          const { rows: [exSt] } = await client.query(
            `SELECT id FROM semester_terms WHERE academic_year_id=$1 AND code=$2 AND deleted_at IS NULL`, [ayId, `S${s}`],
          );
          termIds[`EE-AY${y}-S${s}`] = stRow?.id ?? exSt?.id;
        }
      }
    }

    const meAy1S1 = termIds['ME-AY1-S1'];
    const meAy1S2 = termIds['ME-AY1-S2'];
    const eeAy1S1 = termIds['EE-AY1-S1'];

    // ── 13b. User academic assignments ────────────────────────────────────────

    await client.query(`DELETE FROM user_academic_assignments WHERE role_context != 'student'`);

    if (deptIds['ME'] && academicYearIds['ME-AY1'] && meAy1S1) {
      await client.query(`UPDATE user_academic_assignments SET is_current=FALSE, updated_at=NOW() WHERE user_id=$1 AND role_context='student' AND is_current=TRUE`, [userIds.student1]);
      await client.query(`
        INSERT INTO user_academic_assignments
          (user_id, institution_id, department_id, academic_year_id, semester_term_id, role_context, is_current, assigned_by)
        VALUES ($1,$2,$3,$4,$5,'student',TRUE,$6)
        ON CONFLICT (user_id, department_id, academic_year_id, semester_term_id, role_context) DO UPDATE SET is_current=TRUE, updated_at=NOW()
      `, [userIds.student1, institutionId, deptIds['ME'], academicYearIds['ME-AY1'], meAy1S1, userIds.admin]);
    }

    if (deptIds['ME'] && academicYearIds['ME-AY1'] && meAy1S2) {
      await client.query(`UPDATE user_academic_assignments SET is_current=FALSE, updated_at=NOW() WHERE user_id=$1 AND role_context='student' AND is_current=TRUE`, [userIds.student2]);
      await client.query(`
        INSERT INTO user_academic_assignments
          (user_id, institution_id, department_id, academic_year_id, semester_term_id, role_context, is_current, assigned_by)
        VALUES ($1,$2,$3,$4,$5,'student',TRUE,$6)
        ON CONFLICT (user_id, department_id, academic_year_id, semester_term_id, role_context) DO UPDATE SET is_current=TRUE, updated_at=NOW()
      `, [userIds.student2, institutionId, deptIds['ME'], academicYearIds['ME-AY1'], meAy1S2, userIds.admin]);
    }

    // Test University
    const testAcademicYearIds = {};
    const testTermIds         = {};
    if (testDeptId) {
      for (let y = 1; y <= 2; y++) {
        const { rows: [ayRow] } = await client.query(`
          INSERT INTO academic_years (institution_id, department_id, name, code, year_order, status, created_by)
          VALUES ($1,$2,$3,$4,$5,'active',$6) ON CONFLICT DO NOTHING RETURNING id
        `, [testInstitutionId, testDeptId, `Academic Year ${y}`, `AY${y}`, y, userIds.testAdmin]);
        const { rows: [ex] } = await client.query(
          `SELECT id FROM academic_years WHERE department_id=$1 AND code=$2 AND deleted_at IS NULL`, [testDeptId, `AY${y}`],
        );
        const ayId = ayRow?.id ?? ex?.id;
        testAcademicYearIds[`AY${y}`] = ayId;
        for (let s = 1; s <= 2; s++) {
          const { rows: [stRow] } = await client.query(`
            INSERT INTO semester_terms (institution_id, department_id, academic_year_id, name, code, term_order, status, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,'active',$7) ON CONFLICT DO NOTHING RETURNING id
          `, [testInstitutionId, testDeptId, ayId, `Semester ${s}`, `S${s}`, s, userIds.testAdmin]);
          const { rows: [exSt] } = await client.query(
            `SELECT id FROM semester_terms WHERE academic_year_id=$1 AND code=$2 AND deleted_at IS NULL`, [ayId, `S${s}`],
          );
          testTermIds[`AY${y}-S${s}`] = stRow?.id ?? exSt?.id;
        }
      }
    }

    const testAy1S1 = testTermIds['AY1-S1'];
    if (testDeptId && testAcademicYearIds['AY1'] && testAy1S1) {
      await client.query(`UPDATE user_academic_assignments SET is_current=FALSE, updated_at=NOW() WHERE user_id=$1 AND role_context='student' AND is_current=TRUE`, [userIds.student3]);
      await client.query(`
        INSERT INTO user_academic_assignments
          (user_id, institution_id, department_id, academic_year_id, semester_term_id, role_context, is_current, assigned_by)
        VALUES ($1,$2,$3,$4,$5,'student',TRUE,$6)
        ON CONFLICT (user_id, department_id, academic_year_id, semester_term_id, role_context) DO UPDATE SET is_current=TRUE, updated_at=NOW()
      `, [userIds.student3, testInstitutionId, testDeptId, testAcademicYearIds['AY1'], testAy1S1, userIds.testAdmin]);
    }

    // ── 14. Dept courses (ME101 + EE101) ──────────────────────────────────────

    const { rows: [courseME] } = await client.query(`
      INSERT INTO courses
        (institution_id, department_id, academic_year_id, semester_term_id, term_id, instructor_id,
         code, title, description, status, enrollment_type, start_date, end_date,
         passing_grade, settings, published_at, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,'ME101','Fluid Mechanics',
        'Fundamentals of fluid flow: continuity, Bernoulli, pipe systems, and pump selection.',
        'published','open','2026-09-01','2026-12-20',70,'{}', $7,$6)
      ON CONFLICT (institution_id, code) DO UPDATE SET
        title=EXCLUDED.title, department_id=EXCLUDED.department_id,
        academic_year_id=EXCLUDED.academic_year_id, semester_term_id=EXCLUDED.semester_term_id,
        updated_at=NOW()
      RETURNING id
    `, [institutionId, deptIds['ME']??null, academicYearIds['ME-AY1']??null, meAy1S1??null, termId, userIds.instructor, twoDays]);

    const { rows: [courseEE] } = await client.query(`
      INSERT INTO courses
        (institution_id, department_id, academic_year_id, semester_term_id, term_id, instructor_id,
         code, title, description, status, enrollment_type, start_date, end_date,
         passing_grade, settings, published_at, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,'EE101','Circuit Theory',
        'DC/AC circuit analysis, Thevenin/Norton theorems, frequency response, and filter design.',
        'published','open','2026-09-01','2026-12-20',70,'{}', $7,$6)
      ON CONFLICT (institution_id, code) DO UPDATE SET
        title=EXCLUDED.title, department_id=EXCLUDED.department_id,
        academic_year_id=EXCLUDED.academic_year_id, semester_term_id=EXCLUDED.semester_term_id,
        updated_at=NOW()
      RETURNING id
    `, [institutionId, deptIds['EE']??null, academicYearIds['EE-AY1']??null, eeAy1S1??null, termId, userIds.instructor, twoDays]);

    if (courseME?.id) {
      await client.query(`
        INSERT INTO enrollments (course_id, user_id, role, status)
        VALUES ($1,$2,'student','active')
        ON CONFLICT (course_id, user_id) DO UPDATE SET status='active'
      `, [courseME.id, userIds.student1]);
    }

    // ── 15. Modules & Lessons ─────────────────────────────────────────────────

    const legacyTypeMap = { rich_text: 'text', video: 'video', file: 'file', url: 'url', scorm: 'scorm' };

    async function upsertModule(cId, { title, description, position, isPublished }) {
      const { rows: [ex] } = await client.query(`SELECT id FROM course_modules WHERE course_id=$1 AND title=$2 LIMIT 1`, [cId, title]);
      if (ex) return ex.id;
      const { rows: [m] } = await client.query(`
        INSERT INTO course_modules (course_id, title, description, position, is_published)
        VALUES ($1,$2,$3,$4,$5) RETURNING id
      `, [cId, title, description??null, position, isPublished??false]);
      return m.id;
    }

    async function upsertLesson(modId, cId, instId, deptId, { title, lessonMode, contentType, content, simulationId, position, estimatedMinutes, isRequired, isPublished }) {
      const { rows: [ex] } = await client.query(`SELECT id FROM lessons WHERE module_id=$1 AND title=$2 LIMIT 1`, [modId, title]);
      if (ex) {
        await client.query(`UPDATE lessons SET lesson_mode=$1, content_type=$2, course_id=$3, institution_id=$4, department_id=$5, updated_at=NOW() WHERE id=$6 AND (lesson_mode IS NULL OR course_id IS NULL)`,
          [lessonMode, contentType??null, cId, instId, deptId??null, ex.id]);
        return ex.id;
      }
      const legacyType  = lessonMode === 'simulation' ? 'simulation' : (legacyTypeMap[contentType] ?? 'text');
      const resolvedSim = ['simulation','content_and_simulation'].includes(lessonMode) ? (simulationId??null) : null;
      const { rows: [l] } = await client.query(`
        INSERT INTO lessons (module_id, title, type, lesson_mode, content_type, content, simulation_id, course_id, institution_id, department_id, position, estimated_minutes, is_required, is_published)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id
      `, [modId, title, legacyType, lessonMode, contentType??null, JSON.stringify(content??{}), resolvedSim, cId, instId, deptId??null, position, estimatedMinutes??null, isRequired??true, isPublished??false]);
      return l.id;
    }

    // ME101 — Fluid Mechanics
    if (courseME?.id) {
      const meDept = deptIds['ME'] ?? null;
      const m1 = await upsertModule(courseME.id, { title: 'Fluid Properties & Flow Fundamentals', position: 0, isPublished: true, description: 'Core properties of fluids and classification of flow regimes.' });
      await upsertLesson(m1, courseME.id, institutionId, meDept, { title: 'Introduction to Fluid Mechanics', lessonMode: 'content', contentType: 'rich_text', content: { body: '<h2>What is Fluid Mechanics?</h2><p>Fluid mechanics underpins pump selection, pipe sizing, and hydraulic system design.</p>' }, position: 0, estimatedMinutes: 15, isRequired: true, isPublished: true });
      await upsertLesson(m1, courseME.id, institutionId, meDept, { title: 'Types of Fluid Flow', lessonMode: 'content', contentType: 'video', content: { url: 'https://www.youtube.com/embed/example-fluid-flow', duration_sec: 720 }, position: 1, estimatedMinutes: 12, isRequired: true, isPublished: true });
      const m2 = await upsertModule(courseME.id, { title: 'Pipe Systems & Pump Selection', position: 1, isPublished: true, description: "Apply Bernoulli's equation and select pumps for given duty points." });
      await upsertLesson(m2, courseME.id, institutionId, meDept, { title: "Bernoulli's Equation — Theory", lessonMode: 'content', contentType: 'rich_text', content: { body: '<h2>Bernoulli Equation</h2><p>P₁ + ½ρv₁² + ρgh₁ = P₂ + ½ρv₂² + ρgh₂</p>' }, position: 0, estimatedMinutes: 20, isRequired: true, isPublished: true });
      await upsertLesson(m2, courseME.id, institutionId, meDept, { title: 'Pump Performance Lab', lessonMode: 'content_and_simulation', contentType: 'rich_text', content: { body: '<h2>Pre-Lab</h2><p>Select and configure a pump to meet the duty requirements.</p>' }, simulationId: simIds.pumpPerformance, position: 1, estimatedMinutes: 40, isRequired: true, isPublished: true });
      const m3 = await upsertModule(courseME.id, { title: 'Fluid Mechanics Simulation', position: 2, isPublished: true, description: 'Interactive fluid simulation.' });
      await upsertLesson(m3, courseME.id, institutionId, meDept, { title: 'Fluid Mechanics Virtual Lab', lessonMode: 'simulation', simulationId: simIds.fluidMechanics, content: {}, position: 0, estimatedMinutes: 40, isRequired: true, isPublished: true });
    }

    // EE101 — Circuit Theory
    if (courseEE?.id) {
      const eeDept = deptIds['EE'] ?? null;
      const em1 = await upsertModule(courseEE.id, { title: 'DC Circuit Fundamentals', position: 0, isPublished: true, description: "Ohm's law, KVL, KCL, and Thevenin/Norton equivalents." });
      await upsertLesson(em1, courseEE.id, institutionId, eeDept, { title: "Ohm's Law & Kirchhoff's Laws", lessonMode: 'content', contentType: 'rich_text', content: { body: '<h2>V = IR</h2><p>KVL: sum of voltages around any loop = 0. KCL: sum of currents at any node = 0.</p>' }, position: 0, estimatedMinutes: 20, isRequired: true, isPublished: true });
      await upsertLesson(em1, courseEE.id, institutionId, eeDept, { title: 'Thevenin & Norton Equivalents', lessonMode: 'content', contentType: 'rich_text', content: { body: "<h2>Thevenin's Theorem</h2><p>Any linear circuit reduces to V_th + R_th.</p>" }, position: 1, estimatedMinutes: 25, isRequired: true, isPublished: true });
      const em2 = await upsertModule(courseEE.id, { title: 'Circuit Analysis Lab', position: 1, isPublished: true, description: 'Hands-on circuit simulation exercises.' });
      await upsertLesson(em2, courseEE.id, institutionId, eeDept, { title: 'Circuit Analysis Interactive Lab', lessonMode: 'content_and_simulation', contentType: 'rich_text', content: { body: '<h2>Lab Instructions</h2><p>Build the circuit, apply node-voltage analysis, verify with the simulator.</p>' }, simulationId: simIds.circuitAnalysis, position: 0, estimatedMinutes: 50, isRequired: true, isPublished: true });
      await upsertLesson(em2, courseEE.id, institutionId, eeDept, { title: 'Electrical Machines Lab', lessonMode: 'simulation', simulationId: simIds.electricalMachines, content: {}, position: 1, estimatedMinutes: 45, isRequired: true, isPublished: true });
    }

    // SEC101 — Network Security
    if (courseIds.networkSecurity) {
      const nsDept = deptIds['CS'] ?? null;
      const nm1 = await upsertModule(courseIds.networkSecurity, { title: 'Network Foundations', position: 0, isPublished: true, description: 'TCP/IP model, protocols, and network devices.' });
      await upsertLesson(nm1, courseIds.networkSecurity, institutionId, nsDept, { title: 'TCP/IP Model Overview', lessonMode: 'content', contentType: 'rich_text', content: { body: '<h2>TCP/IP Stack</h2><p>Layer 7: HTTP/DNS. Layer 4: TCP/UDP. Layer 3: IP routing. Layer 2: MAC/VLANs.</p>' }, position: 0, estimatedMinutes: 15, isRequired: true, isPublished: true });
      await upsertLesson(nm1, courseIds.networkSecurity, institutionId, nsDept, { title: 'Firewall Concepts — Video', lessonMode: 'content', contentType: 'video', content: { url: 'https://www.youtube.com/embed/example-firewall', duration_sec: 1020 }, position: 1, estimatedMinutes: 17, isRequired: false, isPublished: true });
      const nm2 = await upsertModule(courseIds.networkSecurity, { title: 'Hands-On Security Labs', position: 1, isPublished: true, description: 'Interactive simulation labs.' });
      await upsertLesson(nm2, courseIds.networkSecurity, institutionId, nsDept, { title: 'Network Security Lab', lessonMode: 'content_and_simulation', contentType: 'rich_text', content: { body: '<h2>Lab Briefing</h2><p>Configure stateful firewall rules and analyse PCAP captures.</p>' }, simulationId: simIds.networkSecurity, position: 0, estimatedMinutes: 40, isRequired: true, isPublished: true });
      await upsertLesson(nm2, courseIds.networkSecurity, institutionId, nsDept, { title: 'AI Fundamentals Lab', lessonMode: 'simulation', simulationId: simIds.aiLab, content: {}, position: 1, estimatedMinutes: 35, isRequired: false, isPublished: true });
    }

    // ── 16. Grade items + grades ──────────────────────────────────────────────

    let gradeItemId = null;
    if (simIds.networkSecurity && courseIds.networkSecurity) {
      const { rows: [gi] } = await client.query(`
        INSERT INTO grade_items (course_id, title, item_type, simulation_id, max_points, weight)
        VALUES ($1,'Network Security Lab','simulation',$2,100,1.0)
        ON CONFLICT DO NOTHING RETURNING id
      `, [courseIds.networkSecurity, simIds.networkSecurity]);
      const { rows: [giRow] } = await client.query(
        `SELECT id FROM grade_items WHERE course_id=$1 AND simulation_id=$2 LIMIT 1`,
        [courseIds.networkSecurity, simIds.networkSecurity],
      );
      gradeItemId = gi?.id ?? giRow?.id;
    }

    if (gradeItemId) {
      await client.query(`
        INSERT INTO grades (grade_item_id, user_id, score, points_possible, is_override, graded_by, graded_at, institution_id)
        VALUES ($1,$2,82,100,FALSE,$3,NOW(),$4)
        ON CONFLICT (grade_item_id, user_id) DO UPDATE SET score=82, graded_at=NOW(), institution_id=$4
      `, [gradeItemId, userIds.student1, userIds.instructor, institutionId]);
    }

    // ── 17. Simulation session ────────────────────────────────────────────────

    if (simIds.networkSecurity) {
      await client.query(`
        INSERT INTO simulation_sessions
          (simulation_id, user_id, course_id, attempt_number, status, score, max_score, active_seconds,
           started_at, completed_at, institution_id)
        VALUES ($1,$2,$3,1,'completed',82,100,1650,
                NOW()-INTERVAL '2 days', NOW()-INTERVAL '2 days'+INTERVAL '28 minutes', $4)
        ON CONFLICT DO NOTHING
      `, [simIds.networkSecurity, userIds.student1, courseIds.networkSecurity, institutionId]);
    }

    // ── 18. Notifications ─────────────────────────────────────────────────────

    await client.query(`
      INSERT INTO notifications (user_id, type, title, body, reference_type, reference_id, institution_id)
      VALUES
        ($1,'enrollment','Welcome to Network Security Basics!',
         'You are now enrolled. Your first module unlocks September 1st.','course',$2,$3),
        ($1,'grade','New grade posted: Network Security Lab',
         'You scored 82/100 on Network Security Lab. Keep it up!','course',$2,$3),
        ($4,'enrollment','Enrollment request submitted',
         'Your request to enroll in Advanced Malware Analysis is pending approval.','course',$5,$3)
      ON CONFLICT DO NOTHING
    `, [userIds.student1, courseIds.networkSecurity, institutionId, userIds.student2, courseIds.malware]);

    await client.query(`
      INSERT INTO notifications (user_id, type, title, body, reference_type, reference_id, institution_id)
      VALUES ($1,'enrollment','Welcome to Cybersecurity!',
              'You are enrolled in Introduction to Cybersecurity at Test University.','course',$2,$3)
      ON CONFLICT DO NOTHING
    `, [userIds.student3, testCourseId, testInstitutionId]);

    // ── 19. Institution settings ──────────────────────────────────────────────

    await client.query(`
      INSERT INTO settings (institution_id, key, value, description) VALUES
        ($1,'notifications.email_enabled','true','Send email notifications'),
        ($1,'courses.enrollment_type_default','"open"','Default enrollment type for new courses')
      ON CONFLICT (institution_id, key) DO NOTHING
    `, [institutionId]);

    await client.query(`
      INSERT INTO settings (institution_id, key, value, description) VALUES
        ($1,'notifications.email_enabled','true','Send email notifications')
      ON CONFLICT (institution_id, key) DO NOTHING
    `, [testInstitutionId]);

    await client.query('COMMIT');

    // ── Summary ───────────────────────────────────────────────────────────────

    console.log('\n✅  Seed complete (RBAC v2 + Multi-tenant + BEDO Catalog Tree).\n');
    console.log(`Institutions:  Cairo University (${institutionId})  |  Test University (${testInstitutionId})\n`);
    console.log('── Accounts — Cairo University ──────────────────────────────────────────────');
    console.log('  superadmin@cairo-university.edu   / SuperAdmin123!   [super_admin]');
    console.log('  admin@cairo-university.edu         / Admin1234!       [institution_admin]');
    console.log('  deptmanager@cairo-university.edu   / Manager123!      [dept_manager → CS, ME]');
    console.log('  instructor@cairo-university.edu    / Instructor1!     [instructor]');
    console.log('  ta@cairo-university.edu            / Teaching1!       [teaching_assistant]');
    console.log('  student1@cairo-university.edu      / Student123!      [student → ME / AY1 / S1]');
    console.log('  student2@cairo-university.edu      / Student234!      [student → ME / AY1 / S2]');
    console.log('── Accounts — Test University ───────────────────────────────────────────────');
    console.log('  admin@test-university.edu         / TestAdmin1!      [institution_admin]');
    console.log('  instructor@test-university.edu    / TestInstr1!      [instructor]');
    console.log('  student3@test-university.edu      / Student345!      [student → SEC / AY1 / S1]');
    console.log('\n── Simulations (17 total — ALL in BEDO catalog nodes) ───────────────────────');
    console.log('  demo_and_institution (public + institution):');
    console.log(`    PLC Control Systems Lab        ${simIds.plcControl}  → Mechatronics/Control Technology/PLC`);
    console.log(`    Sensor & Actuators Lab         ${simIds.sensorActuators}  → Mechatronics/Control Technology/Sensor`);
    console.log(`    Robotics Programming Lab       ${simIds.robotics}  → Mechatronics/Robotics/Robotics`);
    console.log(`    Fluid Mechanics Lab            ${simIds.fluidMechanics}  → Mechanical/Fluid Mechanics`);
    console.log(`    Thermodynamics Lab             ${simIds.thermodynamics}  → Mechanical/Thermodynamics`);
    console.log(`    Refrigeration & HVAC Lab       ${simIds.refrigeration}  → Mechanical/Refrigeration`);
    console.log(`    Safety Procedures & PPE Lab    ${simIds.safetyProcedures}  → Occupational health/Safety Procedures`);
    console.log(`    AI Fundamentals Lab            ${simIds.aiLab}  → CS & AI/AI`);
    console.log(`    Network Security Lab           ${simIds.networkSecurity}  → CS & AI/Networks`);
    console.log(`    Pump Performance Lab           ${simIds.pumpPerformance}  → Mechanical/Fluid Machanery`);
    console.log('  demo_public (public only):');
    console.log(`    Physics Mechanics Lab          ${simIds.physicsMechanics}  → Physics/Mechanics`);
    console.log(`    Light & Optics Lab             ${simIds.lightOptics}  → Physics/Light & Optics`);
    console.log('  institution (institution-assigned only):');
    console.log(`    Electrical Machines Lab        ${simIds.electricalMachines}  → Electrical/Machines`);
    console.log(`    Power Electronics Lab          ${simIds.powerElectronics}  → Electrical/Power Electronics`);
    console.log(`    Engine Systems Lab             ${simIds.engineSystems}  → Automotive/Engine Systems`);
    console.log(`    Electronics Lab                ${simIds.electronicsLab}  → Electronics & Comm/Electronics`);
    console.log(`    Circuit Analysis Lab           ${simIds.circuitAnalysis}  → Electrical/Machines`);
    console.log('\n── BEDO Catalog Tree (12 roots) ──────────────────────────────────────────────');
    console.log(`  demo_and_institution → Cairo + Test assigned:`);
    console.log(`    Mechatronics  (Control Technology / Robotics & Embedde / Measurements)`);
    console.log(`    Occupational health, security and industrial`);
    console.log(`    Mechanical  (Fluid Mechanics / Fluid Machanery / Thermodynamics / Refrigeration / ...)`);
    console.log(`    Computer Science & AI  (AI / IOT / Networks)`);
    console.log(`  demo_public (public only):`);
    console.log(`    Renewable Energy Laboratory`);
    console.log(`    Stem Education`);
    console.log(`    Physics  (Mechanics / Electricity / Modern Physics / Light & Optics / ...)`);
    console.log(`  institution → assigned institutions:`);
    console.log(`    Civil  → Cairo`);
    console.log(`    Calibration  → Cairo`);
    console.log(`    Electrical  → Cairo + Test`);
    console.log(`    Automotive  → Cairo`);
    console.log(`    Electronics & Communication  → Test`);
    console.log('');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌  Seed failed:', err.message);
    if (process.env.NODE_ENV !== 'test') console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
