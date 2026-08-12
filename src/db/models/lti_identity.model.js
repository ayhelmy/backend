/**
 * LTI identity-mapping model — upsert-on-launch rows for lti_users /
 * lti_contexts / lti_resource_links (migration 057), plus the linking/lookup
 * methods Phase 2/3 provisioning needs (migration 059 grading-config columns).
 */
'use strict';

const { pool } = require('../../config/database');

const LtiIdentityModel = {
  async upsertUser({ platformId, issuer, subject }) {
    const identityKey = `${issuer}::${subject}`;
    const { rows } = await pool.query(
      `INSERT INTO lti_users (platform_id, issuer, subject, identity_key)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (identity_key) DO UPDATE SET last_launch_at = NOW()
       RETURNING *`,
      [platformId, issuer, subject, identityKey],
    );
    return rows[0];
  },

  async upsertContext({ platformId, issuer, contextId, contextLabel, contextTitle, nrpsContextMembershipsUrl }) {
    const identityKey = `${issuer}::${contextId}`;
    const { rows } = await pool.query(
      `INSERT INTO lti_contexts (platform_id, issuer, context_id, context_label, context_title, identity_key, nrps_context_memberships_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (identity_key) DO UPDATE
         SET last_seen_at = NOW(), context_label = EXCLUDED.context_label, context_title = EXCLUDED.context_title,
             nrps_context_memberships_url = COALESCE(EXCLUDED.nrps_context_memberships_url, lti_contexts.nrps_context_memberships_url)
       RETURNING *`,
      [platformId, issuer, contextId, contextLabel ?? null, contextTitle ?? null, identityKey, nrpsContextMembershipsUrl ?? null],
    );
    return rows[0];
  },

  async upsertResourceLink({ platformId, issuer, contextId, resourceLinkId, title }) {
    const identityKey = `${issuer}::${contextId ?? ''}::${resourceLinkId}`;
    const { rows } = await pool.query(
      `INSERT INTO lti_resource_links (platform_id, issuer, context_id, resource_link_id, title, identity_key)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (identity_key) DO UPDATE
         SET last_seen_at = NOW(), title = EXCLUDED.title
       RETURNING *`,
      [platformId, issuer, contextId ?? null, resourceLinkId, title ?? null, identityKey],
    );
    return rows[0];
  },

  // ── Lookups (Phase 2/3 provisioning) ──────────────────────────────────────────

  async findUserByKey(identityKey) {
    const { rows } = await pool.query(`SELECT * FROM lti_users WHERE identity_key = $1`, [identityKey]);
    return rows[0] ?? null;
  },

  async findContextByKey(identityKey) {
    const { rows } = await pool.query(`SELECT * FROM lti_contexts WHERE identity_key = $1`, [identityKey]);
    return rows[0] ?? null;
  },

  async findResourceLinkByKey(identityKey) {
    const { rows } = await pool.query(`SELECT * FROM lti_resource_links WHERE identity_key = $1`, [identityKey]);
    return rows[0] ?? null;
  },

  async findResourceLinkById(id) {
    const { rows } = await pool.query(`SELECT * FROM lti_resource_links WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  // ── Linking (sets the simulearn_*_id FK once provisioned) ─────────────────────

  async linkUser(identityKey, simulearnUserId) {
    const { rows } = await pool.query(
      `UPDATE lti_users SET simulearn_user_id = $2 WHERE identity_key = $1 RETURNING *`,
      [identityKey, simulearnUserId],
    );
    return rows[0] ?? null;
  },

  async linkContext(identityKey, simulearnCourseId) {
    const { rows } = await pool.query(
      `UPDATE lti_contexts SET simulearn_course_id = $2 WHERE identity_key = $1 RETURNING *`,
      [identityKey, simulearnCourseId],
    );
    return rows[0] ?? null;
  },

  /** Also persists the Deep-Linking-configured grading settings + AGS lineitem URL, captured at first real launch. */
  async linkResourceLink(identityKey, { simulearnLessonId, simulationId, lineitemUrl, lineitemsUrl, maxScore, customParams, gradingMode, attemptPolicy, durationLimit }) {
    const { rows } = await pool.query(
      `UPDATE lti_resource_links
          SET simulearn_lesson_id = $2, simulation_id = $3,
              lineitem_url = $4, lineitems_url = $5, max_score = $6,
              custom_params = $7, grading_mode = $8, attempt_policy = $9, duration_limit = $10
        WHERE identity_key = $1
        RETURNING *`,
      [
        identityKey, simulearnLessonId ?? null, simulationId ?? null,
        lineitemUrl ?? null, lineitemsUrl ?? null, maxScore ?? 100,
        JSON.stringify(customParams ?? {}), gradingMode ?? 'score_and_completion',
        attemptPolicy ?? 'best', durationLimit ?? null,
      ],
    );
    return rows[0] ?? null;
  },

  /** Reverse lookup used by AGS sync: what's the LMS-side subject for this internal user on this platform? */
  async findUserBySimuLearnUserId(simulearnUserId, platformId) {
    const { rows } = await pool.query(
      `SELECT * FROM lti_users WHERE simulearn_user_id = $1 AND platform_id = $2 LIMIT 1`,
      [simulearnUserId, platformId],
    );
    return rows[0] ?? null;
  },

  /** Reverse lookup used by AGS sync: which lti_resource_link (if any) does this course+lesson correspond to? */
  async findResourceLinkByCourseAndLesson(courseId, lessonId) {
    const { rows } = await pool.query(
      `SELECT rl.*
         FROM lti_resource_links rl
         JOIN lti_contexts ctx ON ctx.platform_id = rl.platform_id AND ctx.issuer = rl.issuer AND ctx.context_id = rl.context_id
        WHERE ctx.simulearn_course_id = $1 AND rl.simulearn_lesson_id = $2
        LIMIT 1`,
      [courseId, lessonId],
    );
    return rows[0] ?? null;
  },

  /** Reverse lookup used by NRPS sync: which lti_context (if any) does this SimuLearn course correspond to? */
  async findContextBySimuLearnCourseId(courseId) {
    const { rows } = await pool.query(
      `SELECT * FROM lti_contexts WHERE simulearn_course_id = $1 LIMIT 1`,
      [courseId],
    );
    return rows[0] ?? null;
  },

  async touchNrpsSynced(contextId) {
    await pool.query(`UPDATE lti_contexts SET nrps_last_synced_at = NOW() WHERE id = $1`, [contextId]);
  },
};

module.exports = LtiIdentityModel;
