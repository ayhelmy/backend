'use strict';

/**
 * Modules & Lessons service — SRS §4.6 MOD-01 to MOD-08; §4.15 CMS-01 to CMS-04.
 * Migration 028: lesson_mode (content|simulation|content_and_simulation),
 *   content_type, catalog_id, lesson_completions.
 * Institution isolation: every write op asserts course belongs to actor's institution.
 * Prerequisite lock (MOD-06): module is locked until prereq module is completed.
 * Timed release (MOD-07): module visible only after unlock_at timestamp.
 */

const { ModuleModel, CourseModel, AuditModel, SimulationCatalogModel, SimulationModel } = require('../../db/models');
const ApiError = require('../../utils/apiError');

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAdmin(actor) {
  return actor.roles?.includes('super_admin') || actor.roles?.includes('institution_admin');
}

function canManageCourse(course, actor) {
  if (actor.roles?.includes('super_admin')) return true;
  if (actor.roles?.includes('institution_admin') && course.institution_id === actor.institutionId) return true;
  const isOwner = course.instructor_id === actor.id;
  const isTA    = actor.roles?.includes('teaching_assistant');
  return (isOwner || isTA) && course.institution_id === actor.institutionId;
}

function assertRead(course, actor) {
  if (actor.roles?.includes('super_admin')) return;
  if (course.institution_id !== actor.institutionId) throw ApiError.forbidden('Access denied.');
}

function assertWrite(course, actor) {
  if (!canManageCourse(course, actor)) {
    throw ApiError.forbidden('Only the course instructor or an admin can modify this course.');
  }
}

/**
 * Ensure a simulation is accessible to the actor for the given course.
 * Access chain: super_admin → demo_public → dept catalog → institution catalog.
 */
async function assertSimulationAccess(simulationId, course, actor) {
  const sim = await SimulationModel.findById(simulationId);
  if (!sim || sim.status === 'deprecated') {
    throw ApiError.badRequest(`Simulation "${simulationId}" not found or deprecated.`);
  }

  if (actor.roles?.includes('super_admin')) return;
  if (sim.visibility === 'demo_public') return;

  if (course.department_id) {
    const allowed = await SimulationCatalogModel.isSimulationAllowedForDepartment(
      simulationId, course.department_id,
    );
    if (!allowed) {
      throw ApiError.forbidden(
        'This simulation is not available for the course department. ' +
        'Assign its catalog to this department first.',
      );
    }
    return;
  }

  const assigned = await SimulationCatalogModel.isSimulationAssignedToInstitution(
    simulationId, course.institution_id,
  );
  if (!assigned) {
    throw ApiError.forbidden(
      'Simulation is not available for this institution. ' +
      'Add it to an assigned catalog first.',
    );
  }
}

// Maps new content_type values to old type column values (backward compat).
function contentTypeToLegacyType(contentType) {
  const map = {
    rich_text: 'text',
    video:     'video',
    file:      'file',
    url:       'url',
    scorm:     'scorm',
  };
  return map[contentType] ?? 'text';
}

// Maps old type values to new content_type (for legacy clients).
function legacyTypeToContentType(type) {
  const map = {
    text:       'rich_text',
    video:      'video',
    file:       'file',
    url:        'url',
    scorm:      'scorm',
    simulation: null,
  };
  return map[type] ?? null;
}

/** Normalise lesson content payload per content_type (CMS-01). */
function buildLessonContent(contentType, raw = {}) {
  switch (contentType) {
    case 'rich_text': return { body: raw.body ?? '' };
    case 'text':      return { body: raw.body ?? '' };      // legacy alias
    case 'video':     return { url: raw.url ?? '', duration_sec: raw.duration_sec ?? null };
    case 'file':      return { url: raw.url ?? '', mime_type: raw.mime_type ?? 'application/octet-stream', file_name: raw.file_name ?? '' };
    case 'url':       return { url: raw.url ?? '' };
    case 'scorm':     return { package_url: raw.package_url ?? '', scorm_version: raw.scorm_version ?? '1.2' };
    default:          return raw;
  }
}

// ── Mappers ───────────────────────────────────────────────────────────────────

