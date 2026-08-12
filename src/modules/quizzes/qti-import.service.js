/**
 * QTI 2.2 package import — Phase 2a.
 * Orchestrates: safe zip extraction -> manifest parsing -> per-item mapping
 * (qti-mapping.util.js) -> a single all-or-nothing DB transaction.
 *
 * Rollback semantics:
 *  - A single unsupported/unparseable item is skipped (pushed to `warnings`,
 *    does NOT abort the transaction) so the rest of the package still commits.
 *  - Zero importable questions after the whole package is processed rolls
 *    back everything, including a newly-created quiz shell — an all-skipped
 *    package should leave nothing behind.
 *  - A missing/unparseable manifest, or zero item resources, is rejected
 *    before any DB work starts at all.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');

const { pool } = require('../../config/database');
const config = require('../../config');
const ApiError = require('../../utils/apiError');
const { CourseModel, AuditModel } = require('../../db/models');
const { safeExtractQtiZip } = require('./qti-zip.util');
const { mapQtiItemToQuestion, asArray } = require('./qti-mapping.util');
const { assertCourseScope, assertOwnsCourse, sanitizeRichText } = require('./quizzes.service');

const MANIFEST_PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  trimValues: true,
  textNodeName: '#text',
  processEntities: { enabled: true, maxEntityCount: 20, maxTotalExpansions: 50, maxExpandedLength: 20000 },
  isArray: (name) => ['resource', 'file', 'assessmentItemRef'].includes(name),
};

// ── Manifest parsing ─────────────────────────────────────────────────────────

function resolveSafePath(rootDir, href) {
  if (!href || typeof href !== 'string') throw ApiError.badRequest('Manifest resource is missing an href.');
  const decoded = decodeURIComponent(href).replace(/\\/g, '/');
  const resolved = path.resolve(rootDir, decoded);
  const normalizedRoot = path.resolve(rootDir) + path.sep;
  if (resolved !== path.resolve(rootDir) && !(resolved + path.sep).startsWith(normalizedRoot)) {
    throw ApiError.badRequest(`Manifest resource href escapes the package root: "${href}"`);
  }
  if (!fs.existsSync(resolved)) throw ApiError.badRequest(`Manifest references a missing file: "${href}"`);
  return resolved;
}

function parseManifest(xml, rootDir) {
  let doc;
  try {
    doc = new XMLParser(MANIFEST_PARSER_OPTIONS).parse(xml);
  } catch (err) {
    throw ApiError.badRequest(`imsmanifest.xml is not valid XML: ${err.message}`);
  }
  const manifest = doc.manifest;
  if (!manifest) throw ApiError.badRequest('imsmanifest.xml is missing its <manifest> root element.');

  const resources = asArray(manifest.resources?.resource);
  const itemResources = resources.filter((r) => (r['@_type'] ?? '').startsWith('imsqti_item'));

  const items = itemResources.map((r) => ({
    identifier: r['@_identifier'],
    resolvedPath: resolveSafePath(rootDir, r['@_href']),
  }));

  let testTitle = null;
  let orderedIdentifiers = null;
  const testResource = resources.find((r) => (r['@_type'] ?? '') === 'imsqti_test_xmlv2p2');
  if (testResource) {
    const testXmlPath = resolveSafePath(rootDir, testResource['@_href']);
    const testDoc = new XMLParser(MANIFEST_PARSER_OPTIONS).parse(fs.readFileSync(testXmlPath, 'utf8'));
    const test = testDoc.assessmentTest;
    testTitle = test?.['@_title'] ?? null;
    orderedIdentifiers = asArray(test?.testPart?.assessmentSection?.assessmentItemRef).map((ref) => ref['@_identifier']);
  }

  if (orderedIdentifiers?.length) {
    const order = new Map(orderedIdentifiers.map((id, idx) => [id, idx]));
    items.sort((a, b) => (order.get(a.identifier) ?? Infinity) - (order.get(b.identifier) ?? Infinity));
  }

  return { items, testTitle };
}

// ── Transactional insert helpers (run on the shared import transaction's
// client, not the module pool — none of the Phase 1 model functions accept
// an external client, so a thin duplicate of their INSERT SQL is used here
// rather than refactoring three already-tested Phase 1 model functions for
// this one caller) ────────────────────────────────────────────────────────

async function insertQuizOnClient(client, { course, moduleId, lessonId, title, qtiIdentifier, qtiVersion, createdBy }) {
  const { rows } = await client.query(
    `INSERT INTO quizzes
       (institution_id, department_id, course_id, module_id, lesson_id,
        title, qti_identifier, qti_version, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9)
     RETURNING *`,
    [
      course.institution_id, course.department_id ?? null, course.id, moduleId ?? null, lessonId ?? null,
      title, qtiIdentifier ?? null, qtiVersion ?? null, createdBy,
    ],
  );
  return rows[0];
}

async function insertQuestionOnClient(client, { quizId, position, mapped }) {
  const { rows } = await client.query(
    `INSERT INTO quiz_questions
       (quiz_id, qti_identifier, question_type, title, prompt, response_identifier,
        points, position, required, manual_grading, shuffle_options,
        question_data, response_declaration, scoring_config, feedback_config)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      quizId, mapped.qtiIdentifier ?? null, mapped.questionType, mapped.title ?? null,
      sanitizeRichText(mapped.prompt), mapped.responseIdentifier ?? null,
      mapped.points ?? 1, position, mapped.required ?? true, mapped.manualGrading ?? false, false,
      JSON.stringify(mapped.questionData ?? {}), JSON.stringify(mapped.responseDeclaration ?? {}),
      JSON.stringify(mapped.scoringConfig ?? {}), JSON.stringify(mapped.feedbackConfig ?? {}),
    ],
  );
  return rows[0];
}

async function replaceOptionsOnClient(client, questionId, options) {
  for (const [idx, opt] of options.entries()) {
    await client.query(
      `INSERT INTO quiz_question_options
         (question_id, option_identifier, content, is_correct, position, feedback)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        questionId, opt.optionIdentifier, sanitizeRichText(opt.content), opt.isCorrect ?? false,
        opt.position ?? idx, sanitizeRichText(opt.feedback ?? null),
      ],
    );
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * @param {object} params
 * @param {string} params.courseId
 * @param {string|null} params.quizId  null = create a new quiz from the package
 * @param {object} params.body        request body (title/lessonId/moduleId overrides)
 * @param {string} params.tempZipPath multer-uploaded temp file path
 * @param {object} params.actor
 */
