'use strict';

/**
 * Simulation Activity Service
 * Tracks when users enter/exit simulations from course lessons.
 * Duration is always calculated server-side from started_at / last_heartbeat_at.
 *
 * Access rules:
 *   start/heartbeat/end — session owner only (validated by ownership check)
 *   listMyActivity      — any authenticated user (own records only)
 *   listCourseActivity  — instructor who owns the course, dept_manager, institution_admin, super_admin
 *   cleanupStaleSessions— internal/cron only
 */

const { pool }                          = require('../../config/database');
const { CourseModel, ModuleModel, SimulationModel, AuditModel,
        SimulationActivitySessionModel,
        SimulationClickEventModel,
        SimulationClickRegionModel,
        SimulationStepModel }            = require('../../db/models');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const ApiError                          = require('../../utils/apiError');

// ── Duration formatting ───────────────────────────────────────────────────────

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ── RBAC helpers ──────────────────────────────────────────────────────────────

function isSuperAdmin(actor) {
  return actor?.roles?.includes('super_admin');
}

function isInstitutionAdmin(actor) {
  return actor?.roles?.includes('institution_admin');
}

function isDeptManager(actor) {
  return actor?.roles?.includes('dept_manager');
}

function isInstructor(actor) {
  return actor?.roles?.includes('instructor') || actor?.roles?.includes('teaching_assistant');
}

/** Can the actor manage (view all activity for) the given course? */
function canViewCourseActivity(course, actor) {
  if (isSuperAdmin(actor)) return true;
  if (isInstitutionAdmin(actor) && course.institution_id === actor.institutionId) return true;
  if (isDeptManager(actor) && course.institution_id === actor.institutionId) return true;
  if (isInstructor(actor) && course.instructor_id === actor.id &&
      course.institution_id === actor.institutionId) return true;
  return false;
}

/** Reject cross-institution reads with 404 (not 403) to avoid enumeration. */
function assertRead(course, actor) {
  if (isSuperAdmin(actor)) return;
  if (course.institution_id !== actor.institutionId) {
    throw ApiError.notFound('Course not found.');
  }
}

// ── start ─────────────────────────────────────────────────────────────────────

/**
 * Validates access, ends any stale session, creates a new activity session,
 * and returns the authorized WebGL launch URL + session metadata.
 *
 * Reuses the same access chain as getLessonSimulationLaunch in modules.service.js.
 */