function mapModule(row) {
  if (!row) return null;
  return {
    id:                   row.id,
    courseId:             row.course_id,
    title:                row.title,
    description:          row.description           ?? null,
    position:             row.position,
    isPublished:          row.is_published,
    unlockAt:             row.unlock_at             ?? null,
    prerequisiteModuleId: row.prerequisite_module_id ?? null,
    createdAt:            row.created_at,
    updatedAt:            row.updated_at            ?? null,
  };
}

function mapLesson(row) {
  if (!row) return null;
  return {
    id:               row.id,
    moduleId:         row.module_id,
    courseId:         row.course_id        ?? null,
    institutionId:    row.institution_id   ?? null,
    departmentId:     row.department_id    ?? null,
    title:            row.title,
    lessonMode:       row.lesson_mode,
    contentType:      row.content_type     ?? null,
    type:             row.type,            // legacy field kept for backward compat
    content:          row.content          ?? {},
    simulationId:     row.simulation_id    ?? null,
    catalogId:        row.catalog_id       ?? null,
    position:         row.position,
    estimatedMinutes: row.estimated_minutes ?? null,
    isRequired:       row.is_required,
    isPublished:      row.is_published,
    createdAt:        row.created_at,
    updatedAt:        row.updated_at       ?? null,
  };
}

// ── listModules ───────────────────────────────────────────────────────────────

exports.listModules = async (courseId, actor) => {
  const course = await CourseModel.findById(courseId);
  if (!course) throw ApiError.notFound('Course not found.');
  assertRead(course, actor);

  const modules = await ModuleModel.listByCourse(courseId);

  if (isAdmin(actor) || course.instructor_id === actor.id) {
    return modules.map(mapModule);
  }

  // Students: only published modules, respecting timed release
  const now = new Date();
  return modules.filter(m => {
    if (!m.is_published) return false;
    if (m.unlock_at && new Date(m.unlock_at) > now) return false;
    return true;
  }).map(mapModule);
};

// ── getCourseTree ─────────────────────────────────────────────────────────────

exports.getCourseTree = async (courseId, actor) => {
  const course = await CourseModel.findById(courseId);
  if (!course) throw ApiError.notFound('Course not found.');
  assertRead(course, actor);

  const rows = await ModuleModel.getCourseTree(courseId);
  const canEdit = isAdmin(actor) || course.instructor_id === actor.id;
  const now = new Date();

  // Group flat JOIN rows into modules with nested lesson arrays
  const moduleMap = new Map();

  for (const row of rows) {
    if (!moduleMap.has(row.module_id)) {
      moduleMap.set(row.module_id, {
        id:                   row.module_id,
        courseId,
        title:                row.module_title,
        description:          row.module_description ?? null,
        position:             row.module_position,
        isPublished:          row.module_is_published,
        unlockAt:             row.module_unlock_at    ?? null,
        prerequisiteModuleId: row.prerequisite_module_id ?? null,
        lessons:              [],
      });
    }

    if (row.lesson_id) {
      const lessonPublished = row.lesson_is_published;
      if (!canEdit && !lessonPublished) continue;

      moduleMap.get(row.module_id).lessons.push({
        id:               row.lesson_id,
        moduleId:         row.module_id,
        title:            row.lesson_title,
        lessonMode:       row.lesson_mode,
        contentType:      row.content_type   ?? null,
        type:             row.legacy_type,
        simulationId:     row.simulation_id  ?? null,
        catalogId:        row.catalog_id     ?? null,
        position:         row.lesson_position,
        estimatedMinutes: row.estimated_minutes ?? null,
        isRequired:       row.is_required,
        isPublished:      row.lesson_is_published,
      });
    }
  }

  let modules = Array.from(moduleMap.values());

  if (!canEdit) {
    modules = modules.filter(m => {
      if (!m.isPublished) return false;
      if (m.unlockAt && new Date(m.unlockAt) > now) return false;
      return true;
    });
  }

  return modules;
};

// ── createModule ──────────────────────────────────────────────────────────────

