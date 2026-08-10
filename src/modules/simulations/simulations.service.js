'use strict';

/**
 * Simulations service — SRS §4.7 SIM-01 to SIM-10. RBAC v2.
 *
 * Visibility model:
 *   private              — super_admin only
 *   institution          — institutions with an assigned simulation catalog that contains this sim
 *   demo_public          — anyone (including unauthenticated guests)
 *   demo_and_institution — both public guests AND institution users (catalog assignment not required)
 *
 * Scope query (?scope=assigned | ?scope=demo):
 *   assigned — only catalog-assigned simulations for the actor's institution
 *   demo     — only demo_public + demo_and_institution simulations (guests or explicit request)
 */

const { pool }       = require('../../config/database');
const { SimulationModel, SimulationCatalogModel, AuditModel } = require('../../db/models');
const { parsePagination, buildPaginationMeta }                = require('../../utils/pagination');
const ApiError       = require('../../utils/apiError');

// ── Helpers ───────────────────────────────────────────────────────────────────

function assertCanManageGlobal(actor) {
  if (!actor?.permissions?.includes('simulation_catalogs.manage_global')) {
    throw ApiError.forbidden('Missing required permission: simulation_catalogs.manage_global.');
  }
}

function mapSim(row) {
  if (!row) return null;
  return {
    id:                   row.id,
    institutionId:        row.institution_id       ?? null,
    domainId:             row.domain_id            ?? null,
    title:                row.title,
    description:          row.description          ?? null,
    type:                 row.type,
    launchUrl:            row.launch_url           ?? null,
    thumbnailUrl:         row.thumbnail_url        ?? null,
    estimatedMinutes:     row.estimated_minutes    ?? null,
    difficulty:           row.difficulty           ?? 'intermediate',
    maxScore:             row.max_score            ?? 100,
    passScore:            row.pass_score           ?? 70,
    maxAttempts:          row.max_attempts         ?? 3,
    scoringConfig:        row.scoring_config       ?? {},
    learningObjectives:   row.learning_objectives  ?? [],
    status:               row.status,
    visibility:           row.visibility,
    version:              row.version              ?? '1.0.0',
    // WebGL build fields (migration 029)
    launchType:           row.launch_type          ?? null,
    buildUuid:            row.build_uuid           ?? null,
    originalZipFilename:  row.original_zip_filename ?? null,
    storagePath:          row.storage_path         ?? null,
    publicEntryUrl:       row.public_entry_url     ?? null,
    entryFile:            row.entry_file           ?? 'index.html',
    buildStatus:          row.build_status         ?? null,
    buildValidation:      row.build_validation     ?? null,
    fileSizeBytes:        row.file_size_bytes      ?? null,
    createdAt:            row.created_at,
    updatedAt:            row.updated_at           ?? null,
  };
}

/** Builds the absolute WebGL launch URL from stored relative public_entry_url + request origin. */
function resolveWebGLLaunchUrl(sim, req) {
  if (sim.public_entry_url) {
    return `${req.protocol}://${req.get('host')}${sim.public_entry_url}`;
  }
  return null;
}

// ── list ──────────────────────────────────────────────────────────────────────