exports.start = async ({ courseId, lessonId, simulationId: requestedSimId }, actor, req) => {
  if (!actor) throw ApiError.unauthorized('Authentication required.');

  // ── Load course ──────────────────────────────────────────────────────────────
  const course = await CourseModel.findById(courseId);
  if (!course) throw ApiError.notFound('Course not found.');
  assertRead(course, actor);

  // Students must be actively enrolled
  const actorIsStudent = actor.roles?.includes('student');
  if (actorIsStudent) {
    const enrollment = await CourseModel.findEnrollment(courseId, actor.id);
    if (!enrollment || enrollment.status !== 'active') {
      throw ApiError.forbidden('You must be enrolled in this course to launch simulations.');
    }
  }

  // ── Load lesson ──────────────────────────────────────────────────────────────
  const lesson = await ModuleModel.findLessonById(lessonId);
  if (!lesson) throw ApiError.notFound('Lesson not found.');

  const mod = await ModuleModel.findById(lesson.module_id);
  if (!mod || mod.course_id !== courseId) {
    throw ApiError.notFound('Lesson not found in this course.');
  }

  const hasSimulation = lesson.lesson_mode === 'simulation' ||
                        lesson.lesson_mode === 'content_and_simulation';
  if (!hasSimulation || !lesson.simulation_id) {
    throw ApiError.badRequest('This lesson does not have a simulation attached.');
  }

  if (!lesson.is_published && actorIsStudent) {
    throw ApiError.forbidden('This lesson is not published.');
  }

  // ── Validate simulation_id when caller specifies one ────────────────────────
  if (requestedSimId && requestedSimId !== lesson.simulation_id) {
    throw ApiError.badRequest('Simulation does not match the lesson configuration.');
  }

  // ── Load & validate simulation ───────────────────────────────────────────────
  const sim = await SimulationModel.findById(lesson.simulation_id);
  if (!sim) throw ApiError.notFound('Simulation not found.');
  if (sim.status !== 'active') {
    throw ApiError.badRequest('This simulation is not currently active.');
  }
  if (sim.launch_type === 'webgl' && sim.build_status !== 'ready') {
    throw ApiError.badRequest(
      `Simulation build is not ready (status: ${sim.build_status ?? 'unknown'}).`,
    );
  }

  // ── Resolve launch URL ───────────────────────────────────────────────────────
  const launchUrl = sim.launch_type === 'webgl' && sim.public_entry_url
    ? `${req.protocol}://${req.get('host')}${sim.public_entry_url}`
    : sim.launch_url;

  if (!launchUrl) {
    throw ApiError.badRequest('Simulation does not have a valid launch URL.');
  }

  // ── End any stale active sessions for this user+lesson+simulation ────────────
  await SimulationActivitySessionModel.endStaleActive(actor.id, lessonId, sim.id);

  // ── Determine user role to store ─────────────────────────────────────────────
  const userRole = (actor.roles ?? ['student'])[0] ?? 'student';

  // ── Create activity session ──────────────────────────────────────────────────
  const session = await SimulationActivitySessionModel.create({
    institutionId: course.institution_id,
    departmentId:  course.department_id ?? null,
    userId:        actor.id,
    userRole,
    courseId,
    moduleId:      mod.id,
    lessonId,
    simulationId:  sim.id,
  });

  // ── Audit log (async, non-blocking) ──────────────────────────────────────────
  AuditModel.log({
    institutionId: course.institution_id,
    actorId:       actor.id,
    actorEmail:    actor.email,
    action:        'simulation_activity.start',
    entityType:    'SimulationActivitySession',
    entityId:      session.id,
    delta: {
      after: { courseId, lessonId, simulationId: sim.id, activitySessionId: session.id },
    },
    ipAddress: req.ip ?? null,
  }).catch(() => {});

  return {
    sessionId:        session.id,
    startedAt:        session.started_at,
    status:           session.status,
    launchUrl,
    simulationId:     sim.id,
    title:            sim.title,
    difficulty:       sim.difficulty    ?? null,
    estimatedMinutes: sim.estimated_minutes ?? null,
    launchType:       sim.launch_type   ?? null,
    buildStatus:      sim.build_status  ?? null,
  };
};

// ── heartbeat ─────────────────────────────────────────────────────────────────

exports.heartbeat = async (sessionId, actor) => {
  const session = await SimulationActivitySessionModel.findById(sessionId);
  if (!session) throw ApiError.notFound('Activity session not found.');

  // Only session owner can send heartbeats
  if (session.user_id !== actor.id && !isSuperAdmin(actor)) {
    throw ApiError.forbidden('Access denied.');
  }

  if (session.status !== 'active') {
    // Silently accept heartbeats for already-ended sessions (double-send ok)
    return { sessionId, status: session.status, lastHeartbeatAt: session.last_heartbeat_at };
  }

  const updated = await SimulationActivitySessionModel.updateHeartbeat(sessionId);
  return {
    sessionId,
    status:          updated.status,
    lastHeartbeatAt: updated.last_heartbeat_at,
  };
};

// ── end ───────────────────────────────────────────────────────────────────────

exports.end = async (sessionId, { exitReason } = {}, actor, req) => {
  const session = await SimulationActivitySessionModel.findById(sessionId);
  if (!session) throw ApiError.notFound('Activity session not found.');

  // Owner or admin can end a session
  const canEnd = session.user_id === actor.id ||
                 isSuperAdmin(actor) ||
                 (isInstitutionAdmin(actor) && session.institution_id === actor.institutionId);
  if (!canEnd) throw ApiError.forbidden('Access denied.');

  // Idempotent: already ended — return existing data
  if (session.status !== 'active') {
    return buildEndResponse(session);
  }

  const validExitReasons = ['user_exit', 'navigation', 'browser_close', 'timeout', 'error'];
  const safeReason = validExitReasons.includes(exitReason) ? exitReason : 'user_exit';

  const ended = await SimulationActivitySessionModel.end(sessionId, safeReason);
  // If a concurrent request already ended the session, ended will be null
  const result = ended ?? await SimulationActivitySessionModel.findById(sessionId);

  // Evaluate step completion asynchronously — never block the response
  evaluateSteps(session.simulation_id, sessionId)
    .then(stepsStatus => {
      if (stepsStatus !== null) {
        return SimulationActivitySessionModel.updateStepsStatus(sessionId, stepsStatus);
      }
    })
    .catch(() => {});

  AuditModel.log({
    institutionId: session.institution_id,
    actorId:       actor.id,
    actorEmail:    actor.email,
    action:        'simulation_activity.end',
    entityType:    'SimulationActivitySession',
    entityId:      sessionId,
    delta: {
      after: {
        exitReason: safeReason,
        durationSeconds: result.duration_seconds,
        status: result.status,
      },
    },
    ipAddress: req?.ip ?? null,
  }).catch(() => {});

  return buildEndResponse(result);
};

