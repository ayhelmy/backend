'use strict';

const { pool } = require('../../config/database');

const LmsStepStateModel = {
  async findByAttempt(experimentAttemptId, db = pool) {
    const { rows } = await db.query(
      `SELECT experiment_attempt_id, step_number, status, started_event_id, completed_event_id, updated_at
         FROM lms_step_states
        WHERE experiment_attempt_id = $1
        ORDER BY step_number ASC`,
      [experimentAttemptId],
    );
    return rows;
  },

  async findOne(experimentAttemptId, stepNumber) {
    const { rows } = await pool.query(
      `SELECT experiment_attempt_id, step_number, status, started_event_id, completed_event_id, updated_at
         FROM lms_step_states
        WHERE experiment_attempt_id = $1 AND step_number = $2`,
      [experimentAttemptId, stepNumber],
    );
    return rows[0] ?? null;
  },

  /** StepStarted — records entry for this tracked step. */
  async markStarted(experimentAttemptId, stepNumber, eventId, db = pool) {
    const { rows } = await db.query(
      `INSERT INTO lms_step_states (experiment_attempt_id, step_number, status, started_event_id)
       VALUES ($1,$2,'started',$3)
       ON CONFLICT (experiment_attempt_id, step_number) DO UPDATE SET
         status = 'started', started_event_id = $3, updated_at = NOW()
       RETURNING experiment_attempt_id, step_number, status, started_event_id, completed_event_id, updated_at`,
      [experimentAttemptId, stepNumber, eventId],
    );
    return rows[0];
  },

  /**
   * StepRetried — reopens the step and removes its previous completion
   * contribution from this run's progress (guide: the retry flow then sends
   * a fresh StepStarted, so this only needs to clear the completed marker).
   */
  async markRetried(experimentAttemptId, stepNumber, eventId, db = pool) {
    const { rows } = await db.query(
      `INSERT INTO lms_step_states (experiment_attempt_id, step_number, status, started_event_id)
       VALUES ($1,$2,'retried',$3)
       ON CONFLICT (experiment_attempt_id, step_number) DO UPDATE SET
         status = 'retried', completed_event_id = NULL, updated_at = NOW()
       RETURNING experiment_attempt_id, step_number, status, started_event_id, completed_event_id, updated_at`,
      [experimentAttemptId, stepNumber, eventId],
    );
    return rows[0];
  },

  /**
   * StepCompleted — only takes effect once per attempt (repeat is ignored,
   * guide: "count this distinct required step once"), and only for a step
   * that was actually started (guide: "ignores completion for steps never
   * started") — the UPDATE-only shape naturally satisfies both: no existing
   * row or an already-completed row both leave rowCount at 0.
   */
  async markCompleted(experimentAttemptId, stepNumber, eventId, db = pool) {
    const { rows } = await db.query(
      `UPDATE lms_step_states
          SET status = 'completed', completed_event_id = $3, updated_at = NOW()
        WHERE experiment_attempt_id = $1 AND step_number = $2 AND status != 'completed'
        RETURNING experiment_attempt_id, step_number, status, started_event_id, completed_event_id, updated_at`,
      [experimentAttemptId, stepNumber, eventId],
    );
    return rows[0] ?? null;
  },

  /** StepFailed — records failure without completing/terminating anything. */
  async markFailed(experimentAttemptId, stepNumber, eventId, db = pool) {
    const { rows } = await db.query(
      `INSERT INTO lms_step_states (experiment_attempt_id, step_number, status, started_event_id)
       VALUES ($1,$2,'failed',$3)
       ON CONFLICT (experiment_attempt_id, step_number) DO UPDATE SET
         status = 'failed', updated_at = NOW()
       RETURNING experiment_attempt_id, step_number, status, started_event_id, completed_event_id, updated_at`,
      [experimentAttemptId, stepNumber, eventId],
    );
    return rows[0];
  },

  /**
   * Instructor dashboard: step states for many attempts in one query, with
   * each step's started/completed server-receipt timestamps (via the raw
   * event log) so the caller can derive a duration — replaces what would
   * otherwise be a per-attempt loop.
   */
  async findByAttempts(attemptIds) {
    if (attemptIds.length === 0) return [];
    const { rows } = await pool.query(
      `SELECT ss.experiment_attempt_id, ss.step_number, ss.status,
              re_started.received_at   AS started_received_at,
              re_completed.received_at AS completed_received_at
         FROM lms_step_states ss
         LEFT JOIN lms_raw_events re_started   ON re_started.event_id   = ss.started_event_id
         LEFT JOIN lms_raw_events re_completed ON re_completed.event_id = ss.completed_event_id
        WHERE ss.experiment_attempt_id = ANY($1::uuid[])
        ORDER BY ss.experiment_attempt_id, ss.step_number`,
      [attemptIds],
    );
    return rows;
  },

  /**
   * Instructor dashboard funnel + timing chart data: per step number, how
   * many attempts reached/completed it and the average time spent, across
   * every attempt a page of students made on one experiment. Duration uses
   * lms_raw_events.received_at (server receipt time), not the client-
   * reported payload timestamp — a deliberate simplification, close enough
   * for an averaged metric and avoids fragile JSONB timestamp parsing.
   */
  async aggregateForExperiment(projectId, experimentId, learnerIds) {
    if (learnerIds.length === 0) return [];
    const { rows } = await pool.query(
      `SELECT ss.step_number,
              COUNT(*) AS reached_count,
              COUNT(*) FILTER (WHERE ss.status = 'completed') AS completed_count,
              AVG(EXTRACT(EPOCH FROM (re_completed.received_at - re_started.received_at)))
                FILTER (WHERE ss.status = 'completed') AS avg_duration_seconds,
              COUNT(*) FILTER (
                WHERE ss.status = 'completed' AND re_started.received_at IS NOT NULL AND re_completed.received_at IS NOT NULL
              ) AS sample_count
         FROM lms_step_states ss
         JOIN lms_experiment_attempts a ON a.experiment_attempt_id = ss.experiment_attempt_id
         LEFT JOIN lms_raw_events re_started   ON re_started.event_id   = ss.started_event_id
         LEFT JOIN lms_raw_events re_completed ON re_completed.event_id = ss.completed_event_id
        WHERE a.project_id = $1 AND a.experiment_id = $2 AND a.learner_id = ANY($3::uuid[])
        GROUP BY ss.step_number
        ORDER BY ss.step_number`,
      [projectId, experimentId, learnerIds],
    );
    return rows.map((r) => ({
      stepNumber: r.step_number,
      reachedCount: Number(r.reached_count),
      completedCount: Number(r.completed_count),
      avgDurationSeconds: r.avg_duration_seconds != null ? Number(r.avg_duration_seconds) : null,
      sampleCount: Number(r.sample_count),
    }));
  },
};

module.exports = LmsStepStateModel;
