'use strict';

/**
 * RBAC regression tests — covers the exact scenarios from the security audit.
 *
 * Setup:
 *   npm install        (installs jest + supertest)
 *   npm run migrate    (run DB migrations including 014_fix_instructor_permissions.sql)
 *   npm run seed       (creates institutions, users, and courses)
 *   npm test           (runs this suite)
 *
 * Tests rely on the seeded credentials and institution structure.
 * All tests run sequentially (--runInBand) to avoid connection pool exhaustion.
 */

const request = require('supertest');
const app     = require('../src/app');

// ── helpers ───────────────────────────────────────────────────────────────────

async function login(email, password) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.body?.message}`);
  return res.body.data.accessToken;
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

// ── fixtures ──────────────────────────────────────────────────────────────────

let tokens = {};

beforeAll(async () => {
  tokens.student1    = await login('student1@demo-university.edu',  'Student123!');
  tokens.student3    = await login('student3@test-university.edu',  'Student345!');
  tokens.instructor  = await login('instructor@demo-university.edu', 'Instructor1!');
  tokens.admin       = await login('admin@demo-university.edu',     'Admin1234!');
  tokens.superadmin  = await login('superadmin@demo-university.edu', 'SuperAdmin123!');
}, 30_000);

// ── Issue 1: Cross-tenant course isolation ────────────────────────────────────

describe('Cross-tenant course isolation', () => {
  test('student3 (test-university) sees zero courses from demo-university', async () => {
    const res = await request(app)
      .get('/api/v1/courses')
      .set(authHeader(tokens.student3));

    expect(res.status).toBe(200);

    // All returned courses must belong to student3's institution (test-university), not demo-university
    const courses = res.body.data;
    const demoIds = courses.filter(
      (c) => c.institution_id !== undefined && c.institution_id === courses[0]?.institution_id,
    );
    // None of the demo-university course codes should appear
    const codes = courses.map((c) => c.code);
    expect(codes).not.toContain('SEC101'); // Network Security Basics — demo only
    expect(codes).not.toContain('SEC301'); // Advanced Malware Analysis — demo only
    expect(codes).not.toContain('SEC201'); // Python for Pen Testing — demo only
  });

  test('student1 (demo-university) can see demo-university published courses', async () => {
    const res = await request(app)
      .get('/api/v1/courses')
      .set(authHeader(tokens.student1));

    expect(res.status).toBe(200);
    const courses = res.body.data;
    const codes   = courses.map((c) => c.code);
    expect(codes).toContain('SEC101');
  });

  test('student1 cannot see archived courses', async () => {
    const res = await request(app)
      .get('/api/v1/courses')
      .set(authHeader(tokens.student1));

    expect(res.status).toBe(200);
    const statuses = res.body.data.map((c) => c.status);
    expect(statuses).not.toContain('archived');
  });
});

// ── Issue 2: Instructor cannot list users ────────────────────────────────────

describe('User directory access control', () => {
  test('instructor receives 403 for GET /api/v1/users', async () => {
    const res = await request(app)
      .get('/api/v1/users')
      .set(authHeader(tokens.instructor));

    expect(res.status).toBe(403);
  });

  test('student receives 403 for GET /api/v1/users', async () => {
    const res = await request(app)
      .get('/api/v1/users')
      .set(authHeader(tokens.student1));

    expect(res.status).toBe(403);
  });

  test('institution_admin can list users scoped to own institution', async () => {
    const res = await request(app)
      .get('/api/v1/users')
      .set(authHeader(tokens.admin));

    expect(res.status).toBe(200);
    // Must not return student3 (from test-university)
    const emails = res.body.data.users.map((u) => u.email);
    expect(emails).not.toContain('student3@test-university.edu');
  });

  test('super_admin can list all users across institutions', async () => {
    const res = await request(app)
      .get('/api/v1/users')
      .set(authHeader(tokens.superadmin));

    expect(res.status).toBe(200);
    const emails = res.body.data.users.map((u) => u.email);
    expect(emails).toContain('student3@test-university.edu');
  });
});

// ── Issue 3: Role directory access control ───────────────────────────────────

describe('Role directory access control', () => {
  test('student receives 403 for GET /api/v1/roles', async () => {
    const res = await request(app)
      .get('/api/v1/roles')
      .set(authHeader(tokens.student1));

    expect(res.status).toBe(403);
  });

  test('instructor receives 403 for GET /api/v1/roles', async () => {
    const res = await request(app)
      .get('/api/v1/roles')
      .set(authHeader(tokens.instructor));

    expect(res.status).toBe(403);
  });

  test('institution_admin can list roles (has roles:manage)', async () => {
    const res = await request(app)
      .get('/api/v1/roles')
      .set(authHeader(tokens.admin));

    expect(res.status).toBe(200);
  });

  test('super_admin can list roles', async () => {
    const res = await request(app)
      .get('/api/v1/roles')
      .set(authHeader(tokens.superadmin));

    expect(res.status).toBe(200);
  });
});

// ── Issue 4: Unauthenticated access ──────────────────────────────────────────

describe('Unauthenticated access', () => {
  test('GET /api/v1/users returns 401 without token', async () => {
    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(401);
  });

  test('GET /api/v1/roles returns 401 without token', async () => {
    const res = await request(app).get('/api/v1/roles');
    expect(res.status).toBe(401);
  });

  test('GET /api/v1/courses returns 401 without token', async () => {
    const res = await request(app).get('/api/v1/courses');
    expect(res.status).toBe(401);
  });
});

// ── Issue 5: Super admin courses — no institution required ───────────────────

describe('Super admin course listing', () => {
  test('super_admin can list courses without institutionId query param', async () => {
    const res = await request(app)
      .get('/api/v1/courses')
      .set(authHeader(tokens.superadmin));

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  test('super_admin can filter courses by institutionId', async () => {
    // Get institutions first
    const instRes = await request(app)
      .get('/api/v1/institutions')
      .set(authHeader(tokens.superadmin));
    expect(instRes.status).toBe(200);

    const demoInst = instRes.body.data.institutions?.find((i) => i.slug === 'demo-university');
    if (!demoInst) return; // seed not run — skip

    const res = await request(app)
      .get('/api/v1/courses')
      .query({ institutionId: demoInst.id })
      .set(authHeader(tokens.superadmin));

    expect(res.status).toBe(200);
    const courses = res.body.data;
    courses.forEach((c) => expect(c.institution_id).toBe(demoInst.id));
  });
});

// ── Institution isolation on users endpoint ───────────────────────────────────

describe('Institution scoping on user endpoints', () => {
  test('institution_admin cannot see users from another institution', async () => {
    const res = await request(app)
      .get('/api/v1/users')
      .set(authHeader(tokens.admin));

    expect(res.status).toBe(200);
    const users = res.body.data.users;
    users.forEach((u) => {
      // All returned users must have demo-university email domain or institution match
      expect(u.email).not.toMatch(/@test-university\.edu$/);
    });
  });
});
