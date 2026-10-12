'use strict';

const { pool } = require('../../config/database');

const LmsRawEventModel = {
  /**
   * Insert the immutable raw event record. event_id is the Unity-supplied
   * idempotency key — a repeated identical eventId is a successful no-op
   * (guide §6 step 4 / §10 checklist): ON CONFLICT DO NOTHING, and the
   * caller distinguishes "stored" vs "duplicate" by whether a row came back.
   */
  async insertIfAbsent({ eventId, sessionId, experimentAttemptId, learnerId, eventType, schemaVersion, payload }, db = pool) {
    const { rows } = await db.query(
      `INSERT INTO lms_raw_events
         (event_id, session_id, experiment_attempt_id, learner_id, event_type, schema_version, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id, received_at`,
      [eventId, sessionId, experimentAttemptId ?? null, learnerId, eventType, schemaVersion, JSON.stringify(payload)],
    );
    return rows[0] ?? null; // null => this eventId was already stored (duplicate)
  },

  async findById(eventId) {
    const { rows } = await pool.query(
      `SELECT event_id, session_id, experiment_attempt_id, learner_id, event_type, schema_version, payload, received_at
         FROM lms_raw_events WHERE event_id = $1`,
      [eventId],
    );
    return rows[0] ?? null;
  },

  /** Instructor dashboard "events stored" tile — count of raw events tied to a set of attempts. */
  async countByAttempts(attemptIds) {
    if (attemptIds.length === 0) return 0;
    const { rows: [row] } = await pool.query(
      `SELECT COUNT(*) AS c FROM lms_raw_events WHERE experiment_attempt_id = ANY($1::uuid[])`,
      [attemptIds],
    );
    return Number(row.c);
  },
};

module.exports = LmsRawEventModel;
