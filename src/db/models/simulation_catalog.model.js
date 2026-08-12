'use strict';

/**
 * SimulationCatalogModel — query helpers for hierarchical simulation catalogs.
 * SRS §4.7 SIM-01; RBAC v2 §simulation_catalogs permission group.
 *
 * Tree structure:
 *   - parent_id creates the hierarchy (self-referencing FK).
 *   - path stores the materialized path: "root-id/child-id/grandchild-id"
 *     enabling O(1) subtree queries via LIKE 'prefix/%'.
 *   - depth is stored (0 = root) for efficient level filtering.
 *   - root_catalog_id always points to the topmost ancestor.
 *
 * Backward-compatible: all existing flat methods still work.
 * New tree methods: getFullTree, getSubtree, getAncestors, getDescendantIds,
 *                   move, softDelete (with children/items guard).
 */

const { pool } = require('../../config/database');

// Columns to select for catalog rows (excludes deleted_at to keep responses clean)
const CAT_COLS = `
  id, name, description, slug,
  parent_id, root_catalog_id, depth, path, sort_order,
  visibility, institution_id,
  is_global, is_demo, status,
  created_by, created_at, updated_at
`;

const SimulationCatalogModel = {

  // ── Find by ID ──────────────────────────────────────────────────────────────

  async findById(id) {
    const { rows } = await pool.query(
      `SELECT ${CAT_COLS} FROM simulation_catalogs
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  },

  // ── Full flat list (backward compat) ────────────────────────────────────────

  async list({ status, visibility, institutionId } = {}) {
    const filters = ['deleted_at IS NULL'];
    const params  = [];
    if (status)       filters.push(`status = $${params.push(status)}`);
    if (visibility)   filters.push(`visibility = $${params.push(visibility)}`);
    if (institutionId) filters.push(`(institution_id = $${params.push(institutionId)} OR institution_id IS NULL)`);
    const { rows } = await pool.query(
      `SELECT ${CAT_COLS},
              (SELECT COUNT(*) FROM simulation_catalog_items sci
                WHERE sci.catalog_id = simulation_catalogs.id) AS item_count
         FROM simulation_catalogs
        WHERE ${filters.join(' AND ')}
        ORDER BY depth, sort_order, name`,
      params,
    );
    return rows;
  },

  // ── Tree queries ─────────────────────────────────────────────────────────────

  /**
   * Returns ALL non-deleted catalogs as a flat list (tree columns included).
   * The service's buildCatalogTree() converts this to a nested structure.
   */
  async getFullTree({ visibility, institutionId, rootOnly = false } = {}) {
    const filters = ['sc.deleted_at IS NULL'];
    const params  = [];
    if (visibility)    filters.push(`sc.visibility = $${params.push(visibility)}`);
    if (institutionId) {
      // Global catalogs OR institution-specific ones
      filters.push(`(sc.institution_id = $${params.push(institutionId)} OR sc.institution_id IS NULL)`);
    }
    if (rootOnly) filters.push('sc.parent_id IS NULL');

    const { rows } = await pool.query(
      `SELECT ${CAT_COLS.replace(/\n/g, ' ').trim()
               .split(', ').map(c => `sc.${c.trim()}`).join(', ')},
              COUNT(sci.id)::int AS item_count
         FROM simulation_catalogs sc
         LEFT JOIN simulation_catalog_items sci ON sci.catalog_id = sc.id
        WHERE ${filters.join(' AND ')}
        GROUP BY ${CAT_COLS.replace(/\n/g, ' ').trim()
               .split(', ').map(c => `sc.${c.trim()}`).join(', ')}
        ORDER BY sc.depth ASC, sc.sort_order ASC, sc.name ASC`,
      params,
    );
    return rows;
  },

  /**
   * Returns a specific catalog node + all its descendants (flat list).
   * Uses path-based subtree query (index on path column).
   */
  async getSubtree(catalogId) {
    const { rows: [root] } = await pool.query(
      `SELECT path FROM simulation_catalogs WHERE id = $1 AND deleted_at IS NULL`,
      [catalogId],
    );
    if (!root) return [];

    const { rows } = await pool.query(
      `SELECT ${CAT_COLS.replace(/\n/g, ' ').trim()
               .split(', ').map(c => `sc.${c.trim()}`).join(', ')},
              COUNT(sci.id)::int AS item_count
         FROM simulation_catalogs sc
         LEFT JOIN simulation_catalog_items sci ON sci.catalog_id = sc.id
        WHERE sc.deleted_at IS NULL
          AND (sc.path = $1 OR sc.path LIKE $2)
        GROUP BY ${CAT_COLS.replace(/\n/g, ' ').trim()
               .split(', ').map(c => `sc.${c.trim()}`).join(', ')}
        ORDER BY sc.depth ASC, sc.sort_order ASC, sc.name ASC`,
      [root.path, root.path + '/%'],
    );
    return rows;
  },

  /**
   * Returns the ancestor chain from root down to (but not including) catalogId.
   * Ordered root → parent.
   */
  async getAncestors(catalogId) {
    const { rows: [node] } = await pool.query(
      `SELECT path FROM simulation_catalogs WHERE id = $1 AND deleted_at IS NULL`,
      [catalogId],
    );
    if (!node || !node.path.includes('/')) return [];

    const ancestorIds = node.path.split('/').slice(0, -1); // all except self
    if (!ancestorIds.length) return [];

    const { rows } = await pool.query(
      `SELECT ${CAT_COLS} FROM simulation_catalogs
        WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
        ORDER BY depth ASC`,
      [ancestorIds],
    );
    return rows;
  },

  /** Returns array of UUIDs for all descendants of catalogId (not including itself). */
  async getDescendantIds(catalogId) {
    const { rows: [node] } = await pool.query(
      `SELECT path FROM simulation_catalogs WHERE id = $1 AND deleted_at IS NULL`,
      [catalogId],
    );
    if (!node) return [];

    const { rows } = await pool.query(
      `SELECT id FROM simulation_catalogs
        WHERE path LIKE $1 AND deleted_at IS NULL AND id != $2`,
      [node.path + '/%', catalogId],
    );
    return rows.map((r) => r.id);
  },

  // ── Assigned-institution tree ─────────────────────────────────────────────────

  /**
   * Returns a flat list of catalogs accessible to an institution.
   * Expands subtrees for assignments with include_subtree=true.
   *
   * Note: DISTINCT ON and GROUP BY cannot coexist in PostgreSQL.
   * We use GROUP BY only, with COUNT(DISTINCT sci.id) to avoid double-counting
   * when the same catalog is matched by multiple assignment rows.
   */
  async getAssignedTree(institutionId) {
    const { rows } = await pool.query(
      `SELECT ${CAT_COLS.replace(/\n/g, ' ').trim()
               .split(', ').map(c => `sc.${c.trim()}`).join(', ')},
              COUNT(DISTINCT CASE
                WHEN s.id IS NOT NULL
                 AND s.deleted_at IS NULL
                 AND s.status = 'active'
                 AND s.visibility IN ('demo_public', 'institution', 'demo_and_institution')
                THEN s.id
              END)::int AS item_count
         FROM simulation_catalogs sc
         LEFT JOIN simulation_catalog_items sci ON sci.catalog_id = sc.id
         LEFT JOIN simulations s ON s.id = sci.simulation_id
         JOIN institution_simulation_catalogs isc
              ON isc.institution_id = $1 AND isc.status = 'active'
         JOIN simulation_catalogs ac
              ON ac.id = isc.simulation_catalog_id AND ac.deleted_at IS NULL
        WHERE sc.deleted_at IS NULL
          AND (
            -- Direct assignment
            sc.id = isc.simulation_catalog_id
            OR
            -- Ancestor is assigned with include_subtree = TRUE
            (isc.include_subtree = TRUE
             AND (sc.path = ac.path OR sc.path LIKE ac.path || '/%'))
          )
        GROUP BY ${CAT_COLS.replace(/\n/g, ' ').trim()
               .split(', ').map(c => `sc.${c.trim()}`).join(', ')}
        ORDER BY sc.depth ASC, sc.sort_order ASC, sc.name ASC`,
      [institutionId],
    );
    return rows;
  },

  /** Returns catalogs assigned to an institution (root-level assignments only). */
  async listForInstitution(institutionId) {
    const { rows } = await pool.query(
      `SELECT sc.id, sc.name, sc.description, sc.slug, sc.parent_id, sc.root_catalog_id,
              sc.depth, sc.path, sc.sort_order, sc.visibility, sc.institution_id,
              sc.is_global, sc.is_demo, sc.status, sc.created_by, sc.created_at, sc.updated_at,
              isc.assigned_at, isc.include_subtree,
              (SELECT COUNT(*) FROM simulation_catalog_items sci
                WHERE sci.catalog_id = sc.id) AS item_count
         FROM simulation_catalogs sc
         JOIN institution_simulation_catalogs isc
              ON isc.simulation_catalog_id = sc.id
        WHERE isc.institution_id = $1
          AND isc.status = 'active'
          AND sc.status != 'archived'
          AND sc.deleted_at IS NULL
        ORDER BY sc.depth, sc.sort_order, sc.name`,
      [institutionId],
    );
    return rows;
  },

  // ── Demo tree ────────────────────────────────────────────────────────────────

  async getDemoTree() {
    const { rows } = await pool.query(
      `SELECT ${CAT_COLS.replace(/\n/g, ' ').trim()
               .split(', ').map(c => `sc.${c.trim()}`).join(', ')},
              COUNT(s.id)::int AS item_count
         FROM simulation_catalogs sc
         LEFT JOIN simulation_catalog_items sci ON sci.catalog_id = sc.id
         LEFT JOIN simulations s
                ON s.id = sci.simulation_id
               AND s.deleted_at IS NULL
               AND s.status = 'active'
               AND s.visibility IN ('demo_public', 'demo_and_institution')
        WHERE sc.deleted_at IS NULL
          AND sc.status = 'active'
          AND sc.visibility IN ('demo_public', 'demo_and_institution')
        GROUP BY ${CAT_COLS.replace(/\n/g, ' ').trim()
               .split(', ').map(c => `sc.${c.trim()}`).join(', ')}
        ORDER BY sc.depth ASC, sc.sort_order ASC, sc.name ASC`,
      [],
    );
    return rows;
  },

  // ── Create ───────────────────────────────────────────────────────────────────

  async create({ name, description, parentId, visibility, institutionId, isGlobal, isDemo, sortOrder, createdBy }) {
    let depth        = 0;
    let parentPath   = null;
    let rootCatalogId = null;

    if (parentId) {
      const { rows: [parent] } = await pool.query(
        `SELECT id, path, depth, root_catalog_id FROM simulation_catalogs
          WHERE id = $1 AND deleted_at IS NULL`,
        [parentId],
      );
      if (!parent) throw new Error('Parent catalog not found.');
      depth         = parent.depth + 1;
      parentPath    = parent.path;
      rootCatalogId = parent.root_catalog_id;
    }

    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 200);

    // Insert with placeholder path; update after we have the ID
    const { rows: [row] } = await pool.query(
      `INSERT INTO simulation_catalogs
         (name, description, slug, parent_id, root_catalog_id, depth, path, sort_order,
          visibility, institution_id, is_global, is_demo, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'',$7,$8,$9,$10,$11,'active',$12)
       RETURNING *`,
      [
        name, description ?? null, slug,
        parentId      ?? null,
        rootCatalogId ?? null,
        depth,
        sortOrder ?? 0,
        visibility    ?? (isDemo ? 'demo_public' : isGlobal !== false ? 'global' : 'institution'),
        institutionId ?? null,
        isGlobal !== false,
        isDemo ?? false,
        createdBy,
      ],
    );
    const catalog = row;
    const finalPath     = parentPath ? `${parentPath}/${catalog.id}` : catalog.id;
    const finalRootId   = parentId   ? rootCatalogId : catalog.id;

    const { rows: [updated] } = await pool.query(
      `UPDATE simulation_catalogs SET path = $1, root_catalog_id = $2 WHERE id = $3 RETURNING *`,
      [finalPath, finalRootId, catalog.id],
    );
    return updated;
  },

  // ── Update ───────────────────────────────────────────────────────────────────

  async update(id, fields) {
    const colMap = {
      name:        'name',
      description: 'description',
      status:      'status',
      is_global:   'is_global',
      is_demo:     'is_demo',
      visibility:  'visibility',
      sort_order:  'sort_order',
    };
    const sets   = [];
    const params = [];
    for (const [key, col] of Object.entries(colMap)) {
      if (fields[key] !== undefined) {
        params.push(fields[key]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (!sets.length) return this.findById(id);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE simulation_catalogs SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} AND deleted_at IS NULL RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  },

  // ── Move ─────────────────────────────────────────────────────────────────────
  // Moves a catalog node (and its entire subtree) under a new parent.

  async move(id, newParentId) {
    const { rows: [node] } = await pool.query(
      `SELECT id, path, depth, parent_id, root_catalog_id FROM simulation_catalogs
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!node) throw new Error('Catalog not found.');

    let newDepth      = 0;
    let newParentPath = null;
    let newRootId     = id; // becomes its own root if moved to root

    if (newParentId) {
      const { rows: [newParent] } = await pool.query(
        `SELECT id, path, depth, root_catalog_id FROM simulation_catalogs
          WHERE id = $1 AND deleted_at IS NULL`,
        [newParentId],
      );
      if (!newParent) throw new Error('New parent catalog not found.');

      // Circular check: new parent must not be a descendant of the moving node
      if (newParent.path === node.path || newParent.path.startsWith(node.path + '/')) {
        throw new Error('Cannot move catalog into one of its own descendants (circular reference).');
      }

      newDepth      = newParent.depth + 1;
      newParentPath = newParent.path;
      newRootId     = newParent.root_catalog_id;
    }

    const oldPath      = node.path;
    const newNodePath  = newParentPath ? `${newParentPath}/${id}` : id;
    const depthDiff    = newDepth - node.depth;

    // Single UPDATE handles the moved node AND all its descendants
    await pool.query(
      `UPDATE simulation_catalogs
          SET path           = $1 || SUBSTRING(path FROM LENGTH($2) + 1),
              depth          = depth + $3,
              root_catalog_id = $4,
              parent_id      = CASE WHEN id = $5 THEN $6 ELSE parent_id END,
              updated_at     = NOW()
        WHERE deleted_at IS NULL
          AND (path = $2 OR path LIKE $2 || '/%')`,
      [newNodePath, oldPath, depthDiff, newRootId, id, newParentId ?? null],
    );
  },

  // ── Soft delete ───────────────────────────────────────────────────────────────

  async softDelete(id) {
    // Guard: refuse if node has live children
    const { rows: [childCheck] } = await pool.query(
      `SELECT id FROM simulation_catalogs WHERE parent_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id],
    );
    if (childCheck) throw new Error('Cannot delete a catalog that has sub-catalogs. Remove or move children first.');

    // Guard: refuse if node has items
    const { rows: [itemCheck] } = await pool.query(
      `SELECT id FROM simulation_catalog_items WHERE catalog_id = $1 LIMIT 1`,
      [id],
    );
    if (itemCheck) throw new Error('Cannot delete a catalog that still has simulations. Remove simulations first.');

    const { rows } = await pool.query(
      `UPDATE simulation_catalogs SET deleted_at = NOW(), status = 'archived', updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [id],
    );
    return rows[0] ?? null;
  },

  // Hard delete (kept for backward compat with old code paths)
  async delete(id) {
    const { rows } = await pool.query(
      `DELETE FROM simulation_catalogs WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows[0] ?? null;
  },

  // ── Items ────────────────────────────────────────────────────────────────────

  async listItems(catalogId) {
    const { rows } = await pool.query(
      `SELECT sci.id, sci.catalog_id, sci.simulation_id, sci.sort_order, sci.created_at,
              s.title, s.description, s.type, s.visibility, s.status AS sim_status,
              s.thumbnail_url, s.estimated_minutes, s.difficulty,
              s.is_featured, s.featured_order
         FROM simulation_catalog_items sci
         JOIN simulations s ON s.id = sci.simulation_id
        WHERE sci.catalog_id = $1 AND s.deleted_at IS NULL
        ORDER BY sci.sort_order ASC, s.title ASC`,
      [catalogId],
    );
    return rows;
  },

  async addItem(catalogId, simulationId, addedBy) {
    const { rows } = await pool.query(
      `INSERT INTO simulation_catalog_items (catalog_id, simulation_id, added_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (catalog_id, simulation_id) DO NOTHING
       RETURNING *`,
      [catalogId, simulationId, addedBy],
    );
    return rows[0] ?? null;
  },

  async removeItem(catalogId, simulationId) {
    const { rows } = await pool.query(
      `DELETE FROM simulation_catalog_items
        WHERE catalog_id = $1 AND simulation_id = $2
        RETURNING id`,
      [catalogId, simulationId],
    );
    return rows[0] ?? null;
  },

  // ── Institution assignment ────────────────────────────────────────────────────

  async assignToInstitution(catalogId, institutionId, assignedBy, includeSubtree = true) {
    // Check for an existing ACTIVE assignment (partial unique index prevents duplicates)
    const { rows: existing } = await pool.query(
      `SELECT id FROM institution_simulation_catalogs
        WHERE institution_id = $1 AND simulation_catalog_id = $2 AND status = 'active'`,
      [institutionId, catalogId],
    );
    if (existing.length) {
      // Update the existing active row (e.g. change includeSubtree)
      const { rows } = await pool.query(
        `UPDATE institution_simulation_catalogs
            SET include_subtree = $3, assigned_by = $4, assigned_at = NOW(), updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [existing[0].id, null, includeSubtree, assignedBy],
      );
      return rows[0] ?? null;
    }
    // Insert a fresh active assignment (handles re-assignment after unassignment)
    const { rows } = await pool.query(
      `INSERT INTO institution_simulation_catalogs
         (institution_id, simulation_catalog_id, assigned_by, include_subtree, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING *`,
      [institutionId, catalogId, assignedBy, includeSubtree],
    );
    return rows[0] ?? null;
  },

  /**
   * Soft-unassigns a catalog from an institution.
   * Sets status = 'inactive', records who performed the action and when.
   * Returns the updated row, or null if no active assignment was found.
   */
  async revokeFromInstitution(catalogId, institutionId, unassignedBy) {
    const { rows } = await pool.query(
      `UPDATE institution_simulation_catalogs
          SET status        = 'inactive',
              unassigned_by = $3,
              unassigned_at = NOW(),
              updated_at    = NOW()
        WHERE institution_id         = $1
          AND simulation_catalog_id  = $2
          AND status                 = 'active'
        RETURNING *`,
      [institutionId, catalogId, unassignedBy ?? null],
    );
    return rows[0] ?? null;
  },

  /**
   * Returns all institutions that have access to catalogId — either via a direct
   * assignment row OR via an ancestor catalog that is assigned with include_subtree=TRUE.
   *
   * is_direct = true  → institution is assigned directly to this catalog
   * is_direct = false → institution inherits access through an ancestor assignment
   */
  /**
   * Lists institutions that have an ACTIVE assignment covering catalogId —
   * either a direct assignment or via an ancestor with include_subtree=TRUE.
   *
   * Returns both direct and inherited rows so the UI can show the full picture.
   * The `assigned_by_email` column exposes who performed the assignment.
   */
  async listAssignedInstitutions(catalogId) {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (i.id)
              i.id, i.name, i.slug, i.domain, i.logo_url, i.status,
              isc.id            AS assignment_id,
              isc.assigned_at,
              isc.include_subtree,
              isc.status        AS assignment_status,
              (isc.simulation_catalog_id = $1) AS is_direct,
              ac.name           AS assigned_via_catalog_name,
              u.email           AS assigned_by_email
         FROM institutions i
         JOIN institution_simulation_catalogs isc ON isc.institution_id = i.id
         JOIN simulation_catalogs ac
              ON ac.id = isc.simulation_catalog_id AND ac.deleted_at IS NULL
         LEFT JOIN users u ON u.id = isc.assigned_by
        WHERE i.deleted_at IS NULL
          AND isc.status = 'active'
          AND (
            -- Direct assignment to this catalog
            isc.simulation_catalog_id = $1
            OR
            -- Inherited: an ancestor catalog is assigned with include_subtree=TRUE
            (
              isc.include_subtree = TRUE
              AND EXISTS (
                SELECT 1 FROM simulation_catalogs sc
                 WHERE sc.id = $1
                   AND sc.deleted_at IS NULL
                   AND (sc.path = ac.path OR sc.path LIKE ac.path || '/%')
              )
            )
          )
        ORDER BY i.id, isc.simulation_catalog_id = $1 DESC, i.name`,
      [catalogId],
    );
    return rows;
  },

  async isAssignedToInstitution(catalogId, institutionId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM institution_simulation_catalogs
        WHERE institution_id = $1 AND simulation_catalog_id = $2 AND status = 'active'`,
      [institutionId, catalogId],
    );
    return rows.length > 0;
  },

  /**
   * Calculates the impact of unassigning catalogId from institutionId.
   *
   * Expands the catalog subtree when the active assignment has include_subtree=TRUE,
   * then counts courses, lessons, and enrolled students in the institution that
   * reference simulations from those catalogs.
   *
   * Returns: { affectedCourses, affectedLessons, affectedStudents, affectedSimulationIds,
   *            canUnassign, includeSubtree, warnings }
   */
  async getUnassignImpact(institutionId, catalogId) {
    // Resolve which catalog IDs are covered by the assignment
    const { rows: [assignment] } = await pool.query(
      `SELECT id, include_subtree FROM institution_simulation_catalogs
        WHERE institution_id = $1 AND simulation_catalog_id = $2 AND status = 'active'`,
      [institutionId, catalogId],
    );
    if (!assignment) return null;

    // Build the set of catalog IDs to inspect
    let catalogIds = [catalogId];
    if (assignment.include_subtree) {
      const { rows: descendants } = await pool.query(
        `SELECT id FROM simulation_catalogs
          WHERE path LIKE (
                  SELECT path FROM simulation_catalogs WHERE id = $1 AND deleted_at IS NULL
                ) || '/%'
            AND deleted_at IS NULL`,
        [catalogId],
      );
      catalogIds = [catalogId, ...descendants.map((r) => r.id)];
    }

    const { rows: [impact] } = await pool.query(
      `WITH catalog_ids AS (
          SELECT UNNEST($1::uuid[]) AS catalog_id
       ),
       sim_ids AS (
          SELECT DISTINCT sci.simulation_id
            FROM simulation_catalog_items sci
            JOIN catalog_ids cids ON cids.catalog_id = sci.catalog_id
       ),
       affected_lessons AS (
          SELECT l.id AS lesson_id, l.course_id, l.simulation_id
            FROM lessons l
            JOIN courses c ON c.id = l.course_id
            JOIN sim_ids s ON s.simulation_id = l.simulation_id
           WHERE c.institution_id = $2
             AND c.deleted_at IS NULL
       ),
       affected_students AS (
          SELECT DISTINCT e.user_id
            FROM enrollments e
            JOIN affected_lessons al ON al.course_id = e.course_id
           WHERE e.status = 'active'
       )
       SELECT
         (SELECT COUNT(DISTINCT course_id)::int  FROM affected_lessons)    AS affected_courses,
         (SELECT COUNT(*)::int                   FROM affected_lessons)    AS affected_lessons,
         (SELECT COUNT(*)::int                   FROM affected_students)   AS affected_students,
         (SELECT ARRAY_AGG(DISTINCT simulation_id) FROM sim_ids)           AS affected_simulation_ids`,
      [catalogIds, institutionId],
    );

    const warnings = [];
    if (impact.affected_lessons > 0) {
      warnings.push(
        `${impact.affected_lessons} course lesson${impact.affected_lessons !== 1 ? 's' : ''} ` +
        `in ${impact.affected_courses} course${impact.affected_courses !== 1 ? 's' : ''} ` +
        `use simulations from this catalog. Affected students: ${impact.affected_students}.`,
      );
    }

    return {
      catalogId,
      institutionId,
      includeSubtree:           assignment.include_subtree,
      affectedCourses:          impact.affected_courses          ?? 0,
      affectedLessons:          impact.affected_lessons          ?? 0,
      affectedStudents:         impact.affected_students         ?? 0,
      affectedSimulationIds:    impact.affected_simulation_ids  ?? [],
      canUnassign:              true,
      warnings,
    };
  },

  // ── Cross-entity access check (tree-aware) ────────────────────────────────────
  /**
   * Returns true when simulationId is accessible to institutionId via:
   *   a) Direct catalog assignment, OR
   *   b) An ancestor catalog is assigned with include_subtree = TRUE.
   */
  async isSimulationAssignedToInstitution(simulationId, institutionId) {
    const { rows } = await pool.query(
      `SELECT 1
         FROM simulation_catalog_items sci
         JOIN simulation_catalogs sc ON sc.id = sci.catalog_id AND sc.deleted_at IS NULL
        WHERE sci.simulation_id = $1
          AND EXISTS (
            SELECT 1
              FROM institution_simulation_catalogs isc
              JOIN simulation_catalogs ac
                ON ac.id = isc.simulation_catalog_id AND ac.deleted_at IS NULL
             WHERE isc.institution_id = $2
               AND isc.status = 'active'
               AND (
                 isc.simulation_catalog_id = sci.catalog_id
                 OR (
                   isc.include_subtree = TRUE
                   AND (sc.path = ac.path OR sc.path LIKE ac.path || '/%')
                 )
               )
          )
        LIMIT 1`,
      [simulationId, institutionId],
    );
    return rows.length > 0;
  },

  /**
   * Returns true when simulationId is accessible to departmentId via:
   *   a) Direct catalog assignment, OR
   *   b) An ancestor catalog is assigned with include_subtree = TRUE.
   * Mirrors isSimulationAssignedToInstitution but scoped to department_simulation_catalogs.
   */
  async isSimulationAllowedForDepartment(simulationId, departmentId) {
    const { rows } = await pool.query(
      `SELECT 1
         FROM simulation_catalog_items sci
         JOIN simulation_catalogs sc ON sc.id = sci.catalog_id AND sc.deleted_at IS NULL
        WHERE sci.simulation_id = $1
          AND EXISTS (
            SELECT 1
              FROM department_simulation_catalogs dsc
              JOIN simulation_catalogs ac
                ON ac.id = dsc.simulation_catalog_id AND ac.deleted_at IS NULL
             WHERE dsc.department_id = $2
               AND (
                 dsc.simulation_catalog_id = sci.catalog_id
                 OR (
                   dsc.include_subtree = TRUE
                   AND (sc.path = ac.path OR sc.path LIKE ac.path || '/%')
                 )
               )
          )
        LIMIT 1`,
      [simulationId, departmentId],
    );
    return rows.length > 0;
  },

  /** Validates that newParentId is not a descendant of catalogId (circular guard). */
  async validateNoCircularParent(catalogId, newParentId) {
    if (!newParentId) return true; // moving to root is always safe
    const { rows: [node] } = await pool.query(
      `SELECT path FROM simulation_catalogs WHERE id = $1 AND deleted_at IS NULL`,
      [catalogId],
    );
    if (!node) return true;
    const { rows: [prospectiveParent] } = await pool.query(
      `SELECT path FROM simulation_catalogs WHERE id = $1 AND deleted_at IS NULL`,
      [newParentId],
    );
    if (!prospectiveParent) return false;
    // Circular: newParent's path starts with current node's path
    return !(prospectiveParent.path === node.path || prospectiveParent.path.startsWith(node.path + '/'));
  },
};

module.exports = SimulationCatalogModel;
