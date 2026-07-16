'use strict';

/**
 * Courses service — SRS §4.5 CRS-01 to CRS-10; §7.2 enrollment flow.
 * Institution isolation: every operation enforces course.institution_id = actor.institutionId.
 * Enrollment types (CRS-04): open | approval | code | admin.
 */

const { pool }                                 = require('../../config/database');
const { CourseModel, AuditModel }              = require('../../db/models');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const ApiError                                 = require('../../utils/apiError');

// ── Helpers ───────────────────────────────────────────────────────────────────

function assertInstitution(course, actor) {
  if (actor.roles?.includes('super_admin')) return;
  if (course.institution_id !== actor.institutionId) {
    // Return 404, not 403 — prevents cross-tenant resource enumeration
    throw ApiError.notFound('Course not found.');
  }
}

async function initProgress(courseId, userId) {
  await pool.query(
    `INSERT INTO course_progress (user_id, course_id, completion_pct, status)
     VALUES ($1, $2, 0, 'in_progress')
     ON CONFLICT (user_id, course_id) DO NOTHING`,
    [userId, courseId],
  );
}

// Notification hook placeholder (SRS §7.2 step 6, §7.5 step 9)
// Replace with NotificationService.dispatch() when the notification module is ready.
function notifyAsync(event, payload) {
  setImmediate(() => {
    console.info('[notify:placeholder]', event, JSON.stringify(payload).slice(0, 120));
  });
}

// ── Mappers ───────────────────────────────────────────────────────────────────

function mapCourse(row) {
  if (!row) return null;
  return {
    id:             row.id,
    institutionId:  row.institution_id,
    departmentId:   row.department_id   ?? null,
    academicYearId: row.academic_year_id ?? null,
    semesterTermId: row.semester_term_id ?? null,
    termId:         row.term_id         ?? null,
    domainId:       row.domain_id       ?? null,
    instructorId:   row.instructor_id,
    code:           row.code            ?? null,
    title:          row.title,
    description:    row.description     ?? null,
    thumbnailUrl:   row.thumbnail_url   ?? null,
    status:         row.status,
    enrollmentType: row.enrollment_type,
    enrollmentCap:  row.enrollment_cap  ?? null,
    startDate:      row.start_date      ?? null,
    endDate:        row.end_date        ?? null,
    passingGrade:   Number(row.passing_grade),
    settings:       row.settings        ?? {},
    publishedAt:    row.published_at    ?? null,
    createdBy:      row.created_by,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
    ...(row.enrolled_count !== undefined && { enrolledCount: Number(row.enrolled_count) }),
    ...(row.module_count   !== undefined && { moduleCount:   Number(row.module_count) }),
    departmentName:   row.department_name    ?? null,
    departmentCode:   row.department_code    ?? null,
    academicYearName: row.academic_year_name ?? null,
    semesterTermName: row.semester_term_name ?? null,
  };
}

function mapEnrollment(row) {
  if (!row) return null;
  return {
    id:          row.id,
    courseId:    row.course_id,
    userId:      row.user_id,
    role:        row.role,
    status:      row.status,
    finalGrade:  row.final_grade  ?? null,
    enrolledAt:  row.enrolled_at,
    completedAt: row.completed_at ?? null,
  };
}

// ── list ──────────────────────────────────────────────────────────────────────
// Role-based visibility (SRS CRS-05):
//   Students/guests → published courses only.
//   Instructors     → their own courses (all statuses).
//   Admins          → all institution courses.

