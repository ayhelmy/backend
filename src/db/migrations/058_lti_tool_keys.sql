-- =============================================================================
-- Migration 056 — LTI Tool Signing Keys
-- SimuLearn's own RSA keypair(s) used to sign JWTs it sends to LMS platforms
-- (Deep Linking responses, service-call client assertions — Phase 2/3) and to
-- publish a public JWKS at /lti/jwks.json. Private key material is encrypted
-- at rest (see src/utils/lti-key-crypto.js) and is never exposed by any API.
-- Rotation never deletes a key — retired keys remain in the JWKS response so
-- platforms that cached the JWKS can still verify signatures made before
-- rotation, until they refresh their cache.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lti_tool_keys (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  key_name                 VARCHAR(255),
  kid                      VARCHAR(64)  NOT NULL UNIQUE,
  public_jwk               JSONB        NOT NULL,
  private_key_encrypted    TEXT         NOT NULL,        -- AES-256-GCM, see lti-key-crypto.js — never returned by any API
  private_key_fingerprint  VARCHAR(128) NOT NULL,        -- sha256 hex of the public key DER, for admin display only
  status                   VARCHAR(20)  NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','retired')),
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  rotated_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lti_tool_keys_status ON lti_tool_keys (status);