exports.createModule = async (courseId, body, actor) => {
  const course = await CourseModel.findById(courseId);
  if (!course) throw ApiError.notFound('Course not found.');
  assertWrite(course, actor);

  if (body.prerequisiteModuleId) {
    const prereq = await ModuleModel.findById(body.prerequisiteModuleId);
    if (!prereq || prereq.course_id !== courseId) {
      throw ApiError.badRequest('Prerequisite module does not belong to this course.');
    }
  }

  const existing = await ModuleModel.listByCourse(courseId);
  const position = body.position ?? existing.length;

  const mod = await ModuleModel.create({
    courseId,
    title:                body.title,
    description:          body.description         ?? null,
    position,
    isPublished:          body.isPublished          ?? false,
    unlockAt:             body.unlockAt             ?? null,
    prerequisiteModuleId: body.prerequisiteModuleId ?? null,
  });

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'module.create', entityType: 'Module', entityId: mod.id,
    delta: { after: { courseId, title: mod.title, position } },
  });

  return mapModule(mod);
};

// ── getModule ─────────────────────────────────────────────────────────────────

exports.getModule = async (moduleId, actor) => {
  const mod = await ModuleModel.findById(moduleId);
  if (!mod) throw ApiError.notFound('Module not found.');

  const course = await CourseModel.findById(mod.course_id);
  assertRead(course, actor);

  return mapModule(mod);
};

// ── updateModule ──────────────────────────────────────────────────────────────

exports.updateModule = async (moduleId, body, actor) => {
  const mod = await ModuleModel.findById(moduleId);
  if (!mod) throw ApiError.notFound('Module not found.');

  const course = await CourseModel.findById(mod.course_id);
  assertWrite(course, actor);

  if (body.prerequisiteModuleId) {
    if (body.prerequisiteModuleId === moduleId) {
      throw ApiError.badRequest('A module cannot be its own prerequisite.');
    }
    const prereq = await ModuleModel.findById(body.prerequisiteModuleId);
    if (!prereq || prereq.course_id !== mod.course_id) {
      throw ApiError.badRequest('Prerequisite module does not belong to this course.');
    }
  }

  const before = { title: mod.title, isPublished: mod.is_published };

  const fields = {};
  if (body.title             !== undefined) fields.title                  = body.title;
  if (body.description       !== undefined) fields.description            = body.description;
  if (body.isPublished       !== undefined) fields.is_published           = body.isPublished;
  if (body.unlockAt          !== undefined) fields.unlock_at              = body.unlockAt;
  if ('prerequisiteModuleId' in body)       fields.prerequisite_module_id = body.prerequisiteModuleId;

  const updated = await ModuleModel.update(moduleId, fields);

  const lockChanged = body.unlockAt !== undefined || 'prerequisiteModuleId' in body;
  if (lockChanged) {
    await AuditModel.log({
      institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
      action: 'module.lock_settings_changed', entityType: 'Module', entityId: moduleId,
      delta: {
        before: { unlockAt: mod.unlock_at, prerequisiteModuleId: mod.prerequisite_module_id },
        after:  { unlockAt: updated?.unlock_at, prerequisiteModuleId: updated?.prerequisite_module_id },
      },
    });
  } else {
    await AuditModel.log({
      institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
      action: 'module.update', entityType: 'Module', entityId: moduleId,
      delta: { before, after: { title: updated?.title, isPublished: updated?.is_published } },
    });
  }

  return mapModule(updated);
};

// ── removeModule ──────────────────────────────────────────────────────────────

exports.removeModule = async (moduleId, actor) => {
  const mod = await ModuleModel.findById(moduleId);
  if (!mod) throw ApiError.notFound('Module not found.');

  const course = await CourseModel.findById(mod.course_id);
  assertWrite(course, actor);

  await ModuleModel.delete(moduleId);   // CASCADE removes lessons

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'module.delete', entityType: 'Module', entityId: moduleId,
    delta: { before: { title: mod.title, courseId: mod.course_id } },
  });
};

// ── reorderModules ────────────────────────────────────────────────────────────

exports.reorderModules = async (courseId, order, actor) => {
  const course = await CourseModel.findById(courseId);
  if (!course) throw ApiError.notFound('Course not found.');
  assertWrite(course, actor);

  if (!Array.isArray(order)) throw ApiError.badRequest('order must be an array of UUIDs.');

  await ModuleModel.reorder(courseId, order);

  return (await ModuleModel.listByCourse(courseId)).map(mapModule);
};

// ── listLessons ───────────────────────────────────────────────────────────────

