'use strict';

/**
 * Grade categories service — weighted gradebook grouping (migration 048).
 * Weight-sum-to-100% validation happens here (not a DB constraint — Postgres
 * can't declaratively validate a cross-row SUM(weight)=100 without a trigger
 * that would fire mid-edit while categories are added one at a time).
 */

const { GradeCategoryModel, CourseModel, AuditModel } = require('../../db/models');
const ApiError = require('../../utils/apiError');

function assertCourseScope(course, actor) {
  if (!course) throw ApiError.notFound('Course not found.');
  if (actor.roles?.includes('super_admin')) return;
  if (course.institution_id !== actor.institutionId) throw ApiError.notFound('Course not found.');
}

function assertOwnsCourse(course, actor) {
  if (actor.roles?.includes('super_admin')) return;
  if (course.instructor_id !== actor.id) {
    throw ApiError.forbidden('You can only manage grade categories for courses you own.');
  }
}

function mapCategory(row) {
  if (!row) return null;
  return {
    id:             row.id,
    courseId:       row.course_id,
    name:           row.name,
    weight:         Number(row.weight),
    itemTypeFilter: row.item_type_filter ?? null,
    position:       row.position,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at ?? null,
  };
}

// ── listCategories ────────────────────────────────────────────────────────────

exports.listCategories = async (courseId, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  const rows = await GradeCategoryModel.listByCourse(courseId);
  return rows.map(mapCategory);
};

// ── createCategory ────────────────────────────────────────────────────────────

exports.createCategory = async (courseId, body, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  assertOwnsCourse(course, actor);

  const existing = await GradeCategoryModel.listByCourse(courseId);
  const position = body.position ?? existing.length;

  const category = await GradeCategoryModel.create({
    courseId,
    name:           body.name,
    weight:         body.weight ?? 0,
    itemTypeFilter: body.itemTypeFilter ?? null,
    position,
  });

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'grade_category.create', entityType: 'GradeCategory', entityId: category.id,
    delta: { after: { courseId, name: category.name, weight: Number(category.weight) } },
  });

  return mapCategory(category);
};

// ── updateCategory ────────────────────────────────────────────────────────────

exports.updateCategory = async (courseId, categoryId, body, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  assertOwnsCourse(course, actor);

  const existing = await GradeCategoryModel.findById(categoryId);
  if (!existing || existing.course_id !== courseId) throw ApiError.notFound('Grade category not found in this course.');

  const fields = {};
  if (body.name           !== undefined) fields.name             = body.name;
  if (body.weight         !== undefined) fields.weight           = body.weight;
  if (body.itemTypeFilter !== undefined) fields.item_type_filter = body.itemTypeFilter;
  if (body.position       !== undefined) fields.position         = body.position;

  const updated = await GradeCategoryModel.update(categoryId, fields);

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'grade_category.update', entityType: 'GradeCategory', entityId: categoryId,
    delta: { before: { weight: Number(existing.weight) }, after: { weight: Number(updated.weight) } },
  });

  return mapCategory(updated);
};

// ── deleteCategory ────────────────────────────────────────────────────────────

exports.deleteCategory = async (courseId, categoryId, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  assertOwnsCourse(course, actor);

  const existing = await GradeCategoryModel.findById(categoryId);
  if (!existing || existing.course_id !== courseId) throw ApiError.notFound('Grade category not found in this course.');

  await GradeCategoryModel.delete(categoryId);

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'grade_category.delete', entityType: 'GradeCategory', entityId: categoryId,
    delta: { before: { name: existing.name, weight: Number(existing.weight) } },
  });
};

// ── validateWeights ───────────────────────────────────────────────────────────
// Returns whether the course's category weights currently sum to 100%.
// weight is stored as a fraction (0.3000 == 30%), matching the existing
// grade_items.weight convention (NUMERIC(5,4), 1.0000 == full weight) —
// so "100%" here means the weights sum to 1.0, not the literal integer 100.

exports.validateWeights = async (courseId, actor) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);

  const total = await GradeCategoryModel.sumWeights(courseId);
  return {
    courseId,
    totalWeight: total,
    totalPercentage: Math.round(total * 10000) / 100,
    valid: Math.abs(total - 1) < 0.0001,
  };
};
