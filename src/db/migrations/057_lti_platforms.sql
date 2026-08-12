-- =============================================================================
-- Migration 055 — LTI 1.3 Platform Registration
-- LTI Phase 1 (registration + security). Mirrors the institutions +
-- institution_domains pairing (002_institutions.sql): one institution can map
-- to multiple LMS platform registrations, and one platform registration can
-- have multiple deployment_ids (LTI Advantage allows a single client
-- registration to be deployed multiple times, e.g. per Canvas sub-account).
-- =============================================================================

CREATE TABLE IF NOT EXISTS lti_platforms (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID         NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
  platform_name   VARCHAR(255) NOT NULL,                 -- e.g. "Moodle", "Canvas — Fall 2026"
  issuer          VARCHAR(500) NOT NULL,                 -- LMS OIDC issuer (iss)
  client_id       VARCHAR(255) NOT NULL,                 -- Tool client ID issued by the LMS
  auth_login_url  VARCHAR(500) NOT NULL,                 -- LMS OIDC authorization/login endpoint
  auth_token_url  VARCHAR(500) NOT NULL,                 -- LMS OAuth2 token endpoint (reserved — AGS/NRPS, Phase 3)
  jwks_url        VARCHAR(500) NOT NULL,                 -- LMS public JWKS URL
  allowed_scopes  JSONB        NOT NULL DEFAULT '[]',    -- reserved — AGS/NRPS scope allowlist (Phase 3)
  role_mapping    JSONB        NOT NULL DEFAULT '{}',    -- reserved — LTI role -> SimuLearn role overrides (Phase 3)
  status          VARCHAR(20)  NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','inactive')),
  created_by      UUID         REFERENCES users (id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT lti_platforms_issuer_client_unique UNIQUE (issuer, client_id)
);

CREATE INDEX IF NOT EXISTS idx_lti_platforms_institution ON lti_platforms (institution_id);

CREATE TABLE IF NOT EXISTS lti_deployments (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id    UUID         NOT NULL REFERENCES lti_platforms (id) ON DELETE CASCADE,
  deployment_id  VARCHAR(255) NOT NULL,                  -- LTI deployment_id claim
  label          VARCHAR(255),
  status         VARCHAR(20)  NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','inactive')),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT lti_deployments_platform_deployment_unique UNIQUE (platform_id, deployment_id)
);

CREATE INDEX IF NOT EXISTS idx_lti_deployments_platform ON lti_deployments (platform_id);
