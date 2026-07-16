-- =============================================================================
-- Migration 001 — Users
-- SRS §9 Database Design: users table
-- SRS §4.1 AUTH-01: pending until email verified
-- SRS §4.2 USR-03: soft-delete via deleted_at; anonymisation preserves grade records
-- SRS §4.2 USR-04: profile with avatar (CDN URL)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email          VARCHAR(255) NOT NULL,
  password_hash  VARCHAR(255),                                -- NULL for SSO-only accounts (SRS §4.1 AUTH-03)
  first_name     VARCHAR(100) NOT NULL,
  last_name      VARCHAR(100) NOT NULL,
  avatar_url     TEXT,                                        -- CDN URL; up to 2 MB JPG/PNG (USR-04)
  bio            TEXT,
  status         VARCHAR(20)  NOT NULL DEFAULT 'pending'      -- pending | active | suspended
                   CHECK (status IN ('pending','active','suspended')),
  institution_id UUID,                                        -- FK added in 002 after institutions table exists
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ,                                 -- soft-delete; NULL = active

  CONSTRAINT users_email_unique UNIQUE (email)
);

-- Partial indexes: only active rows; keeps index small as soft-deleted rows accumulate
CREATE INDEX IF NOT EXISTS idx_users_email      ON users (email)          WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_status     ON users (status)         WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_institution ON users (institution_id) WHERE deleted_at IS NULL;