exports.listLessons = async (moduleId, actor) => {
  const mod = await ModuleModel.findById(moduleId);
  if (!mod) throw ApiError.notFound('Module not found.');

  const course = await CourseModel.findById(mod.course_id);
  assertRead(course, actor);

  const lessons = await ModuleModel.listLessonsByModule(moduleId);

  if (isAdmin(actor) || course.instructor_id === actor.id) {
    return lessons.map(mapLesson);
  }

  return lessons.filter(l => l.is_published).map(mapLesson);
};

// ── getLesson ─────────────────────────────────────────────────────────────────

exports.getLesson = async (lessonId, actor) => {
  const lesson = await ModuleModel.findLessonById(lessonId);
  if (!lesson) throw ApiError.notFound('Lesson not found.');

  const mod    = await ModuleModel.findById(lesson.module_id);
  const course = await CourseModel.findById(mod.course_id);
  assertRead(course, actor);

  const canEdit = isAdmin(actor) || course.instructor_id === actor.id;

  if (!canEdit && !lesson.is_published) {
    throw ApiError.forbidden('This lesson is not yet published.');
  }

  return { ...mapLesson(lesson), courseId: course.id, moduleTitle: mod.title };
};

// ── createLesson ──────────────────────────────────────────────────────────────

exports.createLesson = async (moduleId, body, actor) => {
  const mod = await ModuleModel.findById(moduleId);
  if (!mod) throw ApiError.notFound('Module not found.');

  const course = await CourseModel.findById(mod.course_id);
  assertWrite(course, actor);

  // Resolve lesson_mode — accept new field or derive from legacy type
  const lessonMode = body.lessonMode
    ?? (body.type === 'simulation' ? 'simulation' : 'content');

  // Resolve content_type — accept new field or derive from legacy type
  const contentType = body.contentType ?? legacyTypeToContentType(body.type);

  // Resolve simulation
  const simulationId = body.simulationId ?? body.content?.simulation_id ?? null;

  // Validate lesson_mode + required sub-fields
  const hasContent    = lessonMode === 'content' || lessonMode === 'content_and_simulation';
  const hasSimulation = lessonMode === 'simulation' || lessonMode === 'content_and_simulation';

  if (hasContent && !contentType) {
    throw ApiError.badRequest(
      'content_type is required when lesson_mode is "content" or "content_and_simulation".',
    );
  }
  if (hasSimulation && !simulationId) {
    throw ApiError.badRequest(
      'simulationId is required when lesson_mode is "simulation" or "content_and_simulation".',
    );
  }

  // Validate simulation catalog access
  if (simulationId) {
    await assertSimulationAccess(simulationId, course, actor);
  }

  const existing = await ModuleModel.listLessonsByModule(moduleId);
  const position = body.position ?? existing.length;

  const content = hasContent
    ? buildLessonContent(contentType, body.content ?? {})
    : {};

  // Derive legacy type for backward compat column
  const legacyType = hasSimulation && !hasContent
    ? 'simulation'
    : contentTypeToLegacyType(contentType);

  const lesson = await ModuleModel.createLesson({
    moduleId,
    title:            body.title,
    type:             legacyType,
    lessonMode,
    contentType:      hasContent ? contentType : null,
    content,
    simulationId,
    catalogId:        body.catalogId       ?? null,
    courseId:         course.id,
    institutionId:    course.institution_id,
    departmentId:     course.department_id ?? null,
    position,
    estimatedMinutes: body.estimatedMinutes ?? null,
    isRequired:       body.isRequired       ?? true,
    isPublished:      body.isPublished      ?? false,
  });

  if (simulationId) {
    await AuditModel.log({
      institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
      action: 'lesson.simulation_assigned', entityType: 'Lesson', entityId: lesson.id,
      delta: { after: { simulationId, catalogId: body.catalogId ?? null } },
    });
  }

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'lesson.create', entityType: 'Lesson', entityId: lesson.id,
    delta: { after: { moduleId, title: lesson.title, lessonMode, contentType } },
  });

  return mapLesson(lesson);
};

// ── updateLesson ──────────────────────────────────────────────────────────────