function buildEndResponse(session) {
  return {
    sessionId:         session.id,
    startedAt:         session.started_at,
    endedAt:           session.ended_at,
    durationSeconds:   session.duration_seconds,
    formattedDuration: formatDuration(session.duration_seconds),
    status:            session.status,
    exitReason:        session.exit_reason ?? null,
    stepsStatus:       session.steps_status ?? null,
  };
}

/**
 * Greedy sequential matcher: returns 'passed' if the student's clicks contain
 * every step's category in the defined order (other clicks may appear between
 * steps), or 'failed' if the sequence was incomplete.
 * Returns null when no steps are defined for the simulation.
 */
async function evaluateSteps(simulationId, sessionId) {
  const steps = await SimulationStepModel.findBySimulationId(simulationId);
  if (!steps.length) return null;

  const regionMap = await SimulationClickRegionModel.findBySimulationId(simulationId);
  if (!regionMap) return 'failed'; // steps defined but no regions → can't resolve categories

  const events = await SimulationClickEventModel.listBySession(sessionId);
  const clicks  = events.filter(e => e.event_type === 'click');

  const resolveCategory = (normX, normY) => {
    if (normX == null || normY == null) return null;
    const px = normX * regionMap.image_width;
    const py = normY * regionMap.image_height;
    const match = regionMap.regions.find(r => {
      const [x, y, w, h] = r.bbox;
      return px >= x && px <= x + w && py >= y && py <= y + h;
    });
    return match ? match.categoryName : null;
  };

  let stepIdx = 0;
  for (const click of clicks) {
    const cat = resolveCategory(click.norm_x, click.norm_y);
    if (cat && cat.toLowerCase() === steps[stepIdx].category_name.toLowerCase()) {
      stepIdx++;
      if (stepIdx === steps.length) return 'passed';
    }
  }
  return 'failed';
}

// ── listMyActivity ────────────────────────────────────────────────────────────

exports.listMyActivity = async (query, actor) => {
  if (!actor) throw ApiError.unauthorized('Authentication required.');

  const { page, limit, offset } = parsePagination(query);
  const filters = {
    courseId:     query.course_id     || null,
    lessonId:     query.lesson_id     || null,
    simulationId: query.simulation_id || null,
    status:       query.status        || null,
    dateFrom:     query.date_from     || null,
    dateTo:       query.date_to       || null,
  };

  const { rows, total } = await SimulationActivitySessionModel.listByUser(
    actor.id,
    filters,
    { limit, offset },
  );

  return {
    sessions: rows.map(mapStudentRow),
    meta:     buildPaginationMeta(total, page, limit),
  };
};

// ── listCourseActivity ────────────────────────────────────────────────────────

exports.listCourseActivity = async (courseId, query, actor) => {
  const course = await CourseModel.findById(courseId);
  if (!course) throw ApiError.notFound('Course not found.');

  assertRead(course, actor);

  if (!canViewCourseActivity(course, actor)) {
    throw ApiError.forbidden('You do not have permission to view activity for this course.');
  }

  const { page, limit, offset } = parsePagination(query);
  const filters = {
    userId:       query.student_id    || null,
    lessonId:     query.lesson_id     || null,
    simulationId: query.simulation_id || null,
    status:       query.status        || null,
    dateFrom:     query.date_from     || null,
    dateTo:       query.date_to       || null,
  };

  const [{ rows, total }, summary] = await Promise.all([
    SimulationActivitySessionModel.listByCourse(courseId, filters, { limit, offset }),
    SimulationActivitySessionModel.getCourseSummary(courseId),
  ]);

  return {
    sessions: rows.map(mapInstructorRow),
    summary:  {
      totalLaunches:        parseInt(summary.total_launches,       10),
      uniqueStudents:       parseInt(summary.unique_students,      10),
      totalDurationSeconds: parseInt(summary.total_duration_seconds, 10),
      avgDurationSeconds:   parseInt(summary.avg_duration_seconds, 10),
      formattedTotalDuration: formatDuration(parseInt(summary.total_duration_seconds, 10)),
      formattedAvgDuration:   formatDuration(parseInt(summary.avg_duration_seconds,   10)),
    },
    meta: buildPaginationMeta(total, page, limit),
  };
};

