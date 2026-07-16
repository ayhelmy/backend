'use strict';

/**
 * Grades service — SRS §4.8 GRD-01 to GRD-07.
 * Tenant isolation: all ops validate course.institution_id == actor.institutionId.
 * Student scope (GRD-03): students may only retrieve their own grades.
 * Override audit (GRD-05): every manual override is logged with before/after delta.
 */

const { pool }      = require('../../config/database');
const { GradeModel, CourseModel, AuditModel } = require('../../db/models');
const ApiError      = require('../../utils/apiError');

// ── Helpers ───────────────────────────────────────────────────────────────────

function assertCourseScope(course, actor) {
  if (!course) throw ApiError.notFound('Course not found.');
  if (actor.roles?.includes('super_admin')) return;
  if (course.institution_id !== actor.institutionId) throw ApiError.notFound('Course not found.');
}

function canEdit(course, actor) {
  if (actor.roles?.includes('super_admin') || actor.roles?.includes('institution_admin')) return true;
  if (actor.roles?.includes('dept_manager') && course.institution_id === actor.institutionId) return true;
  return course.instructor_id === actor.id;
}

function mapItem(row) {
  if (!row) return null;
  return {
    id:           row.id,
    courseId:     row.course_id,
    title:        row.title,
    itemType:     row.item_type,
    lessonId:     row.lesson_id     ?? null,
    simulationId: row.simulation_id ?? null,
    maxPoints:    Number(row.max_points),
    weight:       Number(row.weight),
    dueDate:      row.due_date      ?? null,
    createdAt:    row.created_at,
  };
}

function mapGrade(row) {
  if (!row) return null;
  return {
    id:             row.id,
    gradeItemId:    row.grade_item_id,
    userId:         row.user_id,
    score:          row.score           != null ? Number(row.score)           : null,
    pointsPossible: row.points_possible != null ? Number(row.points_possible) : null,
    isOverride:     row.is_override,
    overrideNote:   row.override_note ?? null,
    gradedBy:       row.graded_by     ?? null,
    gradedAt:       row.graded_at     ?? null,
    institutionId:  row.institution_id ?? null,
  };
}

// ── getGradebook ──────────────────────────────────────────────────────────────
// GRD-01: full grid of items × enrolled students, grouped for UI rendering.

exports.getGradebook = async (courseId, q, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);

  if (!canEdit(course, actor) && !actor.roles?.includes('teaching_assistant')) {
    throw ApiError.forbidden('Only instructors, TAs, and admins can view the full gradebook.');
  }

  const rows = await GradeModel.gradebookGrid(courseId);

  const itemMap    = {};
  const studentMap = {};
  const grid       = {};

  for (const row of rows) {
    if (!itemMap[row.grade_item_id]) {
      itemMap[row.grade_item_id] = {
        id:        row.grade_item_id,
        title:     row.item_title,
        itemType:  row.item_type,
        maxPoints: Number(row.max_points),
        weight:    Number(row.weight),
        dueDate:   row.due_date ?? null,
      };
    }
    if (!studentMap[row.user_id]) {
      studentMap[row.user_id] = {
        id: row.user_id, firstName: row.first_name, lastName: row.last_name, email: row.email,
      };
    }
    if (!grid[row.user_id]) grid[row.user_id] = {};
    if (row.score != null || row.graded_at != null) {
      grid[row.user_id][row.grade_item_id] = {
        score:          row.score           != null ? Number(row.score)           : null,
        pointsPossible: row.points_possible != null ? Number(row.points_possible) : null,
        isOverride:     row.is_override,
        gradedAt:       row.graded_at ?? null,
      };
    }
  }

  return {
    items:    Object.values(itemMap),
    students: Object.values(studentMap),
    grid,
  };
};

// ── listItems ─────────────────────────────────────────────────────────────────

exports.listItems = async (courseId) => {
  const rows = await GradeModel.listGradeItems(courseId);
  return rows.map(mapItem);
};

// ── createItem ────────────────────────────────────────────────────────────────

exports.createItem = async (courseId, body, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  if (!canEdit(course, actor)) throw ApiError.forbidden('Only instructors and admins can create grade items.');

  const item = await GradeModel.createGradeItem({
    courseId,
    title:        body.title,
    itemType:     body.itemType     ?? 'simulation',
    lessonId:     body.lessonId     ?? null,
    simulationId: body.simulationId ?? null,
    maxPoints:    body.maxPoints    ?? 100,
    weight:       body.weight       ?? 1,
    dueDate:      body.dueDate      ?? null,
  });

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'grade_item.create', entityType: 'GradeItem', entityId: item.id,
    delta: { after: { courseId, title: item.title, itemType: item.item_type } },
  });

  return mapItem(item);
};

// ── updateItem ────────────────────────────────────────────────────────────────