exports.list = async (query, actor) => {
  const { page, limit, offset } = parsePagination(query);
  const isGuest      = !actor;
  const isSuperAdmin = actor?.roles?.includes('super_admin');
  const scope        = query.scope; // 'assigned' | 'demo' | undefined

  let rows;

  if (isGuest || scope === 'demo') {
    // Guests and explicit demo scope: demo_public + demo_and_institution simulations
    const result = await pool.query(
      `SELECT id, title, description, type, thumbnail_url, estimated_minutes,
              difficulty, visibility, status, version, created_at
         FROM simulations
        WHERE visibility IN ('demo_public', 'demo_and_institution')
          AND status = 'active' AND deleted_at IS NULL
        ORDER BY title
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    rows = result.rows;

  } else if (isSuperAdmin) {
    // Super admin sees everything
    const filters = ['deleted_at IS NULL'];
    const params  = [];
    if (query.status) { params.push(query.status); filters.push(`status = $${params.length}`); }
    if (query.type)   { params.push(query.type);   filters.push(`type = $${params.length}`); }
    if (query.visibility) { params.push(query.visibility); filters.push(`visibility = $${params.length}`); }
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT id, title, description, type, thumbnail_url, estimated_minutes,
              difficulty, visibility, status, version, institution_id,
              launch_type, build_uuid, original_zip_filename, storage_path,
              public_entry_url, entry_file, build_status, build_validation,
              file_size_bytes, created_at
         FROM simulations
        WHERE ${filters.join(' AND ')}
        ORDER BY title
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    rows = result.rows;

  } else {
    // Authenticated non-superadmin: catalog-assigned + demo_public (or assigned-only)
    // Supports: search, difficulty, catalog_id, include_subtree, scope=assigned
    const assignedOnly = query.scope === 'assigned';
    const params       = [actor.institutionId]; // $1 = institution_id

    const whereParts = ['s.deleted_at IS NULL'];

    // Visibility scope
    if (assignedOnly) {
      whereParts.push(
        `(s.visibility IN ('demo_and_institution') OR (
           s.visibility = 'institution' AND EXISTS (
             SELECT 1 FROM simulation_catalog_items sci_v
               JOIN institution_simulation_catalogs isc_v
                 ON isc_v.simulation_catalog_id = sci_v.catalog_id
              WHERE sci_v.simulation_id = s.id AND isc_v.institution_id = $1
           )
         ))`,
      );
    } else {
      whereParts.push(
        `(s.visibility IN ('demo_public', 'demo_and_institution') OR (
           s.visibility = 'institution' AND EXISTS (
             SELECT 1 FROM simulation_catalog_items sci_v
               JOIN institution_simulation_catalogs isc_v
                 ON isc_v.simulation_catalog_id = sci_v.catalog_id
              WHERE sci_v.simulation_id = s.id AND isc_v.institution_id = $1
           )
         ))`,
      );
    }

    // Search
    if (query.search?.trim()) {
      params.push(`%${query.search.trim()}%`);
      whereParts.push(`(s.title ILIKE $${params.length} OR s.description ILIKE $${params.length})`);
    }

    // Difficulty
    if (query.difficulty) {
      params.push(query.difficulty);
      whereParts.push(`s.difficulty = $${params.length}`);
    }

    // Status
    if (query.status) {
      params.push(query.status);
      whereParts.push(`s.status = $${params.length}`);
    }

    // Catalog node filter
    let joinClause = '';
    if (query.catalog_id) {
      if (query.include_subtree === 'true') {
        params.push(query.catalog_id);
        const cidx = params.length;
        joinClause = `JOIN simulation_catalog_items sci_c ON sci_c.simulation_id = s.id
                      JOIN simulation_catalogs sc_c ON sc_c.id = sci_c.catalog_id AND sc_c.deleted_at IS NULL
                      JOIN simulation_catalogs ac_c ON ac_c.id = $${cidx} AND ac_c.deleted_at IS NULL`;
        whereParts.push(`(sc_c.path = ac_c.path OR sc_c.path LIKE ac_c.path || '/%')`);
      } else {
        params.push(query.catalog_id);
        joinClause = `JOIN simulation_catalog_items sci_c ON sci_c.simulation_id = s.id AND sci_c.catalog_id = $${params.length}`;
      }
    }

    const where = whereParts.join(' AND ');
    const cols  = `s.id, s.title, s.description, s.type, s.thumbnail_url,
                   s.estimated_minutes, s.difficulty, s.visibility, s.status, s.version,
                   s.launch_type, s.build_uuid, s.original_zip_filename, s.storage_path,
                   s.public_entry_url, s.entry_file, s.build_status, s.build_validation,
                   s.file_size_bytes, s.created_at`;

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(DISTINCT s.id) AS total FROM simulations s ${joinClause} WHERE ${where}`,
      params,
    );
    const total = parseInt(countRows[0]?.total ?? '0', 10);

    const dataParams = [...params, limit, offset];
    const { rows: dataRows } = await pool.query(
      `SELECT DISTINCT ${cols}
         FROM simulations s ${joinClause}
        WHERE ${where}
        ORDER BY s.title
        LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams,
    );
    rows = dataRows;

    return { simulations: rows.map(mapSim), meta: buildPaginationMeta(total, page, limit) };
  }

  return { simulations: rows.map(mapSim), meta: buildPaginationMeta(rows.length, page, limit) };
};

// ── getOne ────────────────────────────────────────────────────────────────────

exports.getOne = async (id, actor) => {
  const sim = await SimulationModel.findById(id);
  if (!sim) throw ApiError.notFound('Simulation not found.');

  const isGuest      = !actor;
  const isSuperAdmin = actor?.roles?.includes('super_admin');

  if (isGuest) {
    if (!['demo_public', 'demo_and_institution'].includes(sim.visibility)) {
      throw ApiError.notFound('Simulation not found.');
    }
    return mapSim(sim);
  }

  if (sim.visibility === 'private' && !isSuperAdmin) {
    throw ApiError.notFound('Simulation not found.');
  }

  if (!isSuperAdmin && sim.visibility === 'institution') {
    const assigned = await SimulationCatalogModel.isSimulationAssignedToInstitution(
      id, actor.institutionId,
    );
    if (!assigned) throw ApiError.notFound('Simulation not found.');
  }

  return mapSim(sim);
};

// ── create ────────────────────────────────────────────────────────────────────

exports.create = async (body, actor) => {
  assertCanManageGlobal(actor);

  const sim = await SimulationModel.create({
    institutionId:      null,
    domainId:           body.domainId           ?? null,
    title:              body.title,
    description:        body.description        ?? null,
    type:               'webgl',
    launchUrl:          null,
    thumbnailUrl:       body.thumbnailUrl        ?? null,
    estimatedMinutes:   body.estimatedMinutes    ?? null,
    difficulty:         body.difficulty          ?? 'intermediate',
    maxScore:           body.maxScore            ?? 100,
    passScore:          body.passScore           ?? 70,
    maxAttempts:        body.maxAttempts         ?? 3,
    scoringConfig:      body.scoringConfig        ?? {},
    learningObjectives: body.learningObjectives  ?? [],
    version:            body.version             ?? '1.0.0',
    visibility:         body.visibility          ?? 'institution',
    createdBy:          actor.id,
  });

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation.create', entityType: 'Simulation', entityId: sim.id,
    delta: { after: { title: sim.title, visibility: sim.visibility } },
  });

  return mapSim(sim);
};

// ── update ────────────────────────────────────────────────────────────────────

exports.update = async (id, body, actor) => {
  assertCanManageGlobal(actor);

  const sim = await SimulationModel.findById(id);
  if (!sim) throw ApiError.notFound('Simulation not found.');

  const before  = { title: sim.title, status: sim.status, visibility: sim.visibility };
  const updated = await SimulationModel.update(id, {
    title:         body.title,
    description:   body.description,
    status:        body.status,
    difficulty:    body.difficulty,
    max_attempts:  body.maxAttempts,
    visibility:    body.visibility,
    version:       body.version,
    launch_url:    body.launchUrl,
    thumbnail_url: body.thumbnailUrl,
    domain_id:     body.domainId,
  });

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation.update', entityType: 'Simulation', entityId: id,
    delta: { before, after: { title: updated?.title, status: updated?.status, visibility: body.visibility } },
  });

  return mapSim(updated);
};

// ── remove ────────────────────────────────────────────────────────────────────

exports.remove = async (id, actor) => {
  assertCanManageGlobal(actor);

  const sim = await SimulationModel.findById(id);
  if (!sim) throw ApiError.notFound('Simulation not found.');

  await SimulationModel.softDelete(id);

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation.delete', entityType: 'Simulation', entityId: id,
    delta: { before: { title: sim.title } },
  });
};

// ── getPreviewUrl ─────────────────────────────────────────────────────────────

exports.getPreviewUrl = async (id, actor) => {
  const sim = await SimulationModel.findById(id);
  if (!sim) throw ApiError.notFound('Simulation not found.');

  const isGuest      = !actor;
  const isSuperAdmin = actor?.roles?.includes('super_admin');

  if (isGuest && !['demo_public', 'demo_and_institution'].includes(sim.visibility)) {
    throw ApiError.notFound('Simulation not found.');
  }
  if (!isGuest && !isSuperAdmin && sim.visibility === 'private') {
    throw ApiError.notFound('Simulation not found.');
  }
  if (!isGuest && !isSuperAdmin && sim.visibility === 'institution') {
    const assigned = await SimulationCatalogModel.isSimulationAssignedToInstitution(
      id, actor.institutionId,
    );
    if (!assigned) throw ApiError.notFound('Simulation not found.');
  }

  return { previewUrl: sim.launch_url, title: sim.title, simulationId: id };
};

// ── listDemo ──────────────────────────────────────────────────────────────────

exports.listDemo = async (query) => {
  const page   = Math.max(1, parseInt(query.page)       || 1);
  const limit  = Math.min(parseInt(query.limit || query.page_size) || 12, 100);
  const offset = (page - 1) * limit;

  const whereParts = [
    `s.visibility IN ('demo_public', 'demo_and_institution')`,
    `s.status = 'active'`,
    `s.deleted_at IS NULL`,
  ];
  const params = [];

  if (query.search?.trim()) {
    params.push(`%${query.search.trim()}%`);
    whereParts.push(`(s.title ILIKE $${params.length} OR s.description ILIKE $${params.length})`);
  }

  if (query.difficulty) {
    params.push(query.difficulty);
    whereParts.push(`s.difficulty = $${params.length}`);
  }

  let joinClause = '';
  if (query.catalog_id) {
    if (query.include_children === 'true') {
      params.push(query.catalog_id);
      const cidx = params.length;
      joinClause = `
        JOIN simulation_catalog_items sci ON sci.simulation_id = s.id
        JOIN simulation_catalogs sc ON sc.id = sci.catalog_id AND sc.deleted_at IS NULL
        JOIN simulation_catalogs ac ON ac.id = $${cidx} AND ac.deleted_at IS NULL`;
      whereParts.push(`(sc.path = ac.path OR sc.path LIKE ac.path || '/%')`);
    } else {
      params.push(query.catalog_id);
      joinClause = `JOIN simulation_catalog_items sci ON sci.simulation_id = s.id AND sci.catalog_id = $${params.length}`;
    }
  }

  const where = whereParts.join(' AND ');

  const dataParams = [...params, limit, offset];
  const { rows } = await pool.query(
    `SELECT DISTINCT s.id, s.title, s.description, s.type, s.thumbnail_url, s.estimated_minutes,
            s.difficulty, s.visibility, s.status, s.version, s.learning_objectives,
              s.launch_type, s.build_uuid, s.original_zip_filename, s.storage_path,
              s.public_entry_url, s.entry_file, s.build_status, s.build_validation,
              s.file_size_bytes, s.created_at
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams,
  );

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(DISTINCT s.id) AS total FROM simulations s ${joinClause} WHERE ${where}`,
    params,
  );

  const total = parseInt(countRows[0]?.total || '0', 10);
  return {
    simulations: rows.map(mapSim),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

// ── demoLaunch ────────────────────────────────────────────────────────────────

exports.demoLaunch = async (id, req) => {
  const sim = await SimulationModel.findById(id);
  if (!sim) throw ApiError.notFound('Simulation not found.');

  if (!['demo_public', 'demo_and_institution'].includes(sim.visibility)) {
    throw ApiError.forbidden('This simulation is not available for public demo launch.');
  }
  if (sim.status !== 'active') {
    throw ApiError.badRequest('This simulation is not currently active.');
  }
  if (sim.launch_type === 'webgl' && sim.build_status !== 'ready') {
    throw ApiError.badRequest(
      `Simulation build is not ready (status: ${sim.build_status ?? 'unknown'}). Please try again later.`,
    );
  }

  const launchUrl = sim.launch_type === 'webgl'
    ? resolveWebGLLaunchUrl(sim, req)
    : sim.launch_url;

  return {
    launchUrl,
    title:         sim.title,
    simulationId:  sim.id,
    type:          sim.type,
    launchType:    sim.launch_type ?? sim.type,
    buildUuid:     sim.build_uuid  ?? null,
    buildStatus:   sim.build_status ?? null,
    isDemo:        true,
    maxAttempts:   null,
    scoringConfig: sim.scoring_config,
  };
};

// ── launch ────────────────────────────────────────────────────────────────────

exports.launch = async (id, actor, req) => {
  if (!actor) throw ApiError.unauthorized('Authentication required to launch simulations.');

  const sim = await SimulationModel.findById(id);
  if (!sim) throw ApiError.notFound('Simulation not found.');
  if (sim.status !== 'active') throw ApiError.badRequest('This simulation is not currently active.');

  // WebGL-specific: build is not ready
  if (sim.launch_type === 'webgl' && sim.build_status !== 'ready') {
    throw ApiError.badRequest(
      `Simulation build is not ready (status: ${sim.build_status ?? 'unknown'}). Please try again later.`,
    );
  }

  // Determine the effective launch URL
  const launchUrl = sim.launch_type === 'webgl'
    ? resolveWebGLLaunchUrl(sim, req)
    : sim.launch_url;

  const buildLaunchResult = () => ({
    launchUrl,
    title:         sim.title,
    simulationId:  sim.id,
    type:          sim.type,
    launchType:    sim.launch_type ?? sim.type,
    buildUuid:     sim.build_uuid  ?? null,
    buildStatus:   sim.build_status ?? null,
    maxAttempts:   sim.max_attempts,
    scoringConfig: sim.scoring_config,
  });

  const isSuperAdmin = actor.roles?.includes('super_admin');
  if (isSuperAdmin) {
    await AuditModel.log({
      institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
      action: 'simulation.launch', entityType: 'Simulation', entityId: sim.id,
      delta: { after: { simulationId: sim.id, launchType: sim.launch_type } },
    });
    return buildLaunchResult();
  }

  if (['demo_public', 'demo_and_institution'].includes(sim.visibility)) {
    return buildLaunchResult();
  }

  if (sim.visibility === 'private') {
    throw ApiError.forbidden('This simulation is not available.');
  }

  // institution visibility: catalog must be assigned to actor's institution
  const assigned = await SimulationCatalogModel.isSimulationAssignedToInstitution(
    id, actor.institutionId,
  );
  if (!assigned) {
    throw ApiError.forbidden('This simulation is not available for your institution.');
  }

  // Students and TAs must also be enrolled in a course that includes this simulation
  const isStudentOrTA = actor.roles?.some((r) => ['student', 'teaching_assistant'].includes(r));
  if (isStudentOrTA) {
    const { rows } = await pool.query(
      `SELECT 1 FROM lessons l
         JOIN course_modules m ON m.id = l.module_id
         JOIN courses c ON c.id = m.course_id
         JOIN enrollments e ON e.course_id = c.id
        WHERE e.user_id = $1
          AND l.simulation_id = $2
          AND e.status = 'active'
          AND c.status = 'published'
          AND c.institution_id = $3
        LIMIT 1`,
      [actor.id, id, actor.institutionId],
    );
    if (!rows.length) {
      await AuditModel.log({
        institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
        action: 'simulation.launch_blocked', entityType: 'Simulation', entityId: sim.id,
        delta: { reason: 'not_enrolled' },
      });
      throw ApiError.forbidden(
        'You must be enrolled in a course that includes this simulation to launch it.',
      );
    }
  }

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation.launch', entityType: 'Simulation', entityId: sim.id,
    delta: { after: { simulationId: sim.id, launchType: sim.launch_type } },
  });

  return buildLaunchResult();
};

// ── assignToInstitution / revokeFromInstitution ───────────────────────────────
// Legacy endpoints on /simulations/:id/institutions/:instId — now delegates to
// catalog-based logic by using the simulation's existing catalog membership.

exports.assignToInstitution = async (simId, instId, actor) => {
  if (!actor?.permissions?.includes('simulation_catalogs.assign_to_institution') &&
      !actor?.permissions?.includes('simulation_catalogs.manage_global')) {
    throw ApiError.forbidden('Missing required permission: simulation_catalogs.assign_to_institution.');
  }

  const sim = await SimulationModel.findById(simId);
  if (!sim) throw ApiError.notFound('Simulation not found.');

  const { rows: [inst] } = await pool.query(
    'SELECT id FROM institutions WHERE id = $1 AND deleted_at IS NULL', [instId],
  );
  if (!inst) throw ApiError.notFound('Institution not found.');

  // Update visibility to institution-scoped if currently private
  if (sim.visibility === 'private') {
    await SimulationModel.update(simId, { visibility: 'institution' });
  }

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation.assign_institution', entityType: 'Simulation', entityId: simId,
    delta: { after: { institutionId: instId } },
  });

  return { simulationId: simId, institutionId: instId };
};

exports.revokeFromInstitution = async (simId, instId, actor) => {
  if (!actor?.permissions?.includes('simulation_catalogs.assign_to_institution') &&
      !actor?.permissions?.includes('simulation_catalogs.manage_global')) {
    throw ApiError.forbidden('Missing required permission: simulation_catalogs.assign_to_institution.');
  }

  const sim = await SimulationModel.findById(simId);
  if (!sim) throw ApiError.notFound('Simulation not found.');

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation.revoke_institution', entityType: 'Simulation', entityId: simId,
    delta: { before: { institutionId: instId } },
  });
};