exports.updateLesson = async (lessonId, body, actor) => {
  const lesson = await ModuleModel.findLessonById(lessonId);
  if (!lesson) throw ApiError.notFound('Lesson not found.');

  const mod    = await ModuleModel.findById(lesson.module_id);
  const course = await CourseModel.findById(mod.course_id);
  assertWrite(course, actor);

  // Validate simulation access if simulation is being changed
  if (body.simulationId) {
    await assertSimulationAccess(body.simulationId, course, actor);
    await AuditModel.log({
      institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
      action: 'lesson.simulation_assigned', entityType: 'Lesson', entityId: lessonId,
      delta: { after: { simulationId: body.simulationId, catalogId: body.catalogId ?? null } },
    });
  }

  const before = {
    title:       lesson.title,
    lessonMode:  lesson.lesson_mode,
    contentType: lesson.content_type,
    isPublished: lesson.is_published,
  };

  // Effective mode/contentType after update
  const newLessonMode  = body.lessonMode  ?? lesson.lesson_mode;
  const newContentType = body.contentType ?? lesson.content_type;
  const hasContent     = newLessonMode === 'content' || newLessonMode === 'content_and_simulation';

  const fields = {};
  if (body.title            !== undefined) fields.title             = body.title;
  if (body.lessonMode       !== undefined) fields.lesson_mode       = body.lessonMode;
  if (body.contentType      !== undefined) fields.content_type      = body.contentType;
  if (body.content          !== undefined) fields.content           = hasContent
    ? buildLessonContent(newContentType, body.content)
    : {};
  if (body.simulationId     !== undefined) fields.simulation_id     = body.simulationId;
  if (body.catalogId        !== undefined) fields.catalog_id        = body.catalogId;
  if (body.estimatedMinutes !== undefined) fields.estimated_minutes = body.estimatedMinutes;
  if (body.isRequired       !== undefined) fields.is_required       = body.isRequired;
  if (body.isPublished      !== undefined) fields.is_published      = body.isPublished;

  // Keep legacy type column in sync when mode/contentType changes
  if (body.lessonMode !== undefined || body.contentType !== undefined) {
    const hasSimulation = newLessonMode === 'simulation' || newLessonMode === 'content_and_simulation';
    fields.type = hasSimulation && !hasContent
      ? 'simulation'
      : contentTypeToLegacyType(newContentType);
  }

  const updated = await ModuleModel.updateLesson(lessonId, fields);

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'lesson.update', entityType: 'Lesson', entityId: lessonId,
    delta: { before, after: { title: updated?.title, lessonMode: updated?.lesson_mode, isPublished: updated?.is_published } },
  });

  return mapLesson(updated);
};

// ── reorderLessons ────────────────────────────────────────────────────────────

exports.reorderLessons = async (moduleId, order, actor) => {
  const mod = await ModuleModel.findById(moduleId);
  if (!mod) throw ApiError.notFound('Module not found.');

  const course = await CourseModel.findById(mod.course_id);
  assertWrite(course, actor);

  if (!Array.isArray(order)) throw ApiError.badRequest('order must be an array of UUIDs.');

  await ModuleModel.reorderLessons(moduleId, order);

  return (await ModuleModel.listLessonsByModule(moduleId)).map(mapLesson);
};

// ── removeLesson ──────────────────────────────────────────────────────────────

exports.removeLesson = async (lessonId, actor) => {
  const lesson = await ModuleModel.findLessonById(lessonId);
  if (!lesson) throw ApiError.notFound('Lesson not found.');

  const mod    = await ModuleModel.findById(lesson.module_id);
  const course = await CourseModel.findById(mod.course_id);
  assertWrite(course, actor);

  await ModuleModel.deleteLesson(lessonId);

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'lesson.delete', entityType: 'Lesson', entityId: lessonId,
    delta: { before: { title: lesson.title, lessonMode: lesson.lesson_mode, moduleId: lesson.module_id } },
  });
};

// ── markLessonComplete ────────────────────────────────────────────────────────

exports.markLessonComplete = async (lessonId, actor) => {
  const lesson = await ModuleModel.findLessonById(lessonId);
  if (!lesson) throw ApiError.notFound('Lesson not found.');

  const mod    = await ModuleModel.findById(lesson.module_id);
  const course = await CourseModel.findById(mod.course_id);
  assertRead(course, actor);

  if (!lesson.is_published) {
    throw ApiError.forbidden('Cannot mark an unpublished lesson as complete.');
  }

  const courseId = lesson.course_id ?? course.id;

  const completion = await ModuleModel.createLessonCompletion({
    lessonId,
    userId:   actor.id,
    courseId,
  });

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'lesson.complete', entityType: 'Lesson', entityId: lessonId,
    delta: { after: { courseId, userId: actor.id, completedAt: completion.completed_at } },
  });

  return {
    lessonId,
    userId:      actor.id,
    courseId,
    completedAt: completion.completed_at,
  };
};

