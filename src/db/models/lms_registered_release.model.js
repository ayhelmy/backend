'use strict';

const { pool } = require('../../config/database');

const RELEASE_COLS = `
  id, project_id, project_version, assessment_version, manifest, build_url,
  approved_by, approved_at, source, created_at
`;

const LmsRegisteredReleaseModel = {
  /** The approved release for an exact (projectId, projectVersion) — never the "latest". */
  async findByProjectAndVersion(projectId, projectVersion, db = pool) {
    const { rows } = await db.query(
      `SELECT ${RELEASE_COLS}
         FROM lms_registered_releases
        WHERE project_id = $1 AND project_version = $2`,
      [projectId, projectVersion],
    );
    return rows[0] ?? null;
  },

  /**
   * Auto-registers a release from a build's own self-reported projectManifest
   * — `source: 'auto'`, `approved_by: NULL` (no admin ever reviewed this
   * build). Requires a matching lms_assessment_definitions row to already
   * exist (FK) — callers must create/resolve that first. Idempotent, same
   * race-safe pattern as LmsAssessmentDefinitionModel.createAuto.
   */
  async createAuto({ projectId, projectVersion, assessmentVersion, manifest }, db = pool) {
    const { rows } = await db.query(
      `INSERT INTO lms_registered_releases
         (project_id, project_version, assessment_version, manifest, build_url, source)
       VALUES ($1, $2, $3, $4, NULL, 'auto')
       ON CONFLICT (project_id, project_version) DO NOTHING
       RETURNING ${RELEASE_COLS}`,
      [projectId, projectVersion, assessmentVersion, manifest ? JSON.stringify(manifest) : null],
    );
    if (rows[0]) return rows[0];
    return this.findByProjectAndVersion(projectId, projectVersion, db);
  },

  /**
   * Most recent release for a project, preferring one with a non-null
   * manifest — used to build a human-readable experiment/title catalog for
   * the instructor dashboard. Falls back to any release (manifest NULL) so a
   * manually-curated project without a stored manifest (e.g. FM103, migration
   * 065) still resolves to a row, just with no titles to show.
   */
  async findLatestForProject(projectId, db = pool) {
    const { rows } = await db.query(
      `SELECT ${RELEASE_COLS}
         FROM lms_registered_releases
        WHERE project_id = $1
        ORDER BY (manifest IS NOT NULL) DESC, created_at DESC
        LIMIT 1`,
      [projectId],
    );
    return rows[0] ?? null;
  },
};

module.exports = LmsRegisteredReleaseModel;
