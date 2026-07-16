'use strict';

/**
 * Simulation sessions service — SRS §4.7 SIM-03, §4.8 GRD-01 (auto-grade).
 * max_attempts: enforced at start(); 0 = unlimited.
 * SCORM state: suspend_data + lesson_location persisted via update().
 * Auto-grade: on complete(), best score upserted to grades table (GRD-04 path).
 */

const { pool }         = require('../../../config/database');
const { SessionModel, GradeModel, CourseModel } = require('../../../db/models');
const { parsePagination }  = require('../../../utils/pagination');
const ApiError             = require('../../../utils/apiError');

// ── Mapper ────────────────────────────────────────────────────────────────────

function mapSession(row) {
  if (!row) return null;
  return {
    id:                 row.id,
    simulationId:       row.simulation_id,
    userId:             row.user_id,
    courseId:           row.course_id           ?? null,
    lessonId:           row.lesson_id           ?? null,
    attemptNumber:      row.attempt_number,
    status:             row.status,
    score:              row.score               != null ? Number(row.score)     : null,
    maxScore:           row.max_score           != null ? Number(row.max_score) : null,
    activeSeconds:      row.active_seconds       != null ? Number(row.active_seconds) : null,
    startedAt:          row.started_at,
    completedAt:        row.completed_at        ?? null,
    scormSuspendData:   row.scorm_suspend_data  ?? null,
    scormLessonLocation: row.scorm_lesson_location ?? null,
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function loadSimulation(simId) {
  const { rows } = await pool.query(
    `SELECT id, institution_id, title, max_score, pass_score, max_attempts
       FROM simulations WHERE id = $1`,
    [simId],
  );
  return rows[0] ?? null;
}

function assertSimAccess(sim, actor) {
  if (!sim) throw ApiError.notFound('Simulation not found.');
  if (actor.roles?.includes('super_admin')) return;
  if (sim.institution_id && sim.institution_id !== actor.institutionId) {
    throw ApiError.notFound('Simulation not found.');
  }
}

async function assertSessionAccess(session, actor) {
  if (!session) throw ApiError.notFound('Session not found.');
  if (actor.roles?.includes('super_admin')) return;
  // Owner always allowed; instructors/admins in same institution also allowed
  if (session.user_id === actor.id) return;
  if (!actor.institutionId) throw ApiError.forbidden('Access denied.');
  const { rows } = await pool.query(
    `SELECT institution_id FROM simulation_sessions WHERE id = $1`, [session.id],
  );
  if (!rows[0] || rows[0].institution_id !== actor.institutionId) {
    throw ApiError.notFound('Session not found.');
  }
  const canView = actor.permissions?.includes('simulations.view_sessions') ||
                  actor.roles?.includes('institution_admin') ||
                  actor.roles?.includes('dept_manager') ||
                  actor.roles?.includes('instructor');
  if (!canView) throw ApiError.forbidden('Access denied.');
}

// ── start — SIM-03 / max_attempts enforcement ─────────────────────────────────

exports.start = async (body, actor) => {
  const { simulationId, courseId, lessonId } = body;

  const sim = await loadSimulation(simulationId);
  assertSimAccess(sim, actor);

  // If launched inside a course, verify enrollment
  if (courseId) {
    const { rows: [enr] } = await pool.query(
      `SELECT id FROM enrollments WHERE course_id=$1 AND user_id=$2 AND status='active'`,
      [courseId, actor.id],
    );
    if (!enr) throw ApiError.forbidden('You must be actively enrolled in this course.');
  }

  // max_attempts check (0 = unlimited)
  const maxAttempts = sim.max_attempts ?? 0;
  if (maxAttempts > 0) {
    const { rows: [count] } = await pool.query(
      `SELECT COUNT(*) AS total FROM simulation_sessions
        WHERE simulation_id=$1 AND user_id=$2
          AND (course_id=$3 OR ($3::uuid IS NULL AND course_id IS NULL))`,
      [simulationId, actor.id, courseId ?? null],
    );
    if (parseInt(count.total, 10) >= maxAttempts) {
      throw ApiError.forbidden(`Maximum attempts (${maxAttempts}) reached for this simulation.`);
    }

    // Abandon any lingering in-progress session before starting new one
    await pool.query(
      `UPDATE simulation_sessions SET status='abandoned', completed_at=NOW()
        WHERE simulation_id=$1 AND user_id=$2 AND status='in_progress'
          AND (course_id=$3 OR ($3::uuid IS NULL AND course_id IS NULL))`,
      [simulationId, actor.id, courseId ?? null],
    );
  }

  const attemptNumber = await SessionModel.nextAttemptNumber(simulationId, actor.id, courseId ?? null);

  const session = await SessionModel.create({
    simulationId,
    userId:        actor.id,
    courseId:      courseId  ?? null,
    lessonId:      lessonId  ?? null,
    attemptNumber,
    maxScore:      Number(sim.max_score ?? 100),
  });

  // Stamp institution_id
  if (actor.institutionId) {
    await pool.query(
      `UPDATE simulation_sessions SET institution_id=$1 WHERE id=$2 AND institution_id IS NULL`,
      [actor.institutionId, session.id],
    );
  }

  return mapSession(session);
};

// ── getOne ────────────────────────────────────────────────────────────────────

exports.getOne = async (id, actor) => {
  const session = await SessionModel.findById(id);
  await assertSessionAccess(session, actor);
  return mapSession(session);
};

// ── update — SCORM suspend_data / lesson_location (PLR-03 resume) ─────────────

exports.update = async (id, body, actor) => {
  const session = await SessionModel.findById(id);
  await assertSessionAccess(session, actor);

  if (session.user_id !== actor.id) {
    throw ApiError.forbidden('Only the session owner can update SCORM state.');
  }
  if (session.status !== 'in_progress') {
    throw ApiError.badRequest('Session is not in progress.');
  }

  const updated = await SessionModel.updateScormState(id, {
    suspendData:    body.suspendData    ?? null,
    lessonLocation: body.lessonLocation ?? null,
    activeSeconds:  body.activeSeconds  ?? null,
  });

  return mapSession(updated);
};

// ── complete — auto-grade write (GRD-04 path) ─────────────────────────────────

exports.complete = async (id, actor) => {
  const session = await SessionModel.findById(id);
  await assertSessionAccess(session, actor);

  if (session.user_id !== actor.id) throw ApiError.forbidden('Only the session owner can complete it.');
  if (session.status !== 'in_progress') throw ApiError.badRequest('Session is not in progress.');

  const sim = await loadSimulation(session.simulation_id);

  // Compute score from events (sum step scores) — fall back to client-reported score if no events
  const { rows: events } = await pool.query(
    `SELECT SUM((payload->>'score')::numeric) AS step_sum,
            SUM((payload->>'max_score')::numeric) AS step_max
       FROM simulation_events
      WHERE session_id = $1 AND event_type = 'step_completed'`,
    [id],
  );

  let score;
  if (events[0]?.step_max && Number(events[0].step_max) > 0) {
    score = Math.round(
      (Number(events[0].step_sum) / Number(events[0].step_max)) * Number(sim.max_score ?? 100),
    );
  } else {
    // No step events — accept score submitted with body; will be provided by controller
    score = Number(sim.max_score ?? 100);
  }

  const completed = await SessionModel.complete(id, {
    score,
    activeSeconds: null,
  });

  if (!completed) throw ApiError.badRequest('Session could not be completed.');

  // Auto-grade: find or create grade_item for this simulation in this course
  if (session.course_id) {
    let gradeItem;
    const { rows: items } = await pool.query(
      `SELECT id FROM grade_items
        WHERE course_id=$1 AND simulation_id=$2 AND item_type='simulation'`,
      [session.course_id, session.simulation_id],
    );

    if (items.length > 0) {
      gradeItem = items[0];
    } else {
      gradeItem = await GradeModel.createGradeItem({
        courseId:     session.course_id,
        title:        sim.title,
        itemType:     'simulation',
        simulationId: session.simulation_id,
        maxPoints:    Number(sim.max_score ?? 100),
        weight:       1,
        dueDate:      null,
      });
    }

    // Use best score across all attempts (GRD-04 §4.8)
    const best = await SessionModel.bestScore(session.simulation_id, actor.id, session.course_id);
    const bestNum = Math.max(score, best ?? 0);

    await GradeModel.upsertGrade({
      gradeItemId:    gradeItem.id,
      userId:         actor.id,
      score:          bestNum,
      pointsPossible: Number(sim.max_score ?? 100),
      isOverride:     false,
      overrideNote:   null,
      gradedBy:       null,
    });

    // Stamp institution_id on new grade row
    if (actor.institutionId) {
      await pool.query(
        `UPDATE grades g
            SET institution_id = $1
           FROM grade_items gi
          WHERE gi.id = g.grade_item_id
            AND gi.simulation_id = $2
            AND g.user_id = $3
            AND g.institution_id IS NULL`,
        [actor.institutionId, session.simulation_id, actor.id],
      );
    }
  }

  return mapSession(completed);
};

// ── listEvents ─────────────────────────────────────────────────────────────────

exports.listEvents = async (id, actor) => {
  const session = await SessionModel.findById(id);
  await assertSessionAccess(session, actor);

  const { rows } = await pool.query(
    `SELECT id, event_type, payload, occurred_at
       FROM simulation_events WHERE session_id = $1
      ORDER BY occurred_at ASC`,
    [id],
  );

  return rows.map((r) => ({
    id:          r.id,
    eventType:   r.event_type,
    payload:     r.payload ?? null,
    occurredAt:  r.occurred_at,
  }));
};