exports.list = async (query, actor) => {
  const { page, limit, offset } = parsePagination(query);
  const isSuperAdmin   = actor.roles?.includes('super_admin');
  const isAdmin        = isSuperAdmin || actor.roles?.includes('institution_admin') || actor.roles?.includes('dept_manager');
  const isInstructor   = !isAdmin && (
    actor.roles?.includes('instructor') ||
    actor.roles?.includes('teaching_assistant')
  );
  const institutionId = isSuperAdmin ? (query.institutionId ?? null) : actor.institutionId;

  // Non-super_admin users must have an institution context.
  // Super admins may omit institutionId to browse all courses platform-wide.
  if (!isSuperAdmin && !institutionId) {
    throw ApiError.badRequest('Could not determine your institution. Please contact support.');
  }

  const isStudent = !isAdmin && !isInstructor && actor.roles?.includes('student');

  const statusFilter     = isAdmin ? query.status : (isInstructor ? query.status : 'published');
  const instructorFilter = isInstructor ? actor.id : query.instructorId;

  // Students see only courses of their current assigned semester term
  let semesterTermFilter = query.semesterTermId;
  if (isStudent) {
    const { rows: [assignment] } = await pool.query(
      `SELECT semester_term_id FROM user_academic_assignments
        WHERE user_id = $1 AND role_context = 'student' AND is_current = TRUE LIMIT 1`,
      [actor.id],
    );
    semesterTermFilter = assignment?.semester_term_id ?? null;
    if (!semesterTermFilter) return { courses: [], meta: buildPaginationMeta(0, page, limit) };
  }

  const rows = await CourseModel.list({
    institutionId,
    semesterTermId: semesterTermFilter,
    departmentId:   query.departmentId,
    academicYearId: query.academicYearId,
    status:         statusFilter,
    instructorId:   instructorFilter,
    domainId:       query.domainId,
    search:         query.search,
    limit,
    offset,
  });

  const countParams  = [];
  const countFilters = ['deleted_at IS NULL'];
  if (institutionId)       countFilters.push(`institution_id = $${countParams.push(institutionId)}`);
  if (semesterTermFilter)  countFilters.push(`semester_term_id = $${countParams.push(semesterTermFilter)}`);
  if (query.departmentId)  countFilters.push(`department_id = $${countParams.push(query.departmentId)}`);
  if (query.academicYearId) countFilters.push(`academic_year_id = $${countParams.push(query.academicYearId)}`);
  if (statusFilter)        countFilters.push(`status = $${countParams.push(statusFilter)}`);
  if (instructorFilter)    countFilters.push(`instructor_id = $${countParams.push(instructorFilter)}`);
  if (query.domainId)      countFilters.push(`domain_id = $${countParams.push(query.domainId)}`);
  if (query.search) {
    const idx = countParams.push(`%${query.search}%`);
    countFilters.push(`(title ILIKE $${idx} OR description ILIKE $${idx})`);
  }

  const { rows: [{ total }] } = await pool.query(
    `SELECT COUNT(*) AS total FROM courses WHERE ${countFilters.join(' AND ')}`,
    countParams,
  );

  return {
    courses: rows.map(mapCourse),
    meta:    buildPaginationMeta(parseInt(total, 10), page, limit),
  };
};

// ── create ────────────────────────────────────────────────────────────────────

exports.create = async (body, actor) => {
  const isSuperAdmin  = actor.roles?.includes('super_admin');
  const institutionId = isSuperAdmin
    ? (body.institutionId ?? actor.institutionId)
    : actor.institutionId;

  // All courses must be scoped to department + academic year + semester term
  const isInstructor = actor.roles?.includes('instructor') && !isSuperAdmin;
  const isAdmin      = isSuperAdmin || actor.roles?.includes('institution_admin');

  if (!body.departmentId) {
    throw ApiError.badRequest('departmentId is required when creating a course.');
  }
  if (!body.academicYearId) {
    throw ApiError.badRequest('academicYearId is required when creating a course.');
  }
  if (!body.semesterTermId) {
    throw ApiError.badRequest('semesterTermId is required when creating a course.');
  }

  // Validate department belongs to institution
  const { rows: [dept] } = await pool.query(
    'SELECT id FROM departments WHERE id = $1 AND institution_id = $2 AND deleted_at IS NULL',
    [body.departmentId, institutionId],
  );
  if (!dept) throw ApiError.badRequest('Department not found or does not belong to this institution.');

  // Validate academic year belongs to that department
  const { rows: [ay] } = await pool.query(
    'SELECT id FROM academic_years WHERE id = $1 AND department_id = $2 AND deleted_at IS NULL',
    [body.academicYearId, body.departmentId],
  );
  if (!ay) throw ApiError.badRequest('Academic year not found or does not belong to the selected department.');

  // Validate semester term belongs to that academic year
  const { rows: [st] } = await pool.query(
    'SELECT id FROM semester_terms WHERE id = $1 AND academic_year_id = $2 AND deleted_at IS NULL',
    [body.semesterTermId, body.academicYearId],
  );
  if (!st) throw ApiError.badRequest('Semester term not found or does not belong to the selected academic year.');

  const course = await CourseModel.create({
    institutionId,
    departmentId:   body.departmentId,
    academicYearId: body.academicYearId,
    semesterTermId: body.semesterTermId,
    termId:         body.termId         ?? null,
    domainId:       body.domainId       ?? null,
    instructorId:   body.instructorId   ?? actor.id,
    code:           body.code           ?? null,
    title:          body.title,
    description:    body.description    ?? null,
    thumbnailUrl:   body.thumbnailUrl   ?? null,
    enrollmentType: body.enrollmentType ?? 'open',
    enrollmentCap:  body.enrollmentCap  ?? null,
    startDate:      body.startDate      ?? null,
    endDate:        body.endDate        ?? null,
    passingGrade:   body.passingGrade   ?? 60,
    settings:       body.settings       ?? {},
    createdBy:      actor.id,
  });

  await AuditModel.log({
    institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'course.create', entityType: 'Course', entityId: course.id,
    delta: { after: { title: course.title, enrollmentType: course.enrollment_type } },
  });

  return mapCourse(course);
};