exports.importQtiPackage = async ({ courseId, quizId, body, tempZipPath, actor }) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);
  assertOwnsCourse(course, actor);

  const extractDir = path.join(os.tmpdir(), `qti-import-${crypto.randomUUID()}`);

  try {
    await safeExtractQtiZip(tempZipPath, extractDir, {
      maxEntryCount: config.storage.maxQtiEntryCount,
      maxTotalUncompressedBytes: config.storage.maxQtiUncompressedBytes,
    });

    const manifestPath = path.join(extractDir, 'imsmanifest.xml');
    if (!fs.existsSync(manifestPath)) throw ApiError.badRequest('Package is missing imsmanifest.xml.');

    const { items, testTitle } = parseManifest(fs.readFileSync(manifestPath, 'utf8'), extractDir);
    if (!items.length) throw ApiError.badRequest('No assessmentItem resources found in the manifest.');

    if (!quizId && !body.title && !testTitle) {
      throw ApiError.badRequest('A quiz title is required (supply "title" or include an assessmentTest with a title).');
    }

    const client = await pool.connect();
    const warnings = [];
    let importedQuestionCount = 0;
    let skippedCount = 0;

    try {
      await client.query('BEGIN');

      let targetQuizId = quizId;
      if (!targetQuizId) {
        const newQuiz = await insertQuizOnClient(client, {
          course,
          moduleId: body.moduleId ?? null,
          lessonId: body.lessonId ?? null,
          title: body.title ?? testTitle,
          qtiIdentifier: null,
          qtiVersion: '2.2',
          createdBy: actor.id,
        });
        targetQuizId = newQuiz.id;
      } else {
        const { rows } = await client.query('SELECT id, course_id FROM quizzes WHERE id = $1 FOR UPDATE', [targetQuizId]);
        if (!rows[0] || rows[0].course_id !== courseId) throw ApiError.notFound('Quiz not found in this course.');
      }

      const { rows: existingRows } = await client.query(
        'SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = $1 AND deleted_at IS NULL', [targetQuizId],
      );
      let position = Number(existingRows[0].count);

      for (const item of items) {
        let mapped;
        try {
          const itemXml = fs.readFileSync(item.resolvedPath, 'utf8');
          mapped = mapQtiItemToQuestion(itemXml, item.identifier);
        } catch (err) {
          warnings.push({ itemIdentifier: item.identifier, questionType: null, message: `Failed to parse item XML: ${err.message}` });
          skippedCount += 1;
          continue;
        }

        if (mapped.unsupported) {
          warnings.push({ itemIdentifier: item.identifier, questionType: mapped.questionType, message: mapped.warningMessage });
          skippedCount += 1;
          continue;
        }
        if (mapped.warningMessage) {
          warnings.push({ itemIdentifier: item.identifier, questionType: mapped.questionType, message: mapped.warningMessage });
        }

        const questionRow = await insertQuestionOnClient(client, { quizId: targetQuizId, position: position++, mapped });
        if (mapped.options?.length) {
          await replaceOptionsOnClient(client, questionRow.id, mapped.options);
        }
        importedQuestionCount += 1;
      }

      if (importedQuestionCount === 0) {
        throw ApiError.badRequest('No importable questions were found in this QTI package.');
      }

      await client.query('COMMIT');

      await AuditModel.log({
        institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
        action: 'quiz.qti_import', entityType: 'Quiz', entityId: targetQuizId,
        delta: { after: { courseId, importedQuestionCount, skippedCount, itemCount: items.length } },
      });

      return { quizId: targetQuizId, importedQuestionCount, skippedCount, warnings };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.rmSync(tempZipPath, { force: true });
  }
};

// Exported for the live-DB smoke script / tests.
exports.parseManifest = parseManifest;
exports.resolveSafePath = resolveSafePath;
