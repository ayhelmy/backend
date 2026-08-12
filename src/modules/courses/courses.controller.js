'use strict';

const svc         = require('./courses.service');
const ApiResponse = require('../../utils/apiResponse');
const { RoleModel } = require('../../db/models');
const { pool }    = require('../../config/database');
const ApiError    = require('../../utils/apiError');
const { ROLES }   = require('../../constants/roles');

exports.list              = async (req, res, next) => { try { const r = await svc.list(req.query, req.user); ApiResponse.ok(res, 'Courses', r.courses, r.meta); } catch (e) { next(e); } };
exports.listMyEnrolled    = async (req, res, next) => { try { ApiResponse.ok(res, 'My enrolled courses', await svc.listMyEnrolled(req.user)); } catch (e) { next(e); } };
exports.create            = async (req, res, next) => { try { ApiResponse.created(res, 'Course created', await svc.create(req.body, req.user)); } catch (e) { next(e); } };
exports.getOne            = async (req, res, next) => { try { ApiResponse.ok(res, 'Course', await svc.getOne(req.params.id, req.user)); } catch (e) { next(e); } };
exports.update            = async (req, res, next) => { try { ApiResponse.ok(res, 'Course updated', await svc.update(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.remove            = async (req, res, next) => { try { await svc.remove(req.params.id, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };
exports.publish           = async (req, res, next) => { try { ApiResponse.ok(res, 'Course published', await svc.publish(req.params.id, req.user)); } catch (e) { next(e); } };
exports.archive           = async (req, res, next) => { try { ApiResponse.ok(res, 'Course archived', await svc.archive(req.params.id, req.user)); } catch (e) { next(e); } };
exports.restore           = async (req, res, next) => { try { ApiResponse.ok(res, 'Course restored', await svc.restore(req.params.id, req.user)); } catch (e) { next(e); } };
exports.clone             = async (req, res, next) => { try { ApiResponse.created(res, 'Course cloned', await svc.clone(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.listEnrollments   = async (req, res, next) => { try { const r = await svc.listEnrollments(req.params.id, req.query, req.user); ApiResponse.ok(res, 'Enrollments', r.enrollments, r.meta); } catch (e) { next(e); } };
exports.enroll            = async (req, res, next) => { try { ApiResponse.created(res, 'Enrolled', await svc.enroll(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.unenroll          = async (req, res, next) => { try { await svc.unenroll(req.params.id, req.params.userId, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };
exports.approveEnrollment = async (req, res, next) => { try { ApiResponse.ok(res, 'Enrollment approved', await svc.approveEnrollment(req.params.id, req.params.userId, req.user)); } catch (e) { next(e); } };
exports.myEnrollment      = async (req, res, next) => { try { ApiResponse.ok(res, 'My enrollment', await svc.myEnrollment(req.params.id, req.user)); } catch (e) { next(e); } };
exports.getCourseCatalogs    = async (req, res, next) => { try { ApiResponse.ok(res, 'Course simulation catalogs', await svc.getCourseCatalogs(req.params.id, req.user)); } catch (e) { next(e); } };
exports.getCourseSimulations = async (req, res, next) => { try { ApiResponse.ok(res, 'Course simulations',          await svc.getCourseSimulations(req.params.id, req.user)); } catch (e) { next(e); } };

// ── TA management ─────────────────────────────────────────────────────────────
// req.course is populated by loadCourse middleware (institution scope already validated).

exports.assignTA = async (req, res, next) => {
  try {
    const course   = req.course;   // set by loadCourse — institution already validated
    const actor    = req.user;
    const { userId } = req.body;

    // Instructors may only assign TAs to their own course
    const isSuperAdmin = actor.roles?.includes(ROLES.SUPER_ADMIN);
    const isAdmin      = actor.roles?.includes(ROLES.INSTITUTION_ADMIN);
    if (!isSuperAdmin && !isAdmin && course.instructor_id !== actor.id) {
      return next(ApiError.forbidden('You can only assign teaching assistants to your own courses.'));
    }

    // TA must belong to the same institution
    if (!isSuperAdmin) {
      const { rows: [ta] } = await pool.query(
        'SELECT institution_id FROM users WHERE id = $1 AND deleted_at IS NULL', [userId],
      );
      if (!ta || ta.institution_id !== actor.institutionId) {
        return next(ApiError.notFound('User not found.'));
      }
    }

    const result = await RoleModel.assignTA(course.id, userId, actor.id);
    ApiResponse.created(res, 'TA assigned', result);
  } catch (e) { next(e); }
};

exports.revokeTA = async (req, res, next) => {
  try {
    const course = req.course;   // set by loadCourse
    const actor  = req.user;

    const isSuperAdmin = actor.roles?.includes(ROLES.SUPER_ADMIN);
    const isAdmin      = actor.roles?.includes(ROLES.INSTITUTION_ADMIN);
    if (!isSuperAdmin && !isAdmin && course.instructor_id !== actor.id) {
      return next(ApiError.forbidden('You can only manage teaching assistants for your own courses.'));
    }

    await RoleModel.revokeTA(course.id, req.params.userId);
    ApiResponse.noContent(res);
  } catch (e) { next(e); }
};

exports.listTAs = async (req, res, next) => {
  try {
    // req.course populated by loadCourse middleware (institution scope already validated)
    const { rows } = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.avatar_url, cta.assigned_at
         FROM course_teaching_assistants cta
         JOIN users u ON u.id = cta.user_id
        WHERE cta.course_id = $1`,
      [req.course.id],
    );
    ApiResponse.ok(res, 'Teaching assistants', rows);
  } catch (e) { next(e); }
};