// ── getOne ────────────────────────────────────────────────────────────────────

exports.getOne = async (id, actor) => {
  const course = await CourseModel.findById(id);
  if (!course) throw ApiError.notFound('Course not found.');
  assertInstitution(course, actor);
  return mapCourse(course);
};

// ── update ────────────────────────────────────────────────────────────────────

exports.update = async (id, body, actor) => {
  const course = await CourseModel.findById(id);
  if (!course) throw ApiError.notFound('Course not found.');
  assertInstitution(course, actor);

  const isAdmin      = actor.roles?.includes('super_admin') || actor.roles?.includes('institution_admin');
  const isInstructor = course.instructor_id === actor.id;
  if (!isAdmin && !isInstructor) {
    throw ApiError.forbidden('Only the course instructor or an admin can edit this course.');
  }

  // Validate department belongs to the same institution when changing it
  if (body.departmentId && body.departmentId !== course.department_id) {
    const { rows: [dept] } = await pool.query(
      'SELECT id FROM departments WHERE id = $1 AND institution_id = $2 AND deleted_at IS NULL',
      [body.departmentId, course.institution_id],
    );
    if (!dept) throw ApiError.badRequest('Department not found or does not belong to this institution.');
  }

  const before  = { title: course.title, status: course.status };
  const updated = await CourseModel.update(id, {
    title:           body.title,
    description:     body.description,
    thumbnail_url:   body.thumbnailUrl,
    enrollment_type: body.enrollmentType,
    enrollment_cap:  body.enrollmentCap,
    start_date:      body.startDate,
    end_date:        body.endDate,
    passing_grade:   body.passingGrade,
    settings:        body.settings,
    domain_id:       body.domainId,
    instructor_id:   body.instructorId,
    department_id:   body.departmentId,
    term_id:         body.termId,
  });

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'course.update', entityType: 'Course', entityId: id,
    delta: { before, after: { title: updated?.title, status: updated?.status } },
  });

  return mapCourse(updated);
};

// ── remove ────────────────────────────────────────────────────────────────────

exports.remove = async (id, actor) => {
  const course = await CourseModel.findById(id);
  if (!course) throw ApiError.notFound('Course not found.');
  assertInstitution(course, actor);

  await CourseModel.softDelete(id);

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'course.delete', entityType: 'Course', entityId: id,
    delta: { before: { title: course.title, status: course.status } },
  });
};

// ── publish ───────────────────────────────────────────────────────────────────

exports.publish = async (id, actor) => {
  const course = await CourseModel.findById(id);
  if (!course) throw ApiError.notFound('Course not found.');
  assertInstitution(course, actor);

  if (course.status === 'published') throw ApiError.conflict('Course is already published.');
  if (course.status === 'archived')  throw ApiError.badRequest('Cannot publish an archived course. Restore it first.');

  const updated = await CourseModel.update(id, {
    status:       'published',
    published_at: new Date().toISOString(),
  });

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'course.publish', entityType: 'Course', entityId: id,
    delta: { before: { status: course.status }, after: { status: 'published' } },
  });

  // Notify enrolled students (SRS §7.5 step 9)
  notifyAsync('course.published', { courseId: id, title: updated?.title, institutionId: course.institution_id });

  return mapCourse(updated);
};

