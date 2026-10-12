'use strict';

/**
 * Normalizes a raw Unity event payload into the common field set the rest of
 * the ingestion pipeline works with. The stored raw_events.payload is always
 * the untouched original — this only derives values used for validation and
 * state transitions, it never rewrites history.
 *
 * schemaVersion "2.1" (WEB-DEVELOPER-GUIDE.md) is the source of truth and
 * passes through as-is (just coercing stepNumber to a number).
 *
 * schemaVersion "1.0" is the shape actually emitted by the currently shipped
 * FM103 Bernoulli build (confirmed from a real captured event log,
 * 2026-09-08): it uses a string `stepId` (e.g. "EXP01_STEP_01") instead of a
 * numeric `stepNumber`, and omits `projectVersion`/`assessmentVersion`
 * entirely. This is exactly the "previously generated build" case
 * WEB-DEVELOPER-GUIDE.md §3/§8 anticipates — `legacyStepMap` (from the
 * matching lms_assessment_definitions row) translates stepId -> stepNumber,
 * and the only registered projectVersion/assessmentVersion (1.0.0) is
 * assumed since schema 1.0 events carry no version fields to disambiguate.
 */

const DEFAULT_LEGACY_VERSION = '1.0.0';

function normalize(rawPayload, { legacyStepMap = {} } = {}) {
  if (!rawPayload || typeof rawPayload !== 'object') return null;

  const schemaVersion = rawPayload.schemaVersion;

  if (schemaVersion === '2.1') {
    return {
      ...rawPayload,
      stepNumber: rawPayload.stepNumber != null ? Number(rawPayload.stepNumber) : 0,
    };
  }

  if (schemaVersion === '1.0') {
    const stepId = rawPayload.stepId || '';
    const mappedStepNumber = stepId ? legacyStepMap[stepId] : undefined;
    return {
      ...rawPayload,
      projectVersion: rawPayload.projectVersion || DEFAULT_LEGACY_VERSION,
      assessmentVersion: rawPayload.assessmentVersion || DEFAULT_LEGACY_VERSION,
      stepNumber: mappedStepNumber != null ? Number(mappedStepNumber) : 0,
      // Surfaced only for validation error messages / debugging — not persisted separately.
      _legacyStepId: stepId || null,
      _legacyStepUnmapped: Boolean(stepId) && mappedStepNumber == null,
    };
  }

  return null; // unsupported schemaVersion — caller (event-validation.service) rejects
}

module.exports = { normalize, DEFAULT_LEGACY_VERSION };
