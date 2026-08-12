/**
 * Simulation model — query helpers for the simulations catalog.
 * SRS §4.7 SIM-01 – SIM-10; §13 Simulation Learning Features.
 * Migration 029 adds WebGL build fields (launch_type, build_uuid, storage_path, etc.).
 */
'use strict';

const { pool } = require('../../config/database');

const SIM_COLS = `
  id, institution_id, domain_id, title, description,
  type, launch_url, thumbnail_url, estimated_minutes,
  difficulty, max_score, pass_score, max_attempts,
  scoring_config, learning_objectives, status, visibility, version,
  launch_type, build_uuid, original_zip_filename, storage_path,
  public_entry_url, entry_file, build_status, build_validation, file_size_bytes,
  is_featured, featured_order,
  created_by, created_at, updated_at
`;

const SimulationModel = {
  async findById(id) {
    const { rows } = await pool.query(
      `SELECT ${SIM_COLS} FROM simulations WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  },

  /** WebGL build_status rollup (ready/failed/pending) — super_admin system-health KPI. */
  async countByBuildStatus({ institutionId } = {}) {
    const params = [];
    const filters = ["deleted_at IS NULL", "launch_type = 'webgl'"];
    if (institutionId) filters.push(`institution_id = $${params.push(institutionId)}`);
    const { rows } = await pool.query(
      `SELECT build_status, COUNT(*) AS total FROM simulations
        WHERE ${filters.join(' AND ')} GROUP BY build_status`,
      params,
    );
    const byStatus = { ready: 0, failed: 0, processing: 0 };
    rows.forEach((r) => { if (r.build_status) byStatus[r.build_status] = parseInt(r.total, 10); });
    return byStatus;
  },

  async findByBuildUuid(buildUuid) {
    const { rows } = await pool.query(
      `SELECT ${SIM_COLS} FROM simulations WHERE build_uuid = $1 AND deleted_at IS NULL`,
      [buildUuid],
    );
    return rows[0] ?? null;
  },

  async list({ institutionId, domainId, status, type, limit = 20, offset = 0 } = {}) {
    const filters = ['deleted_at IS NULL'];
    const params = [limit, offset];
    if (institutionId) {
      params.push(institutionId);
      filters.push(`(institution_id = $${params.length} OR institution_id IS NULL)`);
    }
    if (domainId) filters.push(`domain_id = $${params.push(domainId)}`);
    if (status)   filters.push(`status = $${params.push(status)}`);
    if (type)     filters.push(`type = $${params.push(type)}`);
    const { rows } = await pool.query(
      `SELECT ${SIM_COLS} FROM simulations
        WHERE ${filters.join(' AND ')}
        ORDER BY title LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },

  async create(data) {
    const {
      institutionId, domainId, title, description, type, launchUrl,
      thumbnailUrl, estimatedMinutes, difficulty, maxScore, passScore,
      maxAttempts, scoringConfig, learningObjectives, version, visibility, createdBy,
    } = data;
    const { rows } = await pool.query(
      `INSERT INTO simulations
         (institution_id, domain_id, title, description, type, launch_url,
          thumbnail_url, estimated_minutes, difficulty, max_score, pass_score,
          max_attempts, scoring_config, learning_objectives, version, visibility, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING ${SIM_COLS}`,
      [institutionId ?? null, domainId ?? null, title, description ?? null,
       type ?? 'webgl', launchUrl ?? null, thumbnailUrl ?? null, estimatedMinutes ?? null,
       difficulty ?? 'intermediate', maxScore ?? 100, passScore ?? 70,
       maxAttempts ?? 3, JSON.stringify(scoringConfig ?? {}),
       learningObjectives ?? [], version ?? '1.0.0',
       visibility ?? 'institution', createdBy],
    );
    return rows[0];
  },

  /** Creates a WebGL simulation record with all build-specific fields. */
  async createWebGL(data) {
    const {
      institutionId, title, description, thumbnailUrl, estimatedMinutes,
      difficulty, visibility, status, createdBy,
      buildUuid, originalZipFilename, storagePath, publicEntryUrl,
      entryFile, buildStatus, buildValidation, fileSizeBytes,
    } = data;

    const { rows } = await pool.query(
      `INSERT INTO simulations
         (institution_id, title, description, thumbnail_url, estimated_minutes,
          difficulty, visibility, status, created_by,
          type, launch_type,
          build_uuid, original_zip_filename, storage_path, public_entry_url,
          entry_file, build_status, build_validation, file_size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
               $9,'webgl','webgl',
               $10,$11,$12,$13,
               $14,$15,$16,$17)
       RETURNING ${SIM_COLS}`,
      [
        institutionId ?? null, title, description ?? null,
        thumbnailUrl ?? null, estimatedMinutes ?? null,
        difficulty ?? 'intermediate', visibility ?? 'institution',
        status ?? 'active', createdBy,
        buildUuid, originalZipFilename ?? null, storagePath,
        publicEntryUrl, entryFile ?? 'index.html',
        buildStatus ?? 'ready',
        buildValidation ? JSON.stringify(buildValidation) : null,
        fileSizeBytes ?? null,
      ],
    );
    return rows[0];
  },

  async update(id, fields) {
    const allowed = [
      'title','description','domain_id','type','launch_url','thumbnail_url',
      'estimated_minutes','difficulty','max_score','pass_score','max_attempts',
      'scoring_config','learning_objectives','status','visibility','version',
      'launch_type','build_status','build_validation','public_entry_url','storage_path',
      'is_featured','featured_order',
    ];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        const val = (key === 'scoring_config' || key === 'build_validation')
          ? JSON.stringify(fields[key])
          : fields[key];
        params.push(val);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (sets.length === 0) return this.findById(id);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE simulations SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} AND deleted_at IS NULL
        RETURNING ${SIM_COLS}`,
      params,
    );
    return rows[0] ?? null;
  },

  async softDelete(id) {
    const { rows } = await pool.query(
      `UPDATE simulations SET deleted_at = NOW(), status = 'deprecated', updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL RETURNING id, build_uuid`,
      [id],
    );
    return rows[0] ?? null;
  },

  async getTags(simulationId) {
    const { rows } = await pool.query(
      `SELECT tag FROM simulation_tags WHERE simulation_id = $1 ORDER BY tag`,
      [simulationId],
    );
    return rows.map((r) => r.tag);
  },

  async setTags(simulationId, tags) {
    await pool.query(`DELETE FROM simulation_tags WHERE simulation_id = $1`, [simulationId]);
    if (!tags.length) return;
    const values = tags.map((t, i) => `($1, $${i + 2})`).join(', ');
    await pool.query(
      `INSERT INTO simulation_tags (simulation_id, tag) VALUES ${values} ON CONFLICT DO NOTHING`,
      [simulationId, ...tags],
    );
  },
};

module.exports = SimulationModel;