// ── listLessonActivity ────────────────────────────────────────────────────────

exports.listLessonActivity = async (courseId, lessonId, query, actor) => {
  const course = await CourseModel.findById(courseId);
  if (!course) throw ApiError.notFound('Course not found.');
  assertRead(course, actor);

  if (!canViewCourseActivity(course, actor)) {
    throw ApiError.forbidden('You do not have permission to view activity for this course.');
  }

  const lesson = await ModuleModel.findLessonById(lessonId);
  if (!lesson || lesson.course_id !== courseId) {
    throw ApiError.notFound('Lesson not found in this course.');
  }

  const { page, limit, offset } = parsePagination(query);
  const filters = {
    lessonId,
    userId:       query.student_id    || null,
    simulationId: query.simulation_id || null,
    status:       query.status        || null,
    dateFrom:     query.date_from     || null,
    dateTo:       query.date_to       || null,
  };

  const { rows, total } = await SimulationActivitySessionModel.listByCourse(
    courseId, filters, { limit, offset },
  );

  return {
    sessions: rows.map(mapInstructorRow),
    meta:     buildPaginationMeta(total, page, limit),
  };
};

// ── getLatestSessionForLesson ─────────────────────────────────────────────────
// Used by the course home page to show the last session summary per lesson.

exports.getLatestSessionForLesson = async (lessonId, simulationId, actor) => {
  if (!actor) throw ApiError.unauthorized('Authentication required.');
  const row = await SimulationActivitySessionModel.getLatestByLessonUser(
    lessonId, actor.id, simulationId,
  );
  if (!row) return null;
  return {
    id:                row.id,
    startedAt:         row.started_at,
    endedAt:           row.ended_at          ?? null,
    durationSeconds:   row.duration_seconds,
    formattedDuration: formatDuration(row.duration_seconds),
    status:            row.status,
  };
};

// ── recordClicks ──────────────────────────────────────────────────────────────

/**
 * Batch-insert canvas click positions for an active (or recently ended) session.
 * Only the session owner can submit; this prevents other users from injecting data.
 */
exports.recordClicks = async (sessionId, clicks, actor) => {
  if (!actor) throw ApiError.unauthorized('Authentication required.');

  const session = await SimulationActivitySessionModel.findById(sessionId);
  if (!session) throw ApiError.notFound('Activity session not found.');

  if (session.user_id !== actor.id && !isSuperAdmin(actor)) {
    throw ApiError.forbidden('Access denied.');
  }

  const inserted = await SimulationClickEventModel.batchInsert(sessionId, clicks);
  return { inserted };
};

// ── shared: load + categorize a session's click events ───────────────────────
// Used by both the CSV export and the aggregated stats view, so the access
// check, elapsed-time formatting, and region matching stay in one place.

