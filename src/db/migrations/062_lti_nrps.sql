-- =============================================================================
-- Migration 060 — LTI Phase 5: NRPS roster sync
-- Captures the Names and Role Provisioning Service URL from the launch claim
-- (https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice) so
-- nrps.service.js can pull the course roster on demand.
-- =============================================================================

ALTER TABLE lti_contexts
  ADD COLUMN IF NOT EXISTS nrps_context_memberships_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS nrps_last_synced_at TIMESTAMPTZ;
