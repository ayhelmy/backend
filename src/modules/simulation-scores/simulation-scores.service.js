'use strict';

/**
 * Simulation scores service — Phase 1: CRUD + manual instructor entry
 * (score_source='instructor'). The Unity postMessage bridge hook into
 * activity.service.js's end() (score_source='simulation'/'completion_rule')
 * is Phase 3. Do NOT fabricate automatic scores here — Phase 1 only accepts
 * scores an instructor explicitly enters.
 */

const {
  SimulationScoreModel, SimulationModel, CourseModel, AuditModel,
} = require('../../db/models');
const ApiError = require('../../utils/apiError');
const agsService = require('../lti/ags.service');

function assertCourseScope(course, actor) {
  if (!course) throw ApiError.notFound('Course not found.');
  if (actor.roles?.includes('super_admin')) return;
  if (course.institution_id !== actor.institutionId) throw ApiError.notFound('Course not found.');
}

function canManageScores(actor) {
  return actor.roles?.includes('super_admin') || actor.permissions?.includes('simulation_scores.manage');
}

function canViewAllScores(actor) {
  return actor.roles?.includes('super_admin') || actor.permissions?.includes('simulation_scores.view_course');
}

function mapScore(row) {
  if (!row) return null;
  return {
    id:                          row.id,
    simulationActivitySessionId: row.simulation_activity_session_id ?? null,
    simulationId:                row.simulation_id,
    userId:                      row.user_id,
    institutionId:               row.institution_id,
    departmentId:                row.department_id ?? null,
    courseId:                    row.course_id,
    moduleId:                    row.module_id ?? null,
    lessonId:                    row.lesson_id ?? null,
    attemptNumber:               row.attempt_number,
    scoreSource:                 row.score_source,
    rawScore:                    row.raw_score      != null ? Number(row.raw_score)      : null,
    pointsPossible:              row.points_possible != null ? Number(row.points_possible) : null,
    percentage:                  row.percentage      != null ? Number(row.percentage)      : null,
    passed:                      row.passed,
    status:                      row.status,
    externalScorePayload:        row.external_score_payload ?? null,
    submittedAt:                 row.submitted_at ?? null,
    gradedAt:                    row.graded_at ?? null,
    gradedBy:                    row.graded_by ?? null,
    overrideReason:              row.override_reason ?? null,
    createdAt:                   row.created_at,
    updatedAt:                   row.updated_at ?? null,
  };
}

function computePercentage(rawScore, pointsPossible) {
  if (rawScore == null || !pointsPossible) return null;
  return Math.round((rawScore / pointsPossible) * 10000) / 100;
}

// ── listByCourse ──────────────────────────────────────────────────────────────

exports.listByCourse = async (courseId, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);

  const isOwnOnly = !canViewAllScores(actor);
  const rows = await SimulationScoreModel.listByCourse(courseId);
  const visible = isOwnOnly ? rows.filter((r) => r.user_id === actor.id) : rows;
  return visible.map(mapScore);
};

// ── getById ───────────────────────────────────────────────────────────────────

exports.getById = async (courseId, scoreId, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);

  const score = await SimulationScoreModel.findById(scoreId);
  if (!score || score.course_id !== courseId) throw ApiError.notFound('Simulation score not found in this course.');

  const isOwner = score.user_id === actor.id;
  if (!isOwner && !canViewAllScores(actor)) {
    throw ApiError.forbidden('You can only view your own simulation scores.');
  }

  return mapScore(score);
};

// ── createManualScore ─────────────────────────────────────────────────────────
// Instructor manual entry: select a student, enter a score, mark pass/fail.

exports.createManualScore = async (courseId, body, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  if (!canManageScores(actor)) {
    throw ApiError.forbidden('You do not have permission to enter simulation scores.');
  }

  const sim = await SimulationModel.findById(body.simulationId);
  if (!sim) throw ApiError.badRequest(`Simulation "${body.simulationId}" not found.`);

  const enrollment = await CourseModel.findEnrollment(courseId, body.userId);
  if (!enrollment || enrollment.status !== 'active') {
    throw ApiError.badRequest('Target student is not actively enrolled in this course.');
  }

  const pointsPossible = body.pointsPossible ?? Number(sim.max_score ?? 100);
  const percentage = computePercentage(body.rawScore, pointsPossible);

  const score = await SimulationScoreModel.create({
    simulationId:   body.simulationId,
    userId:         body.userId,
    institutionId:  course.institution_id,
    departmentId:   course.department_id ?? null,
    courseId,
    moduleId:       body.moduleId ?? null,
    lessonId:       body.lessonId ?? null,
    attemptNumber:  body.attemptNumber ?? 1,
    scoreSource:    'instructor',
    rawScore:       body.rawScore,
    pointsPossible,
    percentage,
    passed:         body.passed ?? null,
    status:         'graded',
    submittedAt:    new Date().toISOString(),
    gradedAt:       new Date().toISOString(),
    gradedBy:       actor.id,
  });

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation_score.manual_entry', entityType: 'SimulationScore', entityId: score.id,
    delta: { after: { courseId, simulationId: body.simulationId, userId: body.userId, rawScore: body.rawScore } },
  });

  // No-op for scores that never went through an LTI launch (see ags.service.js).
  agsService.syncScoreToAgs(score.id).catch(() => {});

  return mapScore(score);
};

// ── updateScore (manual grade / override) ────────────────────────────────────

exports.updateScore = async (courseId, scoreId, body, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  if (!canManageScores(actor)) {
    throw ApiError.forbidden('You do not have permission to grade or override simulation scores.');
  }

  const existing = await SimulationScoreModel.findById(scoreId);
  if (!existing || existing.course_id !== courseId) throw ApiError.notFound('Simulation score not found in this course.');

  const isOverride = body.overrideReason !== undefined && existing.status !== 'pending';

  const pointsPossible = body.pointsPossible ?? existing.points_possible;
  const rawScore = body.rawScore ?? existing.raw_score;
  const percentage = computePercentage(rawScore, pointsPossible);

  const updated = await SimulationScoreModel.update(scoreId, {
    raw_score:       rawScore,
    points_possible: pointsPossible,
    percentage,
    passed:          body.passed !== undefined ? body.passed : existing.passed,
    status:          isOverride ? 'overridden' : 'graded',
    graded_at:       new Date().toISOString(),
    graded_by:       actor.id,
    override_reason: body.overrideReason ?? existing.override_reason,
  });

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: isOverride ? 'simulation_score.override' : 'simulation_score.grade',
    entityType: 'SimulationScore', entityId: scoreId,
    delta: {
      before: { rawScore: existing.raw_score, status: existing.status },
      after:  { rawScore, status: updated.status, overrideReason: body.overrideReason ?? null },
    },
  });

  // No-op for scores that never went through an LTI launch (see ags.service.js).
  agsService.syncScoreToAgs(updated.id).catch(() => {});

  return mapScore(updated);
};
