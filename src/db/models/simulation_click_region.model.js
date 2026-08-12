'use strict';

const { pool } = require('../../config/database');

/** Insert or replace the click-region map for a simulation (one row per simulation). */
exports.upsert = async (simulationId, { imageWidth, imageHeight, regions, referenceImageUrl = null }) => {
  const { rows } = await pool.query(
    `INSERT INTO simulation_click_regions (simulation_id, image_width, image_height, regions, reference_image_url)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (simulation_id) DO UPDATE
       SET image_width          = EXCLUDED.image_width,
           image_height         = EXCLUDED.image_height,
           regions              = EXCLUDED.regions,
           reference_image_url  = EXCLUDED.reference_image_url,
           updated_at           = NOW()
     RETURNING *`,
    [simulationId, imageWidth, imageHeight, JSON.stringify(regions), referenceImageUrl],
  );
  return rows[0];
};

exports.findBySimulationId = async (simulationId) => {
  const { rows } = await pool.query(
    `SELECT simulation_id, image_width, image_height, regions, reference_image_url
       FROM simulation_click_regions
      WHERE simulation_id = $1`,
    [simulationId],
  );
  return rows[0] ?? null;
};
