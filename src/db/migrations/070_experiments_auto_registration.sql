-- =============================================================================
-- Migration 066 — Generic auto-registration for the experiments tracking pipeline
--
-- Migration 065 hand-seeded FM103's lms_assessment_definitions/
-- lms_registered_releases rows from a document transcribed by hand. That does
-- not scale to "any super-admin-uploaded simulation gets tracked" — this
-- migration adds a `source` column so the backend (release-registration
-- service) can instead derive those same rows automatically, at runtime, from
-- the `projectManifest` a build's own SessionStarted event carries (confirmed
-- present and structurally accurate on the real FM103 Build 008 capture).
--
-- 'manual' rows (FM103's, from migration 065) carry real, admin-curated
-- answer keys in grading_rules.answerKeys. 'auto' rows are derived purely
-- from a self-reported manifest, which has no notion of a correct answer —
-- grading_rules.answerKeys is simply absent for them. This is safe because
-- lms_saved_results.grade stays NULL regardless of source (no grading-policy
-- phase exists yet); `source` exists so that future phase can find
-- auto-registered definitions that still need real answer keys assigned.
-- =============================================================================

ALTER TABLE lms_assessment_definitions
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto'));

ALTER TABLE lms_registered_releases
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto'));
