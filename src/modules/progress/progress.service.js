'use strict';

/**
 * Progress service — SRS §4.9 PRG-01 to PRG-05.
 * Completion chain: lesson → recalc module → recalc course (PRG-02/03).
 * Tenant isolation: enrollment check before any write ensures cross-tenant writes are blocked.
 */

const { pool }      = require('../../config/database');
const { ProgressModel, CourseModel, ModuleModel } = require('../../db/models');
const ApiError      = require('../../utils/apiError');

// ── Mappers ───────────────────────────────────────────────────────────────────

function mapLessonProgress(row) {
  if (!row) return null;
  return {
    userId:       row.user_id,
    lessonId:     row.lesson_id,
    status:       row.status,
    timeSpentSec: Number(row.time_spent_sec ?? 0),
    completedAt:  row.completed_at ?? null,
    updatedAt:    row.updated_at   ?? null,
  };
}

function mapCourseProgress(row) {
  if (!row) return null;
  return {
    userId:        row.user_id,
    courseId:      row.course_id,
    completionPct: Number(row.completion_pct ?? 0),
    currentGrade:  row.current_grade != null ? Number(row.current_grade) : null,
    status:        row.status,
    completedAt:   row.completed_at ?? null,
    updatedAt:     row.updated_at   ?? null,
  };
}

// ── getCourseProgress — PRG-03 ────────────────────────────────────────────────

exports.getCourseProgress = async (courseId, userId) => {
  const progress = await ProgressModel.getCourseProgress(userId, courseId);
  return mapCourseProgress(progress) ?? {
    userId, courseId, completionPct: 0, currentGrade: null,
    status: 'not_started', completedAt: null, updatedAt: null,
  };
};

// ── getLessonProgress ─────────────────────────────────────────────────────────

exports.getLessonProgress = async (lessonId, userId) => {
  const progress = await ProgressModel.getLessonProgress(userId, lessonId);
  return mapLessonProgress(progress) ?? {
    userId, lessonId, status: 'not_started',
    timeSpentSec: 0, completedAt: null, updatedAt: null,
  };
};

// ── completeLesson — PRG-01/02/03 ────────────────────────────────────────────
// Marks lesson done, bubbles up module → course recalculation.

exports.completeLesson = async (lessonId, userId) => {
  const lesson = await ModuleModel.findLessonById(lessonId);
  if (!lesson) throw ApiError.notFound('Lesson not found.');

  const mod = await ModuleModel.findById(lesson.module_id);
  if (!mod) throw ApiError.notFound('Module not found.');

  // Tenant guard: must be actively enrolled in this course
  const { rows: [enrollment] } = await pool.query(
    `SELECT id FROM enrollments
      WHERE course_id = $1 AND user_id = $2 AND status = 'active'`,
    [mod.course_id, userId],
  );
  if (!enrollment) throw ApiError.forbidden('You must be actively enrolled to record progress.');

  // Upsert lesson progress as completed (idempotent)
  await ProgressModel.upsertLessonProgress(userId, lessonId, {
    status:      'completed',
    completedAt: new Date().toISOString(),
  });

  // PRG-02: recalculate module completion
  await ProgressModel.recalcModuleProgress(userId, mod.id);

  // PRG-03: recalculate course completion
  const courseProgress = await ProgressModel.recalcCourseProgress(userId, mod.course_id);

  // If course just completed, pull in weighted grade for final record
  if (courseProgress?.status === 'completed') {
    const { rows: [weighted] } = await pool.query(
      `SELECT SUM(g.score * gi.weight) / NULLIF(SUM(gi.max_points * gi.weight), 0) * 100 AS pct
         FROM grades g JOIN grade_items gi ON gi.id = g.grade_item_id
        WHERE gi.course_id = $1 AND g.user_id = $2`,
      [mod.course_id, userId],
    );
    if (weighted?.pct != null) {
      await ProgressModel.recalcCourseProgress(userId, mod.course_id, Number(weighted.pct));
    }
  }

  return mapCourseProgress(courseProgress);
};
