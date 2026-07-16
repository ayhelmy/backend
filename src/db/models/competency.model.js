/**
 * Competency model — learning outcome framework.
 * SRS §4.10 COMP-01 – COMP-05; §13.4 proficiency levels.
 * Proficiency: not_yet(<40%), developing(40–69%), proficient(70–89%), mastered(≥90%)
 */
'use strict';

const { pool } = require('../../config/database');

const PROFICIENCY_THRESHOLDS = [
  { level: 'mastered',    min: 90 },
  { level: 'proficient',  min: 70 },
  { level: 'developing',  min: 40 },
  { level: 'not_yet',     min: 0  },
];

function scoreToProficiency(scorePct) {
  for (const { level, min } of PROFICIENCY_THRESHOLDS) {
    if (scorePct >= min) return level;
  }
  return 'not_yet';
}

const CompetencyModel = {
  async findById(id) {
    const { rows } = await pool.query(
      `SELECT id, institution_id, code, title, description, parent_id, created_at
         FROM competencies WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async list({ institutionId, limit = 50, offset = 0 } = {}) {
    const params = [limit, offset];
    const filter = institutionId
      ? `WHERE (institution_id = $${params.push(institutionId)} OR institution_id IS NULL)`
      : 'WHERE institution_id IS NULL';
    const { rows } = await pool.query(
      `SELECT id, institution_id, code, title, description, parent_id, created_at
         FROM competencies ${filter}
         ORDER BY code LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },

  async create({ institutionId, code, title, description, parentId }) {
    const { rows } = await pool.query(
      `INSERT INTO competencies (institution_id, code, title, description, parent_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [institutionId ?? null, code, title, description ?? null, parentId ?? null],
    );
    return rows[0];
  },

  // ------------------------------------------------------------------
  // Simulation ↔ competency links
  // ------------------------------------------------------------------

  async getSimulationCompetencies(simulationId) {
    const { rows } = await pool.query(
      `SELECT c.id, c.code, c.title, sc.level
         FROM simulation_competencies sc
         JOIN competencies c ON c.id = sc.competency_id
        WHERE sc.simulation_id = $1`,
      [simulationId],
    );
    return rows;
  },

  async linkSimulationCompetency(simulationId, competencyId, level = 'develops') {
    const { rows } = await pool.query(
      `INSERT INTO simulation_competencies (simulation_id, competency_id, level)
       VALUES ($1,$2,$3)
       ON CONFLICT (simulation_id, competency_id) DO UPDATE SET level = EXCLUDED.level
       RETURNING *`,
      [simulationId, competencyId, level],
    );
    return rows[0];
  },

  // ------------------------------------------------------------------
  // Student competency achievements
  // ------------------------------------------------------------------

  async getStudentCompetencies(userId, { institutionId } = {}) {
    const params = [userId];
    const filter = institutionId
      ? `AND (c.institution_id = $${params.push(institutionId)} OR c.institution_id IS NULL)`
      : '';
    const { rows } = await pool.query(
      `SELECT sc.competency_id, c.code, c.title, sc.proficiency,
              sc.score_pct, sc.evidence_type, sc.evidence_id, sc.achieved_at
         FROM student_competencies sc
         JOIN competencies c ON c.id = sc.competency_id
        WHERE sc.user_id = $1 ${filter}
        ORDER BY c.code`,
      params,
    );
    return rows;
  },

  /** Upsert student competency, computing proficiency from scorePct automatically. */
  async recordAchievement({ userId, competencyId, scorePct, evidenceType, evidenceId }) {
    const proficiency = scoreToProficiency(scorePct);
    const { rows } = await pool.query(
      `INSERT INTO student_competencies
         (user_id, competency_id, proficiency, score_pct, evidence_type, evidence_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, competency_id) DO UPDATE
         SET proficiency   = EXCLUDED.proficiency,
             score_pct     = EXCLUDED.score_pct,
             evidence_type = EXCLUDED.evidence_type,
             evidence_id   = EXCLUDED.evidence_id,
             achieved_at   = NOW(),
             updated_at    = NOW()
       RETURNING *`,
      [userId, competencyId, proficiency, scorePct, evidenceType ?? null, evidenceId ?? null],
    );
    return rows[0];
  },

  scoreToProficiency,
};

module.exports = CompetencyModel;