// ── archive ───────────────────────────────────────────────────────────────────

exports.archive = async (id, actor) => {
  const course = await CourseModel.findById(id);
  if (!course) throw ApiError.notFound('Course not found.');
  assertInstitution(course, actor);

  if (course.status === 'archived') throw ApiError.conflict('Course is already archived.');

  const updated = await CourseModel.update(id, { status: 'archived' });

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'course.archive', entityType: 'Course', entityId: id,
    delta: { before: { status: course.status }, after: { status: 'archived' } },
  });

  return mapCourse(updated);
};

// ── restore ───────────────────────────────────────────────────────────────────

exports.restore = async (id, actor) => {
  const course = await CourseModel.findById(id);
  if (!course) throw ApiError.notFound('Course not found.');
  assertInstitution(course, actor);

  if (course.status !== 'archived') throw ApiError.conflict('Only archived courses can be restored.');

  const updated = await CourseModel.update(id, { status: 'draft' });

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'course.restore', entityType: 'Course', entityId: id,
    delta: { before: { status: 'archived' }, after: { status: 'draft' } },
  });

  return mapCourse(updated);
};

// ── listEnrollments ───────────────────────────────────────────────────────────

exports.listEnrollments = async (id, query, actor) => {
  const { page, limit, offset } = parsePagination(query);

  // Scope: validate course belongs to actor's institution before returning enrollment data
  const course = await CourseModel.findById(id);
  if (!course) throw ApiError.notFound('Course not found.');
  assertInstitution(course, actor);

  const rows = await CourseModel.listEnrollments(id, {
    role:   query.role,
    status: query.status,
    limit,
    offset,
  });

  const countParams  = [id];
  const countFilters = ['course_id = $1'];
  if (query.role)   countFilters.push(`role = $${countParams.push(query.role)}`);
  if (query.status) countFilters.push(`status = $${countParams.push(query.status)}`);

  const { rows: [{ total }] } = await pool.query(
    `SELECT COUNT(*) AS total FROM enrollments WHERE ${countFilters.join(' AND ')}`,
    countParams,
  );

  return {
    enrollments: rows.map(mapEnrollment),
    meta:        buildPaginationMeta(parseInt(total, 10), page, limit),
  };
};

// ── enroll ────────────────────────────────────────────────────────────────────
// SRS §7.2: check mode → verify not full → check existing → insert → init progress → audit → notify

