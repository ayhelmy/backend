'use strict';

/**
 * Page Content service.
 * Public read endpoints return active rows only.
 * Write endpoints are super_admin-only (checked in routes via authorize).
 */

const { pool } = require('../../config/database');
const ApiError  = require('../../utils/apiError');

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToItem(row) {
  return {
    id:            row.id,
    page:          row.page,
    section:       row.section,
    sortOrder:     row.sort_order,
    title:         row.title         ?? null,
    description:   row.description   ?? null,
    iconName:      row.icon_name     ?? null,
    iconColor:     row.icon_color    ?? null,
    category:      row.category      ?? null,
    categoryColor: row.category_color ?? null,
    ctaText:       row.cta_text      ?? null,
    extra:         row.extra         ?? {},
    isActive:      row.is_active,
    updatedAt:     row.updated_at,
  };
}

// ── Public ────────────────────────────────────────────────────────────────────

/** Return all active content for a given page, grouped by section. */
exports.getPageContent = async (page) => {
  const { rows } = await pool.query(
    `SELECT * FROM page_content
      WHERE page = $1 AND is_active = TRUE
      ORDER BY section, sort_order`,
    [page],
  );

  // Group into { section: [items] }
  const grouped = {};
  for (const row of rows) {
    const s = row.section;
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(rowToItem(row));
  }
  return grouped;
};

/** Return live platform statistics from the database. */
exports.getPlatformStats = async () => {
  const { rows: [counts] } = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM simulations        WHERE deleted_at IS NULL)                          AS simulations_count,
      (SELECT COUNT(*)::int FROM institutions        WHERE deleted_at IS NULL AND status != 'suspended') AS institutions_count,
      (SELECT COUNT(*)::int FROM simulation_catalogs WHERE parent_id IS NULL AND deleted_at IS NULL)   AS disciplines_count
  `);

  // uptime is editable via the admin panel; if the page_content table doesn't exist yet
  // (migration pending) we fall back to the default rather than throwing.
  let uptime = '99.9%';
  try {
    const { rows } = await pool.query(
      `SELECT extra FROM page_content
        WHERE page = 'platform' AND section = 'stats' AND title = 'Uptime'
        LIMIT 1`,
    );
    if (rows[0]?.extra?.uptime) uptime = rows[0].extra.uptime;
  } catch (_) {
    // page_content table not yet created — use default
  }

  return {
    simulationsCount:  counts.simulations_count,
    institutionsCount: counts.institutions_count,
    disciplinesCount:  counts.disciplines_count,
    uptime,
  };
};

// ── Admin CRUD ────────────────────────────────────────────────────────────────

exports.getAllForAdmin = async (page) => {
  const { rows } = await pool.query(
    `SELECT * FROM page_content
      WHERE page = $1
      ORDER BY section, sort_order`,
    [page],
  );
  return rows.map(rowToItem);
};

exports.createItem = async (data, actorId) => {
  const {
    page, section, sortOrder = 0,
    title, description,
    iconName, iconColor,
    category, categoryColor, ctaText,
    extra = {},
  } = data;

  const { rows: [item] } = await pool.query(
    `INSERT INTO page_content
       (page, section, sort_order, title, description,
        icon_name, icon_color, category, category_color, cta_text, extra, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
     RETURNING *`,
    [
      page, section, sortOrder,
      title || null, description || null,
      iconName || null, iconColor || null,
      category || null, categoryColor || null, ctaText || null,
      JSON.stringify(extra), actorId,
    ],
  );
  return rowToItem(item);
};

exports.updateItem = async (id, data, actorId) => {
  const { rows: [existing] } = await pool.query(
    `SELECT id FROM page_content WHERE id = $1`, [id],
  );
  if (!existing) throw ApiError.notFound('Content item not found.');

  const {
    title, description,
    iconName, iconColor,
    category, categoryColor, ctaText,
    extra, sortOrder, isActive,
  } = data;

  const { rows: [item] } = await pool.query(
    `UPDATE page_content SET
        title          = COALESCE($2,  title),
        description    = COALESCE($3,  description),
        icon_name      = COALESCE($4,  icon_name),
        icon_color     = COALESCE($5,  icon_color),
        category       = COALESCE($6,  category),
        category_color = COALESCE($7,  category_color),
        cta_text       = COALESCE($8,  cta_text),
        extra          = COALESCE($9::jsonb, extra),
        sort_order     = COALESCE($10, sort_order),
        is_active      = COALESCE($11, is_active),
        updated_at     = NOW(),
        updated_by     = $12
      WHERE id = $1
      RETURNING *`,
    [
      id,
      title       !== undefined ? title       : null,
      description !== undefined ? description : null,
      iconName    !== undefined ? iconName    : null,
      iconColor   !== undefined ? iconColor   : null,
      category    !== undefined ? category    : null,
      categoryColor !== undefined ? categoryColor : null,
      ctaText     !== undefined ? ctaText     : null,
      extra       !== undefined ? JSON.stringify(extra) : null,
      sortOrder   !== undefined ? sortOrder   : null,
      isActive    !== undefined ? isActive    : null,
      actorId,
    ],
  );
  return rowToItem(item);
};

exports.deleteItem = async (id) => {
  const { rowCount } = await pool.query(
    `DELETE FROM page_content WHERE id = $1`, [id],
  );
  if (!rowCount) throw ApiError.notFound('Content item not found.');
};

exports.updateStats = async (data, actorId) => {
  const { uptime } = data;
  await pool.query(
    `UPDATE page_content
        SET extra = extra || $1::jsonb, updated_at = NOW(), updated_by = $2
      WHERE page = 'platform' AND section = 'stats' AND title = 'Uptime'`,
    [JSON.stringify({ uptime }), actorId],
  );
  return { uptime };
};
