-- =============================================================================
-- Migration 059 — LTI Phase 2/3/4: resource-link grading config + AGS lineitem
--
-- Extends lti_resource_links (created as an identity stub in 057) with the
-- fields captured from the Deep Linking instructor's grading configuration
-- and the AGS endpoint claim received on every real launch. These are only
-- ever populated once a resource link is actually launched (see
-- launch-validation.service.js) — Deep Linking itself does not create a row
-- here (see plan addendum: custom params carry simulation_id + grading
-- config, not a pre-existing lesson/resource-link mapping).
--
-- Extends simulation_scores with AGS grade-sync tracking, hooked into the
-- EXISTING simulation-scores.service.js write path rather than a parallel
-- tracking system.
-- =============================================================================

ALTER TABLE lti_resource_links
  ADD COLUMN IF NOT EXISTS simulation_id   UUID REFERENCES simulations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lineitem_url    VARCHAR(500),
  ADD COLUMN IF NOT EXISTS lineitems_url   VARCHAR(500),
  ADD COLUMN IF NOT EXISTS max_score       NUMERIC(8,2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS custom_params   JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS grading_mode    VARCHAR(30) NOT NULL DEFAULT 'score_and_completion'
                          CHECK (grading_mode IN ('score','completion','score_and_completion')),
  ADD COLUMN IF NOT EXISTS attempt_policy  VARCHAR(20) NOT NULL DEFAULT 'best'
                          CHECK (attempt_policy IN ('best','last','first','average','instructor_selected')),
  ADD COLUMN IF NOT EXISTS duration_limit  INTEGER;

CREATE INDEX IF NOT EXISTS idx_lti_resource_links_simulation ON lti_resource_links (simulation_id) WHERE simulation_id IS NOT NULL;

ALTER TABLE simulation_scores
  ADD COLUMN IF NOT EXISTS lti_resource_link_id UUID REFERENCES lti_resource_links(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ags_sync_status      VARCHAR(20) CHECK (ags_sync_status IN ('pending','synced','failed')),
  ADD COLUMN IF NOT EXISTS ags_last_sync_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ags_last_error       TEXT,
  ADD COLUMN IF NOT EXISTS ags_retry_count      INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sim_scores_lti_resource_link ON simulation_scores (lti_resource_link_id) WHERE lti_resource_link_id IS NOT NULL;
