'use strict';

/**
 * Generic auto-registration for the experiments tracking pipeline.
 *
 * Migration 065 hand-seeded FM103's lms_assessment_definitions/
 * lms_registered_releases rows from a document transcribed by hand — that
 * does not scale to "any super-admin-uploaded simulation gets tracked
 * automatically." A real captured event log from the FM103 build confirms a
 * build can instead self-describe its own tracking shape at runtime: every
 * SessionStarted event carries a `projectManifest` listing that build's
 * experiments/steps/questions with `tracked`/`requiredForCompletion` flags,
 * and that manifest was verified to reproduce migration 065's hand-seeded
 * required_items exactly.
 *
 * This module derives the same required_items shape event-validation.service.js
 * and progress.service.js already consume from that manifest, and registers
 * it the first time a (projectId, projectVersion) is seen — with no admin
 * approval gate. That's safe because lms_saved_results.grade stays NULL
 * regardless of source (no grading-policy phase exists yet); an
 * under-specified auto-registered definition can only produce an inaccurate
 * progress display, never a wrong grade. `source: 'auto'` on both rows marks
 * them for a future grading-policy phase to find and assign real answer keys.
 */

const { pool } = require('../../config/database');
const { LmsAssessmentDefinitionModel, LmsRegisteredReleaseModel } = require('../../db/models');
const ApiError = require('../../utils/apiError');

/**
 * Pure — maps a build's self-reported projectManifest onto the same
 * per-experiment shape assessmentDef.required_items already carries for
 * hand-curated (e.g. FM103) definitions, plus a questionId -> questionType
 * map for grading_rules (never an answer key — a client-reported manifest
 * can't be trusted for correctness).
 */
function deriveRequiredItemsFromManifest(manifest) {
  const requiredItems = {};
  const questionTypes = {};

  for (const exp of manifest?.experiments ?? []) {
    const steps = exp.steps ?? [];
    const questions = exp.questions ?? [];

    requiredItems[exp.experimentId] = {
      requiredSteps: steps.filter((s) => s.requiredForCompletion).map((s) => s.stepNumber),
      trackedSteps: steps.filter((s) => s.tracked).map((s) => s.stepNumber),
      catalogStepCount: steps.reduce((max, s) => Math.max(max, s.stepNumber ?? 0), 0),
      requiredQuestions: questions.filter((q) => q.requiredForCompletion).map((q) => q.questionId),
      allQuestions: questions.map((q) => q.questionId),
    };

    for (const q of questions) {
      if (q.questionType) questionTypes[q.questionId] = q.questionType;
    }
  }

  return { requiredItems, questionTypes };
}

/**
 * Looks up (or auto-creates) the assessment definition and registered release
 * for (projectId, projectVersion, assessmentVersion), deriving from `manifest`
 * only when a row doesn't already exist. Three real cases, all handled here:
 *
 *   - Brand-new (projectId, assessmentVersion): both rows are auto-created
 *     from the manifest.
 *   - Known assessmentVersion (e.g. FM103, hand-curated with real answer
 *     keys) but a new projectVersion (a rebuild with an unchanged content
 *     contract): only the release row is auto-created; the curated
 *     assessment definition is never touched.
 *   - Both already exist: pure no-op passthrough — the caller's existing
 *     lookup already found them, this is never reached.
 *
 * Runs in its own transaction so a race between two students' first events
 * against the same brand-new build can't leave a release row pointing at a
 * half-committed assessment definition.
 */
async function ensureRegistered({ projectId, projectVersion, assessmentVersion, manifest, existingAssessmentDef }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let assessmentDef = existingAssessmentDef
      ?? await LmsAssessmentDefinitionModel.findByProjectAndVersion(projectId, assessmentVersion, client);

    if (!assessmentDef) {
      if (!manifest) {
        throw ApiError.badRequest(
          `No registered assessment for ${projectId} / ${assessmentVersion}, and this SessionStarted ` +
          'carried no projectManifest to auto-register from.',
        );
      }
      if (manifest.projectId !== projectId || manifest.assessmentVersion !== assessmentVersion) {
        throw ApiError.badRequest(
          `projectManifest (projectId=${manifest.projectId}, assessmentVersion=${manifest.assessmentVersion}) ` +
          `does not match the event's own (${projectId}, ${assessmentVersion}).`,
        );
      }

      const { requiredItems, questionTypes } = deriveRequiredItemsFromManifest(manifest);
      assessmentDef = await LmsAssessmentDefinitionModel.createAuto(
        { projectId, assessmentVersion, requiredItems, gradingRules: { questionTypes } },
        client,
      );
    }

    let release = await LmsRegisteredReleaseModel.findByProjectAndVersion(projectId, projectVersion, client);
    if (!release) {
      if (manifest?.assessmentVersion && manifest.assessmentVersion !== assessmentDef.assessment_version) {
        throw ApiError.badRequest(
          `projectManifest's assessmentVersion (${manifest.assessmentVersion}) conflicts with the ` +
          `already-registered assessment definition (${assessmentDef.assessment_version}) for ${projectId}.`,
        );
      }

      release = await LmsRegisteredReleaseModel.createAuto(
        { projectId, projectVersion, assessmentVersion: assessmentDef.assessment_version, manifest },
        client,
      );
    }

    await client.query('COMMIT');
    return { assessmentDef, release };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { ensureRegistered, deriveRequiredItemsFromManifest };
