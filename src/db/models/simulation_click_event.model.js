'use strict';

const { pool } = require('../../config/database');

/**
 * Batch insert click/keydown events using UNNEST for a single round-trip.
 * Returns the number of rows inserted.
 */
exports.batchInsert = async (sessionId, events) => {
  if (!events || events.length === 0) return 0;

  const seqNos     = events.map(e => e.sequence_no);
  const eventTypes = events.map(e => e.event_type ?? 'click');
  const xs         = events.map(e => e.x      ?? null);
  const ys         = events.map(e => e.y      ?? null);
  const normXs     = events.map(e => e.norm_x ?? null);
  const normYs     = events.map(e => e.norm_y ?? null);
  const keyNames   = events.map(e => e.key_name ?? null);
  const times      = events.map(e => e.clicked_at);

  const { rowCount } = await pool.query(
    `INSERT INTO simulation_click_events
       (session_id, sequence_no, event_type, canvas_x, canvas_y, norm_x, norm_y, key_name, clicked_at)
     SELECT $1,
            unnest($2::int[]),
            unnest($3::text[]),
            unnest($4::real[]),
            unnest($5::real[]),
            unnest($6::real[]),
            unnest($7::real[]),
            unnest($8::text[]),
            unnest($9::timestamptz[])`,
    [sessionId, seqNos, eventTypes, xs, ys, normXs, normYs, keyNames, times],
  );
  return rowCount ?? 0;
};

/** All events for a session ordered by sequence number. */
exports.listBySession = async (sessionId) => {
  const { rows } = await pool.query(
    `SELECT sequence_no, event_type, canvas_x, canvas_y, norm_x, norm_y, key_name, clicked_at
       FROM simulation_click_events
      WHERE session_id = $1
      ORDER BY sequence_no ASC, clicked_at ASC`,
    [sessionId],
  );
  return rows;
};

/** All click events across every session for a simulation in a course. */
exports.listBySimulationAndCourse = async (simulationId, courseId) => {
  const { rows } = await pool.query(
    `SELECT e.norm_x, e.norm_y, e.clicked_at
       FROM simulation_click_events e
       JOIN simulation_activity_sessions s ON s.id = e.session_id
      WHERE s.simulation_id = $1 AND s.course_id = $2 AND e.event_type = 'click'
      ORDER BY e.clicked_at ASC`,
    [simulationId, courseId],
  );
  return rows;
};

/** Total click count for a session. */
exports.countBySession = async (sessionId) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::INTEGER AS count
       FROM simulation_click_events
      WHERE session_id = $1`,
    [sessionId],
  );
  return rows[0]?.count ?? 0;
};