exports.enroll = async (id, body, actor) => {
  const course = await CourseModel.findById(id);
  if (!course) throw ApiError.notFound('Course not found.');
  if (course.status !== 'published') throw ApiError.badRequest('Only published courses accept enrollments.');

  const isSuperAdmin = actor.roles?.includes('super_admin');
  const isAdmin      = isSuperAdmin || actor.roles?.includes('institution_admin');
  const isInstructor = actor.roles?.includes('instructor') || actor.roles?.includes('teaching_assistant');

  const targetUserId = body.userId ?? actor.id;
  const isSelfEnroll = targetUserId === actor.id;

  // 1. Institution isolation (SRS §4.4 INST-01)
  if (!isSuperAdmin && course.institution_id !== actor.institutionId) {
    throw ApiError.forbidden('You can only enroll in courses within your institution.');
  }

  // 1b. Students can only enroll in courses that match their current semester term
  const isStudentRole = actor.roles?.includes('student') && isSelfEnroll;
  if (isStudentRole && course.semester_term_id) {
    const { rows: [assignment] } = await pool.query(
      `SELECT semester_term_id FROM user_academic_assignments
        WHERE user_id = $1 AND role_context = 'student' AND is_current = TRUE LIMIT 1`,
      [actor.id],
    );
    if (!assignment || assignment.semester_term_id !== course.semester_term_id) {
      throw ApiError.forbidden(
        'You can only enroll in courses that belong to your assigned semester term.',
      );
    }
  }

  // 2. Permission to enroll another user
  if (!isSelfEnroll) {
    if (!isAdmin && !isInstructor) {
      throw ApiError.forbidden('Only admins and instructors can enroll other users.');
    }
    const { rows: [targetUser] } = await pool.query(
      'SELECT institution_id FROM users WHERE id = $1 AND deleted_at IS NULL',
      [targetUserId],
    );
    if (!targetUser) throw ApiError.notFound('Target user not found.');
    if (!isSuperAdmin && targetUser.institution_id !== actor.institutionId) {
      throw ApiError.forbidden('Target user belongs to a different institution.');
    }
  }

  // 3. Enrollment type enforcement (SRS CRS-04)
  let status = 'pending';
  const enrollmentType = course.enrollment_type;

  if (enrollmentType === 'open') {
    status = 'active';
  } else if (enrollmentType === 'approval') {
    status = 'pending';
  } else if (enrollmentType === 'code') {
    const courseCode = course.settings?.enrollmentCode;
    if (!courseCode) throw ApiError.badRequest('This course has no enrollment code configured.');
    if (body.enrollmentCode !== courseCode) throw ApiError.badRequest('Invalid enrollment code.');
    status = 'active';
  } else if (enrollmentType === 'admin') {
    if (!isAdmin) throw ApiError.forbidden('Only admins can enroll users in this course.');
    status = 'active';
  }

  // Admin enrolling another user always activates immediately
  if (!isSelfEnroll && isAdmin) status = 'active';

  const role = body.role ?? 'student';

  // 4. Duplicate check
  const existing = await CourseModel.findEnrollment(id, targetUserId);
  if (existing) {
    if (existing.status === 'active')  throw ApiError.conflict('User is already enrolled in this course.');
    if (existing.status === 'pending') throw ApiError.conflict('User already has a pending enrollment request.');
    // dropped / rejected — upsert will reactivate
  }

  // 5. Cap check — active + pending seats (SRS CRS-04)
  if (role === 'student' && course.enrollment_cap !== null) {
    const { rows: [{ total }] } = await pool.query(
      `SELECT COUNT(*) AS total FROM enrollments
       WHERE course_id = $1 AND status IN ('active','pending') AND role = 'student'`,
      [id],
    );
    if (parseInt(total, 10) >= course.enrollment_cap) {
      throw ApiError.badRequest(`Course is full (cap: ${course.enrollment_cap}).`);
    }
  }

  // 6. Insert / upsert enrollment
  const enrollment = await CourseModel.enroll({ courseId: id, userId: targetUserId, role, status });

  // 7. Initialize progress for active enrollments
  if (status === 'active') {
    await initProgress(id, targetUserId);
  }

  // 8. Audit log
  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'course.enroll', entityType: 'Enrollment', entityId: id,
    delta: { after: { userId: targetUserId, role, status, enrollmentType } },
  });

  // 9. Notification hooks (SRS §7.2 step 6)
  notifyAsync('enrollment.confirmed', { courseId: id, userId: targetUserId, status, enrollmentType });
  if (enrollmentType === 'approval' && isSelfEnroll) {
    notifyAsync('enrollment.pending_approval', { courseId: id, userId: targetUserId, instructorId: course.instructor_id });
  }

  return mapEnrollment(enrollment);
};

// ── approveEnrollment ─────────────────────────────────────────────────────────