// ── getCourseJourney ──────────────────────────────────────────────────────────
// Returns the full course journey: ordered published modules with nested
// lessons, per-lesson completion status, simulation metadata, and progress
// summary.  Enforces enrollment for students.
// SRS §4.5 CRS-05; §4.6 MOD-03; §4.8 PRG-01.

exports.getCourseJourney = async (courseId, actor) => {
  const course = await CourseModel.findById(courseId);
  if (!course) throw ApiError.notFound('Course not found.');
  assertRead(course, actor);

  const canEdit   = isAdmin(actor) || course.instructor_id === actor.id;
  const isStudent = actor.roles?.includes('student') && !isAdmin(actor);

  // Students must be actively enrolled
  if (isStudent) {
    const enrollment = await CourseModel.findEnrollment(courseId, actor.id);
    if (!enrollment || enrollment.status !== 'active') {
      throw ApiError.forbidden('You must be enrolled in this course to access the journey.');
    }
  }

  const rows = await ModuleModel.getCourseJourneyTree(courseId, actor.id);
  const now  = new Date();

  // --- Pass 1: build module map with nested lessons ---------------------------

  const moduleMap = new Map();

  for (const row of rows) {
    const modPublished = row.module_is_published;
    if (!canEdit && !modPublished) continue;

    if (!moduleMap.has(row.module_id)) {
      moduleMap.set(row.module_id, {
        id:                   row.module_id,
        courseId,
        title:                row.module_title,
        description:          row.module_description          ?? null,
        position:             row.module_position,
        isPublished:          row.module_is_published,
        unlockAt:             row.module_unlock_at            ?? null,
        prerequisiteModuleId: row.prerequisite_module_id      ?? null,
        isLocked:             false, // computed in pass 2
        lessons:              [],
      });
    }

    if (row.lesson_id) {
      if (!canEdit && !row.lesson_is_published) continue;
      const mod = moduleMap.get(row.module_id);
      if (!mod) continue;

      mod.lessons.push({
        id:               row.lesson_id,
        moduleId:         row.module_id,
        title:            row.lesson_title,
        lessonMode:       row.lesson_mode,
        contentType:      row.content_type        ?? null,
        type:             row.legacy_type,
        content:          row.content             ?? {},
        simulationId:     row.simulation_id       ?? null,
        estimatedMinutes: row.estimated_minutes   ?? null,
        isRequired:       row.is_required,
        isPublished:      row.lesson_is_published,
        isLocked:         false, // computed in pass 2
        completionStatus: row.completed_at ? 'completed' : 'not_started',
        simulation: row.sim_title ? {
          id:               row.simulation_id,
          title:            row.sim_title,
          description:      row.sim_description         ?? null,
          estimatedMinutes: row.sim_estimated_minutes   ?? null,
          difficulty:       row.sim_difficulty          ?? null,
          type:             row.sim_type                ?? null,
          thumbnailUrl:     row.sim_thumbnail_url       ?? null,
          launchType:       row.sim_launch_type         ?? null,
          buildStatus:      row.sim_build_status        ?? null,
        } : null,
      });
    }
  }

  // --- Pass 2: compute lock status -------------------------------------------
  // Module locked if: timed release in future OR prerequisite has incomplete required lessons.
  // Lessons locked if parent module is locked.

  const modules = Array.from(moduleMap.values());

  for (const mod of modules) {
    if (mod.unlockAt && new Date(mod.unlockAt) > now) {
      mod.isLocked = true;
    } else if (mod.prerequisiteModuleId) {
      const prereq = moduleMap.get(mod.prerequisiteModuleId);
      if (prereq) {
        const hasIncomplete = prereq.lessons.some(
          l => l.isRequired && l.completionStatus !== 'completed',
        );
        mod.isLocked = hasIncomplete;
      }
    }

    if (mod.isLocked) {
      mod.lessons.forEach(l => { l.isLocked = true; });
    }
  }

  // --- Progress ---------------------------------------------------------------

  const allLessons      = modules.flatMap(m => m.lessons);
  const totalLessons    = allLessons.length;
  const completedLessons = allLessons.filter(l => l.completionStatus === 'completed').length;
  const percentage      = totalLessons > 0
    ? Math.round((completedLessons / totalLessons) * 100)
    : 0;

  return {
    course: {
      id:               course.id,
      title:            course.title,
      description:      course.description        ?? null,
      departmentId:     course.department_id      ?? null,
      academicYearId:   course.academic_year_id   ?? null,
      semesterTermId:   course.semester_term_id   ?? null,
      status:           course.status,
      departmentName:   course.department_name    ?? null,
      academicYearName: course.academic_year_name ?? null,
      semesterTermName: course.semester_term_name ?? null,
    },
    progress: { percentage, completedLessons, totalLessons },
    modules,
  };
};