async function loadCategorizedClicks(sessionId, actor) {
  if (!actor) throw ApiError.unauthorized('Authentication required.');

  const session = await SimulationActivitySessionModel.findById(sessionId);
  if (!session) throw ApiError.notFound('Activity session not found.');

  const canAccess =
    session.user_id === actor.id ||
    isSuperAdmin(actor) ||
    ((isInstitutionAdmin(actor) || isDeptManager(actor) || isInstructor(actor)) &&
      session.institution_id === actor.institutionId);

  if (!canAccess) throw ApiError.forbidden('Access denied.');

  const allEvents = await SimulationClickEventModel.listBySession(sessionId);
  const clicks    = allEvents.filter(c => c.event_type === 'click');

  // Express elapsed time from session start as HH:MM:SS.
  // This is timezone-independent and directly useful for replay analysis.
  const startedAt = session.started_at instanceof Date
    ? session.started_at : new Date(session.started_at);

  const toElapsed = ts => {
    if (!ts) return '';
    const d    = ts instanceof Date ? ts : new Date(ts);
    const secs = Math.max(0, Math.floor((d - startedAt) / 1000));
    const h    = Math.floor(secs / 3600);
    const m    = Math.floor((secs % 3600) / 60);
    const s    = secs % 60;
    const p    = n => String(n).padStart(2, '0');
    return `${p(h)}:${p(m)}:${p(s)}`;
  };

  // Resolve a click's normalized position to a named component region, if
  // a reference image + bounding boxes were uploaded for this simulation.
  const regionMap = await SimulationClickRegionModel.findBySimulationId(session.simulation_id);
  const resolveCategory = (normX, normY) => {
    if (!regionMap || normX == null || normY == null) return 'Uncategorized';
    const px = normX * regionMap.image_width;
    const py = normY * regionMap.image_height;
    const match = regionMap.regions.find(r => {
      const [x, y, w, h] = r.bbox;
      return px >= x && px <= x + w && py >= y && py <= y + h;
    });
    return match ? match.categoryName : 'Uncategorized';
  };

  const categorized = clicks.map(c => ({
    sequenceNo: c.sequence_no,
    elapsed:    toElapsed(c.clicked_at),
    category:   resolveCategory(c.norm_x, c.norm_y),
    x:          c.canvas_x,
    y:          c.canvas_y,
    clickedAt:  c.clicked_at,
  }));

  return { session, clicks: categorized };
}

// ── downloadClicksCsv ─────────────────────────────────────────────────────────

/**
 * Build a CSV string of all click events for a session.
 * Accessible by the session owner (student) or any instructor/admin in the same institution.
 */
exports.downloadClicksCsv = async (sessionId, actor) => {
  const { clicks } = await loadCategorizedClicks(sessionId, actor);

  const header = 'sequence_no,time,category,x,y\r\n';
  const rows   = clicks.map(c =>
    [c.sequenceNo, c.elapsed, c.category, c.x ?? '', c.y ?? ''].join(','),
  ).join('\r\n');

  return {
    csv:        header + rows,
    filename:   `session_${sessionId}_clicks.csv`,
    clickCount: clicks.length,
  };
};

// ── getClickStats ─────────────────────────────────────────────────────────────

/**
 * Per-component interaction counts for a session, ranked by volume, with
 * each component's share of total clicks and its last interaction time.
 * Powers the instructor-facing "Component Interaction Summary" view.
 */
exports.getClickStats = async (sessionId, actor) => {
  const { clicks } = await loadCategorizedClicks(sessionId, actor);

  const byCategory = new Map();
  for (const c of clicks) {
    const entry = byCategory.get(c.category) ?? { interactions: 0, lastClickedAt: null, lastElapsed: '' };
    entry.interactions += 1;
    if (!entry.lastClickedAt || new Date(c.clickedAt) > new Date(entry.lastClickedAt)) {
      entry.lastClickedAt = c.clickedAt;
      entry.lastElapsed   = c.elapsed;
    }
    byCategory.set(c.category, entry);
  }

  const totalClicks = clicks.length;

  const stats = [...byCategory.entries()]
    .map(([category, v]) => ({
      category,
      interactions:    v.interactions,
      percentage:      totalClicks > 0 ? Math.round((v.interactions / totalClicks) * 1000) / 10 : 0,
      lastInteraction: v.lastElapsed,
    }))
    .sort((a, b) => b.interactions - a.interactions)
    .map((s, i) => ({ rank: i + 1, ...s }));

  return { totalClicks, stats };
};

// ── getClickEvents ────────────────────────────────────────────────────────────

/**
 * Individual click events for a session in chronological order.
 * Uncategorized clicks (those that didn't land in any named region) are
 * excluded — only meaningful component interactions are returned.
 */
exports.getClickEvents = async (sessionId, actor) => {
  const { clicks } = await loadCategorizedClicks(sessionId, actor);
  const events = clicks
    .filter(c => c.category !== 'Uncategorized')
    .map(c => ({
      sequenceNo: c.sequenceNo,
      time:       c.elapsed,
      category:   c.category,
      x:          c.x,
      y:          c.y,
    }));
  return { events, totalClicks: events.length };
};

// ── getSimulationAnalytics ────────────────────────────────────────────────────