exports.approveEnrollment = async (id, targetUserId, actor) => {
  const course = await CourseModel.findById(id);
  if (!course) throw ApiError.notFound('Course not found.');
  assertInstitution(course, actor);

  const isAdmin      = actor.roles?.includes('super_admin') || actor.roles?.includes('institution_admin');
  const isInstructor = course.instructor_id === actor.id;
  if (!isAdmin && !isInstructor) {
    throw ApiError.forbidden('Only admins and the course instructor can approve enrollments.');
  }

  const existing = await CourseModel.findEnrollment(id, targetUserId);
  if (!existing) throw ApiError.notFound('Enrollment not found.');
  if (existing.status !== 'pending') {
    throw ApiError.badRequest(`Cannot approve an enrollment with status '${existing.status}'.`);
  }

  // Cap check before activating
  if (existing.role === 'student' && course.enrollment_cap !== null) {
    const { rows: [{ total }] } = await pool.query(
      `SELECT COUNT(*) AS total FROM enrollments
       WHERE course_id = $1 AND status = 'active' AND role = 'student'`,
      [id],
    );
    if (parseInt(total, 10) >= course.enrollment_cap) {
      throw ApiError.badRequest(`Course is full (cap: ${course.enrollment_cap}). Cannot approve.`);
    }
  }

  const updated = await CourseModel.updateEnrollment(id, targetUserId, { status: 'active' });
  await initProgress(id, targetUserId);

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'course.enroll_approve', entityType: 'Enrollment', entityId: id,
    delta: { before: { status: 'pending' }, after: { status: 'active', userId: targetUserId } },
  });

  // Notify student that enrollment was approved (SRS §7.2)
  notifyAsync('enrollment.approved', { courseId: id, userId: targetUserId });

  return mapEnrollment(updated);
};

// ── unenroll ──────────────────────────────────────────────────────────────────

exports.unenroll = async (id, targetUserId, actor) => {
  const course = await CourseModel.findById(id);
  if (!course) throw ApiError.notFound('Course not found.');
  assertInstitution(course, actor);

  const existing = await CourseModel.findEnrollment(id, targetUserId);
  if (!existing) throw ApiError.notFound('Enrollment not found.');

  const isSelf       = targetUserId === actor.id;
  const isAdmin      = actor.roles?.includes('super_admin') || actor.roles?.includes('institution_admin');
  const isInstructor = course.instructor_id === actor.id;

  if (!isSelf && !isAdmin && !isInstructor) {
    throw ApiError.forbidden('You do not have permission to remove this enrollment.');
  }

  // pending → rejected  |  active/other → dropped
  const newStatus = existing.status === 'pending' ? 'rejected' : 'dropped';
  await CourseModel.updateEnrollment(id, targetUserId, { status: newStatus });

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'course.unenroll', entityType: 'Enrollment', entityId: id,
    delta: { before: { status: existing.status }, after: { status: newStatus, userId: targetUserId } },
  });
};

// ── myEnrollment ──────────────────────────────────────────────────────────────
// Returns the current actor's enrollment record, or 404 if not enrolled.

exports.myEnrollment = async (id, actor) => {
  const course = await CourseModel.findById(id);
  if (!course) throw ApiError.notFound('Course not found.');

  const enrollment = await CourseModel.findEnrollment(id, actor.id);
  if (!enrollment) throw ApiError.notFound('Not enrolled.');

  return mapEnrollment(enrollment);
};

// ── clone ─────────────────────────────────────────────────────────────────────
// CRS-03 (Should): creates a draft copy of a course within the same institution.
// Module/lesson content copy: TODO when ModuleModel is implemented (CRS-03 full scope).

exports.clone = async (id, body, actor) => {
  const source = await CourseModel.findById(id);
  if (!source) throw ApiError.notFound('Course not found.');
  assertInstitution(source, actor);

  const isAdmin      = actor.roles?.includes('super_admin') || actor.roles?.includes('institution_admin');
  const isInstructor = source.instructor_id === actor.id;
  if (!isAdmin && !isInstructor) {
    throw ApiError.forbidden('Only the course instructor or an admin can clone this course.');
  }

  const cloned = await CourseModel.create({
    institutionId:  source.institution_id,
    departmentId:   source.department_id   ?? null,
    termId:         source.term_id         ?? null,
    domainId:       source.domain_id       ?? null,
    instructorId:   actor.id,
    code:           null,
    title:          body.title ?? `Copy of ${source.title}`,
    description:    source.description     ?? null,
    thumbnailUrl:   source.thumbnail_url   ?? null,
    enrollmentType: source.enrollment_type,
    enrollmentCap:  source.enrollment_cap  ?? null,
    startDate:      null,
    endDate:        null,
    passingGrade:   source.passing_grade,
    settings:       source.settings        ?? {},
    createdBy:      actor.id,
  });

  // TODO(CRS-03): copy modules and lessons from source course

  await AuditModel.log({
    institutionId: source.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'course.clone', entityType: 'Course', entityId: cloned.id,
    delta: { after: { sourceId: id, title: cloned.title } },
  });

  return mapCourse(cloned);
};