exports.updateItem = async (itemId, body, actor) => {
  const item = await GradeModel.findGradeItemById(itemId);
  if (!item) throw ApiError.notFound('Grade item not found.');

  const course = await CourseModel.findById(item.course_id);
  assertCourseScope(course, actor);
  if (!canEdit(course, actor)) throw ApiError.forbidden('Only instructors and admins can edit grade items.');

  const fields = [];
  const params = [];
  if (body.title     !== undefined) { params.push(body.title);     fields.push(`title = $${params.length}`); }
  if (body.maxPoints !== undefined) { params.push(body.maxPoints); fields.push(`max_points = $${params.length}`); }
  if (body.weight    !== undefined) { params.push(body.weight);    fields.push(`weight = $${params.length}`); }
  if (body.dueDate   !== undefined) { params.push(body.dueDate);   fields.push(`due_date = $${params.length}`); }

  if (!fields.length) return mapItem(item);

  params.push(itemId);
  const { rows } = await pool.query(
    `UPDATE grade_items SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'grade_item.update', entityType: 'GradeItem', entityId: itemId,
    delta: { after: body },
  });

  return mapItem(rows[0]);
};

// ── getStudentGrades ──────────────────────────────────────────────────────────
// GRD-03: students see own grades; instructors/admins/TAs see any student.

exports.getStudentGrades = async (courseId, studentId, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);

  const isSelf     = actor.id === studentId;
  const canViewAll = canEdit(course, actor) || actor.roles?.includes('teaching_assistant');

  if (!isSelf && !canViewAll) throw ApiError.forbidden('You can only view your own grades.');

  const items       = await GradeModel.listGradeItems(courseId);
  const grades      = await Promise.all(items.map((gi) => GradeModel.findGrade(gi.id, studentId)));
  const weightedPct = await GradeModel.weightedCourseGrade(courseId, studentId);

  return {
    studentId,
    courseId,
    weightedPct: weightedPct != null ? Number(weightedPct) : null,
    grades: items.map((gi, i) => ({ item: mapItem(gi), grade: mapGrade(grades[i]) })),
  };
};

// ── submitGrade ───────────────────────────────────────────────────────────────
// GRD-04: instructors post scores; auto-grade from session also calls this path.

exports.submitGrade = async (courseId, body, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  if (!canEdit(course, actor)) throw ApiError.forbidden('Only instructors and admins can submit grades.');

  const { gradeItemId, userId, score, pointsPossible } = body;

  const item = await GradeModel.findGradeItemById(gradeItemId);
  if (!item || item.course_id !== courseId) throw ApiError.notFound('Grade item not found in this course.');

  const institutionId = course.institution_id;
  const grade = await GradeModel.upsertGrade({
    gradeItemId,
    userId,
    score,
    pointsPossible: pointsPossible ?? item.max_points,
    isOverride:     false,
    overrideNote:   null,
    gradedBy:       actor.id,
  });

  // Stamp institution_id for new grade rows (migration back-fill handles existing rows)
  await pool.query(
    `UPDATE grades SET institution_id = $1 WHERE id = $2 AND institution_id IS NULL`,
    [institutionId, grade.id],
  );

  await AuditModel.log({
    institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'grade.submit', entityType: 'Grade', entityId: grade.id,
    delta: { after: { gradeItemId, userId, score } },
  });

  return mapGrade({ ...grade, institution_id: institutionId });
};

// ── updateGrade (override) ────────────────────────────────────────────────────
// GRD-05: grade override — requires grades.override permission; always audited.

exports.updateGrade = async (gradeId, body, actor) => {
  const { rows: [gradeRow] } = await pool.query(
    `SELECT g.*, gi.course_id FROM grades g
       JOIN grade_items gi ON gi.id = g.grade_item_id
      WHERE g.id = $1`,
    [gradeId],
  );
  if (!gradeRow) throw ApiError.notFound('Grade not found.');

  const course = await CourseModel.findById(gradeRow.course_id);
  assertCourseScope(course, actor);

  if (!actor.permissions?.includes('grades.override') && !actor.roles?.includes('super_admin')) {
    throw ApiError.forbidden('Missing permission: grades.override.');
  }

  const updated = await GradeModel.upsertGrade({
    gradeItemId:    gradeRow.grade_item_id,
    userId:         gradeRow.user_id,
    score:          body.score          ?? gradeRow.score,
    pointsPossible: body.pointsPossible ?? gradeRow.points_possible,
    isOverride:     true,
    overrideNote:   body.overrideNote   ?? null,
    gradedBy:       actor.id,
  });

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'grade.override', entityType: 'Grade', entityId: gradeId,
    delta: { before: { score: gradeRow.score }, after: { score: body.score, overrideNote: body.overrideNote } },
  });

  return mapGrade(updated);
};