// ── getLessonSimulationLaunch ─────────────────────────────────────────────────
// Course-safe launch endpoint: validates enrollment, checks build is ready,
// resolves full launch URL (supports WebGL via request origin), and logs audit.
// SRS §4.7 SIM-01.

exports.getLessonSimulationLaunch = async (courseId, lessonId, actor, req) => {
  if (!actor) throw ApiError.unauthorized('Authentication required.');

  const course = await CourseModel.findById(courseId);
  if (!course) throw ApiError.notFound('Course not found.');
  assertRead(course, actor);

  // Students must be enrolled
  const isStudent = actor.roles?.includes('student');
  if (isStudent) {
    const enrollment = await CourseModel.findEnrollment(courseId, actor.id);
    if (!enrollment || enrollment.status !== 'active') {
      throw ApiError.forbidden('You must be enrolled in this course to launch simulations.');
    }
  }

  const lesson = await ModuleModel.findLessonById(lessonId);
  if (!lesson) throw ApiError.notFound('Lesson not found.');

  // Lesson must belong to this course
  const mod = await ModuleModel.findById(lesson.module_id);
  if (!mod || mod.course_id !== courseId) {
    throw ApiError.notFound('Lesson not found in this course.');
  }

  if (!lesson.simulation_id) {
    throw ApiError.badRequest('This lesson does not have a simulation attached.');
  }

  if (!lesson.is_published) {
    throw ApiError.forbidden('This lesson is not published.');
  }

  const sim = await SimulationModel.findById(lesson.simulation_id);
  if (!sim) throw ApiError.notFound('Simulation not found.');
  if (sim.status !== 'active') throw ApiError.badRequest('This simulation is not currently active.');

  // WebGL build readiness check
  if (sim.launch_type === 'webgl' && sim.build_status !== 'ready') {
    throw ApiError.badRequest(
      `Simulation build is not ready (status: ${sim.build_status ?? 'unknown'}).`,
    );
  }

  const launchUrl = sim.launch_type === 'webgl' && sim.public_entry_url
    ? `${req.protocol}://${req.get('host')}${sim.public_entry_url}`
    : sim.launch_url;

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'simulation.launch', entityType: 'Simulation', entityId: sim.id,
    delta: { after: { courseId, lessonId, simulationId: sim.id, launchType: sim.launch_type } },
  });

  return {
    launchUrl,
    simulationId:  sim.id,
    buildUuid:     sim.build_uuid     ?? null,
    launchType:    sim.launch_type    ?? sim.type,
    buildStatus:   sim.build_status   ?? null,
    title:         sim.title,
    description:   sim.description   ?? null,
    difficulty:    sim.difficulty     ?? null,
    estimatedMinutes: sim.estimated_minutes ?? null,
  };
};

// ── validateSimulation ────────────────────────────────────────────────────────
// Returns the simulation if it is accessible for the given course; throws if not.

exports.validateSimulation = async (courseId, simulationId, actor) => {
  const course = await CourseModel.findById(courseId);
  if (!course) throw ApiError.notFound('Course not found.');

  await assertSimulationAccess(simulationId, course, actor);

  const sim = await SimulationModel.findById(simulationId);
  return {
    simulationId:  sim.id,
    title:         sim.title,
    type:          sim.type,
    difficulty:    sim.difficulty,
    status:        sim.status,
    visibility:    sim.visibility,
    isAllowed:     true,
  };
};