// ── getCourseCatalogs ─────────────────────────────────────────────────────────
// Returns the simulation catalog tree visible to this course's department.
// Used by the course builder to display which catalogs to filter simulations from.

exports.getCourseCatalogs = async (id, actor) => {
  const course = await CourseModel.findById(id);
  if (!course) throw ApiError.notFound('Course not found.');
  assertInstitution(course, actor);

  if (!course.department_id) return [];

  // Lazy require — avoids a circular dependency at module load time
  const catalogSvc = require('../simulation-catalogs/catalog.service');
  return catalogSvc.getDepartmentCatalogTree(course.department_id, actor);
};

// ── getCourseSimulations ──────────────────────────────────────────────────────
// Returns simulations available for use in this course's lessons.
// If the course has a department, returns only simulations from its assigned catalogs.
// Without a department, falls back to all institution-assigned catalog simulations.

function mapSim(row) {
  return {
    id:               row.id,
    title:            row.title,
    description:      row.description        ?? null,
    type:             row.type,
    launchUrl:        row.launch_url         ?? null,
    thumbnailUrl:     row.thumbnail_url      ?? null,
    estimatedMinutes: row.estimated_minutes  ?? null,
    difficulty:       row.difficulty         ?? 'intermediate',
    maxScore:         row.max_score          ?? 100,
    passScore:        row.pass_score         ?? 70,
    maxAttempts:      row.max_attempts       ?? 3,
    status:           row.status,
    visibility:       row.visibility,
    version:          row.version            ?? '1.0.0',
  };
}

exports.getCourseSimulations = async (id, actor) => {
  const course = await CourseModel.findById(id);
  if (!course) throw ApiError.notFound('Course not found.');
  assertInstitution(course, actor);

  if (course.department_id) {
    // Department-scoped: only simulations from catalogs assigned to the department
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (s.title, s.id) s.id, s.title, s.description, s.type,
              s.launch_url, s.thumbnail_url, s.estimated_minutes, s.difficulty,
              s.max_score, s.pass_score, s.max_attempts, s.status, s.visibility, s.version
         FROM simulations s
         JOIN simulation_catalog_items sci ON sci.simulation_id = s.id
         JOIN simulation_catalogs sc ON sc.id = sci.catalog_id AND sc.deleted_at IS NULL
         JOIN department_simulation_catalogs dsc ON dsc.department_id = $1
         JOIN simulation_catalogs ac ON ac.id = dsc.simulation_catalog_id AND ac.deleted_at IS NULL
        WHERE s.deleted_at IS NULL
          AND s.status != 'deprecated'
          AND (
            dsc.simulation_catalog_id = sci.catalog_id
            OR (dsc.include_subtree = TRUE
                AND (sc.path = ac.path OR sc.path LIKE ac.path || '/%'))
          )
        ORDER BY s.title, s.id`,
      [course.department_id],
    );
    return rows.map(mapSim);
  }

  // Institution-scoped fallback
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (s.title, s.id) s.id, s.title, s.description, s.type,
            s.launch_url, s.thumbnail_url, s.estimated_minutes, s.difficulty,
            s.max_score, s.pass_score, s.max_attempts, s.status, s.visibility, s.version
       FROM simulations s
       JOIN simulation_catalog_items sci ON sci.simulation_id = s.id
       JOIN simulation_catalogs sc ON sc.id = sci.catalog_id AND sc.deleted_at IS NULL
       JOIN institution_simulation_catalogs isc ON isc.institution_id = $1
       JOIN simulation_catalogs ac ON ac.id = isc.simulation_catalog_id AND ac.deleted_at IS NULL
      WHERE s.deleted_at IS NULL
        AND s.status != 'deprecated'
        AND (
          isc.simulation_catalog_id = sci.catalog_id
          OR (isc.include_subtree = TRUE
              AND (sc.path = ac.path OR sc.path LIKE ac.path || '/%'))
        )
      ORDER BY s.title, s.id`,
    [course.institution_id],
  );
  return rows.map(mapSim);
};
