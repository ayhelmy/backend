/**
 * Module and Lesson model — query helpers.
 * SRS §4.6 MOD-01 – MOD-08; §9 course_modules + lessons schema.
 * Migration 028 adds: lesson_mode, content_type, catalog_id, course_id,
 *   institution_id, department_id, and lesson_completions table.
 */
'use strict';

const { pool } = require('../../config/database');

// Columns returned by all lesson SELECT queries.
const LESSON_COLS = `
  id, module_id, course_id, institution_id, department_id,
  title, type, lesson_mode, content_type, content,
  simulation_id, catalog_id,
  position, estimated_minutes, is_required, is_published,
  created_at, updated_at
`;

const ModuleModel = {
  async findById(id) {
    const { rows } = await pool.query(
      `SELECT id, course_id, title, description, position, is_published,
              unlock_at, prerequisite_module_id, created_at, updated_at
         FROM course_modules WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async listByCourse(courseId) {
    const { rows } = await pool.query(
      `SELECT id, course_id, title, description, position, is_published,
              unlock_at, prerequisite_module_id, created_at, updated_at
         FROM course_modules WHERE course_id = $1 ORDER BY position`,
      [courseId],
    );
    return rows;
  },

  async create({ courseId, title, description, position, isPublished, unlockAt, prerequisiteModuleId }) {
    const { rows } = await pool.query(
      `INSERT INTO course_modules
         (course_id, title, description, position, is_published, unlock_at, prerequisite_module_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [courseId, title, description ?? null, position ?? 0,
       isPublished ?? false, unlockAt ?? null, prerequisiteModuleId ?? null],
    );
    return rows[0];
  },

  async update(id, fields) {
    const allowed = ['title','description','position','is_published','unlock_at','prerequisite_module_id'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        params.push(fields[key]);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (sets.length === 0) return this.findById(id);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE course_modules SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  },

  async delete(id) {
    const { rows } = await pool.query(
      `DELETE FROM course_modules WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows[0] ?? null;
  },

  // ------------------------------------------------------------------
  // Course tree — modules with nested lessons in one query
  // ------------------------------------------------------------------

  /**
   * Journey variant: same as getCourseTree but also joins lesson_completions
   * (for a specific user) and simulations (for metadata). Includes ALL rows —
   * filtering/locking logic is handled in the service layer.
   */
  async getCourseJourneyTree(courseId, userId) {
    const { rows } = await pool.query(
      `SELECT
         cm.id                       AS module_id,
         cm.title                    AS module_title,
         cm.description              AS module_description,
         cm.position                 AS module_position,
         cm.is_published             AS module_is_published,
         cm.unlock_at                AS module_unlock_at,
         cm.prerequisite_module_id,
         l.id                        AS lesson_id,
         l.title                     AS lesson_title,
         l.lesson_mode,
         l.content_type,
         l.type                      AS legacy_type,
         l.content,
         l.simulation_id,
         l.catalog_id,
         l.position                  AS lesson_position,
         l.estimated_minutes,
         l.is_required,
         l.is_published              AS lesson_is_published,
         lc.completed_at,
         sim.title                   AS sim_title,
         sim.description             AS sim_description,
         sim.estimated_minutes       AS sim_estimated_minutes,
         sim.difficulty              AS sim_difficulty,
         sim.type                    AS sim_type,
         sim.thumbnail_url           AS sim_thumbnail_url,
         sim.launch_type             AS sim_launch_type,
         sim.build_status            AS sim_build_status
       FROM course_modules cm
       LEFT JOIN lessons l ON l.module_id = cm.id
       LEFT JOIN lesson_completions lc
              ON lc.lesson_id = l.id AND lc.user_id = $2
       LEFT JOIN simulations sim ON sim.id = l.simulation_id
       WHERE cm.course_id = $1
       ORDER BY cm.position, l.position`,
      [courseId, userId],
    );
    return rows;
  },

  async getCourseTree(courseId) {
    const { rows } = await pool.query(
      `SELECT
         cm.id                    AS module_id,
         cm.title                 AS module_title,
         cm.description           AS module_description,
         cm.position              AS module_position,
         cm.is_published          AS module_is_published,
         cm.unlock_at             AS module_unlock_at,
         cm.prerequisite_module_id,
         l.id                     AS lesson_id,
         l.title                  AS lesson_title,
         l.lesson_mode,
         l.content_type,
         l.type                   AS legacy_type,
         l.content,
         l.simulation_id,
         l.catalog_id,
         l.position               AS lesson_position,
         l.estimated_minutes,
         l.is_required,
         l.is_published           AS lesson_is_published
       FROM course_modules cm
       LEFT JOIN lessons l ON l.module_id = cm.id
       WHERE cm.course_id = $1
       ORDER BY cm.position, l.position`,
      [courseId],
    );
    return rows;
  },

  // ------------------------------------------------------------------
  // Lessons
  // ------------------------------------------------------------------

  async findLessonById(id) {
    const { rows } = await pool.query(
      `SELECT ${LESSON_COLS} FROM lessons WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async listLessonsByModule(moduleId) {
    const { rows } = await pool.query(
      `SELECT ${LESSON_COLS} FROM lessons WHERE module_id = $1 ORDER BY position`,
      [moduleId],
    );
    return rows;
  },

  async createLesson({
    moduleId, title, type, lessonMode, contentType,
    content, simulationId, catalogId,
    courseId, institutionId, departmentId,
    position, estimatedMinutes, isRequired, isPublished,
  }) {
    const resolvedSimId = (lessonMode === 'simulation' || lessonMode === 'content_and_simulation')
      ? (simulationId ?? content?.simulation_id ?? null)
      : null;

    const { rows } = await pool.query(
      `INSERT INTO lessons
         (module_id, title, type, lesson_mode, content_type, content,
          simulation_id, catalog_id, course_id, institution_id, department_id,
          position, estimated_minutes, is_required, is_published)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        moduleId, title, type ?? 'text', lessonMode, contentType ?? null,
        JSON.stringify(content ?? {}), resolvedSimId, catalogId ?? null,
        courseId ?? null, institutionId ?? null, departmentId ?? null,
        position ?? 0, estimatedMinutes ?? null,
        isRequired ?? true, isPublished ?? false,
      ],
    );
    return rows[0];
  },

  async updateLesson(id, fields) {
    const allowed = [
      'title', 'type', 'lesson_mode', 'content_type', 'content',
      'simulation_id', 'catalog_id', 'position', 'estimated_minutes',
      'is_required', 'is_published',
    ];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        const val = key === 'content' ? JSON.stringify(fields[key]) : fields[key];
        params.push(val);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (sets.length === 0) return this.findLessonById(id);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE lessons SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  },

  async deleteLesson(id) {
    const { rows } = await pool.query(
      `DELETE FROM lessons WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows[0] ?? null;
  },

  // ------------------------------------------------------------------
  // Lesson completions
  // ------------------------------------------------------------------

  async createLessonCompletion({ lessonId, userId, courseId }) {
    const { rows } = await pool.query(
      `INSERT INTO lesson_completions (lesson_id, user_id, course_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (lesson_id, user_id) DO UPDATE SET completed_at = NOW()
       RETURNING *`,
      [lessonId, userId, courseId],
    );
    return rows[0];
  },

  async getLessonCompletion(lessonId, userId) {
    const { rows } = await pool.query(
      `SELECT * FROM lesson_completions WHERE lesson_id = $1 AND user_id = $2`,
      [lessonId, userId],
    );
    return rows[0] ?? null;
  },

  async getLessonCompletionsByCourse(userId, courseId) {
    const { rows } = await pool.query(
      `SELECT lesson_id, completed_at
         FROM lesson_completions
        WHERE user_id = $1 AND course_id = $2`,
      [userId, courseId],
    );
    return rows;
  },

  // ------------------------------------------------------------------
  // Reorder helpers (bulk positional update via unnest)
  // ------------------------------------------------------------------

  async reorder(courseId, orderedIds) {
    if (!orderedIds.length) return;
    await pool.query(
      `UPDATE course_modules SET position = v.pos, updated_at = NOW()
       FROM (SELECT unnest($2::uuid[]) AS id,
                    generate_series(0, array_length($2::uuid[], 1) - 1) AS pos) v
       WHERE course_modules.id = v.id AND course_modules.course_id = $1`,
      [courseId, orderedIds],
    );
  },

  async reorderLessons(moduleId, orderedIds) {
    if (!orderedIds.length) return;
    await pool.query(
      `UPDATE lessons SET position = v.pos, updated_at = NOW()
       FROM (SELECT unnest($2::uuid[]) AS id,
                    generate_series(0, array_length($2::uuid[], 1) - 1) AS pos) v
       WHERE lessons.id = v.id AND lessons.module_id = $1`,
      [moduleId, orderedIds],
    );
  },
};

module.exports = ModuleModel;
