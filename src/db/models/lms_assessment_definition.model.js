'use strict';

const { pool } = require('../../config/database');

const DEFINITION_COLS = `
  id, project_id, assessment_version, required_items, grading_rules, legacy_step_map,
  source, created_at, updated_at
`;

const LmsAssessmentDefinitionModel = {
  /** Immutable required-items/grading-rules/legacy-step-map for (projectId, assessmentVersion). */
  async findByProjectAndVersion(projectId, assessmentVersion, db = pool) {
    const { rows } = await db.query(
      `SELECT ${DEFINITION_COLS}
         FROM lms_assessment_definitions
        WHERE project_id = $1 AND assessment_version = $2`,
      [projectId, assessmentVersion],
    );
    return rows[0] ?? null;
  },

  /**
   * Auto-derives a definition from a build's own self-reported projectManifest
   * (release-registration.service.js) rather than a hand-curated migration —
   * `source: 'auto'`. Has no answer keys (a client-reported manifest can't be
   * trusted for correctness), only `grading_rules.questionTypes` for answer-
   * format validation. Idempotent: a race between two students' first events
   * for the same brand-new (projectId, assessmentVersion) resolves to
   * whichever insert wins, the other re-reads it.
   */
  async createAuto({ projectId, assessmentVersion, requiredItems, gradingRules }, db = pool) {
    const { rows } = await db.query(
      `INSERT INTO lms_assessment_definitions
         (project_id, assessment_version, required_items, grading_rules, legacy_step_map, source)
       VALUES ($1, $2, $3, $4, '{}'::jsonb, 'auto')
       ON CONFLICT (project_id, assessment_version) DO NOTHING
       RETURNING ${DEFINITION_COLS}`,
      [projectId, assessmentVersion, JSON.stringify(requiredItems), JSON.stringify(gradingRules ?? {})],
    );
    if (rows[0]) return rows[0];
    return this.findByProjectAndVersion(projectId, assessmentVersion, db);
  },
};

module.exports = LmsAssessmentDefinitionModel;
