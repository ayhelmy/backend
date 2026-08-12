-- =============================================================================
-- Migration 057 — LTI Identity Mapping Stubs
-- Upsert-on-launch rows proving the LTI identity-derivation rules work:
--   lti_user_key          = issuer || '::' || sub
--   lti_context_key       = issuer || '::' || context.id
--   lti_resource_link_key = issuer || '::' || context.id || '::' || resource_link.id
-- The simulearn_* FK columns are intentionally nullable and unused by any
-- application code in this phase — real user/course/lesson provisioning is
-- Deep Linking (Phase 2) and student launch (Phase 3) work. These tables exist
-- now so the mapping pipeline is provably correct end-to-end.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lti_users (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id        UUID         NOT NULL REFERENCES lti_platforms (id) ON DELETE CASCADE,
  issuer             VARCHAR(500) NOT NULL,
  subject            VARCHAR(255) NOT NULL,
  identity_key       VARCHAR(1000) NOT NULL UNIQUE,       -- issuer || '::' || subject
  simulearn_user_id  UUID         REFERENCES users (id) ON DELETE SET NULL,
  last_launch_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lti_users_platform ON lti_users (platform_id);

CREATE TABLE IF NOT EXISTS lti_contexts (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id          UUID         NOT NULL REFERENCES lti_platforms (id) ON DELETE CASCADE,
  issuer               VARCHAR(500) NOT NULL,
  context_id           VARCHAR(255) NOT NULL,
  context_label        VARCHAR(255),
  context_title        VARCHAR(255),
  identity_key         VARCHAR(1000) NOT NULL UNIQUE,     -- issuer || '::' || context_id
  simulearn_course_id  UUID         REFERENCES courses (id) ON DELETE SET NULL,
  last_seen_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lti_contexts_platform ON lti_contexts (platform_id);

CREATE TABLE IF NOT EXISTS lti_resource_links (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id           UUID         NOT NULL REFERENCES lti_platforms (id) ON DELETE CASCADE,
  issuer                VARCHAR(500) NOT NULL,
  context_id            VARCHAR(255),
  resource_link_id      VARCHAR(255) NOT NULL,
  title                 VARCHAR(255),
  identity_key          VARCHAR(1000) NOT NULL UNIQUE,    -- issuer || '::' || context_id || '::' || resource_link_id
  simulearn_lesson_id   UUID         REFERENCES lessons (id) ON DELETE SET NULL,
  last_seen_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lti_resource_links_platform ON lti_resource_links (platform_id);