exports.getSimulationAnalytics = async (courseId, simulationId, actor) => {
  const course = await CourseModel.findById(courseId);
  if (!course) throw ApiError.notFound('Course not found.');
  assertRead(course, actor);
  if (!canViewCourseActivity(course, actor)) throw ApiError.forbidden('Access denied.');

  // Run DB queries in parallel for performance
  const [kpiRows, dailyRows, sessionRows, allClicks, regionMap] = await Promise.all([
    // KPI aggregates
    pool.query(
      `SELECT
         COUNT(*)::INTEGER AS total_sessions,
         COUNT(*) FILTER (WHERE status = 'active')::INTEGER AS active_sessions,
         COUNT(DISTINCT user_id)::INTEGER AS unique_students,
         COALESCE(AVG(duration_seconds) FILTER (WHERE status='ended'), 0)::INTEGER AS avg_duration,
         COALESCE(SUM(duration_seconds) FILTER (WHERE status='ended'), 0)::INTEGER AS total_duration,
         COUNT(*) FILTER (WHERE status='ended')::INTEGER AS ended_count,
         COUNT(*) FILTER (WHERE status='abandoned')::INTEGER AS abandoned_count
       FROM simulation_activity_sessions
       WHERE course_id = $1 AND simulation_id = $2`,
      [courseId, simulationId],
    ),
    // Daily sessions + estimated engagement (sessions) over last 30 days
    pool.query(
      `SELECT
         DATE(started_at AT TIME ZONE 'UTC') AS date,
         COUNT(*)::INTEGER AS sessions,
         COALESCE(AVG(duration_seconds) FILTER (WHERE status='ended'), 0)::INTEGER AS avg_duration
       FROM simulation_activity_sessions
       WHERE course_id = $1 AND simulation_id = $2
         AND started_at >= NOW() - INTERVAL '30 days'
       GROUP BY 1 ORDER BY 1 ASC`,
      [courseId, simulationId],
    ),
    // Recent sessions with student info + first-click time
    pool.query(
      `SELECT
         s.id, s.status, s.started_at, s.ended_at, s.duration_seconds,
         u.first_name, u.last_name, u.email,
         MIN(e.clicked_at) AS first_click_at,
         COUNT(e.id)::INTEGER AS raw_clicks
       FROM simulation_activity_sessions s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN simulation_click_events e ON e.session_id = s.id AND e.event_type = 'click'
       WHERE s.course_id = $1 AND s.simulation_id = $2
       GROUP BY s.id, u.first_name, u.last_name, u.email
       ORDER BY s.started_at DESC
       LIMIT 8`,
      [courseId, simulationId],
    ),
    SimulationClickEventModel.listBySimulationAndCourse(simulationId, courseId),
    SimulationClickRegionModel.findBySimulationId(simulationId),
  ]);

  const kpi = kpiRows.rows[0] ?? {};

  // ── Category resolution ───────────────────────────────────────────────────────
  const resolveCategory = (normX, normY) => {
    if (!regionMap || normX == null || normY == null) return null;
    const px = normX * regionMap.image_width;
    const py = normY * regionMap.image_height;
    const match = regionMap.regions.find(r => {
      const [x, y, w, h] = r.bbox;
      return px >= x && px <= x + w && py >= y && py <= y + h;
    });
    return match ? match.categoryName : null;
  };

  const byCategory = new Map();
  const clickPoints = [];

  for (const c of allClicks) {
    const cat = resolveCategory(c.norm_x, c.norm_y);
    if (!cat) continue;
    const entry = byCategory.get(cat) ?? { interactions: 0 };
    entry.interactions += 1;
    byCategory.set(cat, entry);
    clickPoints.push({ normX: c.norm_x, normY: c.norm_y, category: cat });
  }

  const totalClicks = clickPoints.length;

  const componentStats = [...byCategory.entries()]
    .map(([category, v]) => ({
      category,
      interactions: v.interactions,
      percentage:   totalClicks > 0 ? Math.round((v.interactions / totalClicks) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.interactions - a.interactions)
    .map((s, i) => ({ rank: i + 1, ...s }));

  // ── Derived session metrics ───────────────────────────────────────────────────
  const avgClicksPerSession = kpi.total_sessions > 0
    ? Math.round((totalClicks / kpi.total_sessions) * 10) / 10
    : 0;

  const completionRate = kpi.total_sessions > 0
    ? Math.round((kpi.ended_count / kpi.total_sessions) * 1000) / 10
    : 0;

  // ── Region boxes (normalised 0-1 for CSS positioning) ────────────────────────
  const regions = regionMap
    ? regionMap.regions.map(r => ({
        name:  r.categoryName,
        normX: r.bbox[0] / regionMap.image_width,
        normY: r.bbox[1] / regionMap.image_height,
        normW: r.bbox[2] / regionMap.image_width,
        normH: r.bbox[3] / regionMap.image_height,
      }))
    : [];

  // ── Recent sessions map ───────────────────────────────────────────────────────
  const recentSessions = sessionRows.rows.map(r => ({
    id:              r.id,
    studentName:     [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unknown',
    studentEmail:    r.email ?? null,
    status:          r.status,
    startedAt:       r.started_at,
    endedAt:         r.ended_at ?? null,
    durationSeconds: r.duration_seconds,
    formattedDuration: formatDuration(r.duration_seconds),
    clicks:          r.raw_clicks,
    firstClickDelay: r.first_click_at && r.started_at
      ? Math.max(0, Math.round((new Date(r.first_click_at) - new Date(r.started_at)) / 1000))
      : null,
  }));

  return {
    summary: {
      totalSessions:        kpi.total_sessions    ?? 0,
      activeSessions:       kpi.active_sessions   ?? 0,
      uniqueStudents:       kpi.unique_students    ?? 0,
      totalClicks,
      avgDurationSeconds:   kpi.avg_duration       ?? 0,
      formattedAvgDuration: formatDuration(kpi.avg_duration ?? 0),
      avgClicksPerSession,
      completionRate,
      componentsReached:    componentStats.length,
    },
    componentStats,
    dailyActivity: dailyRows.rows.map(d => ({
      date:        d.date,
      sessions:    d.sessions,
      avgDuration: d.avg_duration,
    })),
    scatterPoints: clickPoints.slice(-800),
    regions,
    referenceImageUrl: regionMap?.reference_image_url ?? null,
    recentSessions,
  };
};

// ── cleanupStaleSessions ──────────────────────────────────────────────────────
// Called by a scheduled job (or admin endpoint). Not exposed via public API.

exports.cleanupStaleSessions = async (heartbeatTimeoutMinutes = 5) => {
  const cutoff = new Date(Date.now() - heartbeatTimeoutMinutes * 60 * 1000);
  const [abandoned, expired] = await Promise.all([
    SimulationActivitySessionModel.markAbandonedByHeartbeat(cutoff.toISOString()),
    SimulationActivitySessionModel.markExpiredNoHeartbeat(cutoff.toISOString()),
  ]);
  return { abandoned, expired };
};

// ── Row mappers ───────────────────────────────────────────────────────────────

function mapStudentRow(row) {
  return {
    id:                row.id,
    courseId:          row.courseId,
    courseTitle:       row.course_title     ?? null,
    moduleId:          row.moduleId,
    moduleTitle:       row.module_title     ?? null,
    lessonId:          row.lessonId,
    lessonTitle:       row.lesson_title     ?? null,
    simulationId:      row.simulationId,
    simulationTitle:   row.simulation_title ?? null,
    startedAt:         row.startedAt,
    endedAt:           row.endedAt          ?? null,
    durationSeconds:   row.durationSeconds,
    formattedDuration: formatDuration(row.durationSeconds),
    status:            row.status,
    exitReason:        row.exitReason       ?? null,
  };
}

function mapInstructorRow(row) {
  return {
    id:                row.id,
    userId:            row.user_id,
    userRole:          row.user_role,
    userFirstName:     row.first_name       ?? null,
    userLastName:      row.last_name        ?? null,
    userEmail:         row.user_email       ?? null,
    moduleId:          row.module_id,
    moduleTitle:       row.module_title     ?? null,
    lessonId:          row.lesson_id,
    lessonTitle:       row.lesson_title     ?? null,
    simulationId:      row.simulation_id,
    simulationTitle:   row.simulation_title ?? null,
    startedAt:         row.started_at,
    endedAt:           row.ended_at         ?? null,
    durationSeconds:   row.duration_seconds,
    formattedDuration: formatDuration(row.duration_seconds),
    status:            row.status,
    exitReason:        row.exit_reason      ?? null,
    stepsStatus:       row.steps_status     ?? null,
  };
}
