-- =============================================================================
-- Migration 002 — Institutions, Email Domains, Departments, Academic Terms
-- SRS §4.4 INST-01 – INST-04
-- SRS §9: institutions.domain = primary SSO email domain (AUTH-03)
-- =============================================================================

CREATE TABLE IF NOT EXISTS institutions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(255) NOT NULL,
  slug            VARCHAR(100) NOT NULL,                       -- URL-safe identifier (auto-generated)
  domain          VARCHAR(255),                                -- Primary email domain for SSO (AUTH-03)
  logo_url        TEXT,                                        -- S3/CloudFront CDN URL
  primary_color   VARCHAR(7)   NOT NULL DEFAULT '#0057B7',     -- Hex colour for white-labelling
  timezone        VARCHAR(64)  NOT NULL DEFAULT 'UTC',
  locale          VARCHAR(10)  NOT NULL DEFAULT 'en',
  subscription_plan VARCHAR(30) NOT NULL DEFAULT 'trial'
                   CHECK (subscription_plan IN ('trial','starter','professional','enterprise')),
  max_users       INTEGER      NOT NULL DEFAULT 100,
  max_storage_gb  NUMERIC(6,2) NOT NULL DEFAULT 5.00,
  status          VARCHAR(20)  NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','suspended')),
  settings        JSONB        NOT NULL DEFAULT '{}',           -- Enrollment policy, notification prefs, etc.
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,

  CONSTRAINT institutions_slug_unique UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS idx_institutions_slug   ON institutions (slug)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_institutions_domain ON institutions (domain)  WHERE domain IS NOT NULL;

-- Wire users → institutions (table exists from migration 001)
ALTER TABLE users
  ADD CONSTRAINT fk_users_institution FOREIGN KEY (institution_id) REFERENCES institutions (id) ON DELETE SET NULL;

-- Allowed email registration domains per institution (INST-04; supports multi-domain orgs)
CREATE TABLE IF NOT EXISTS institution_domains (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID        NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
  domain         VARCHAR(255) NOT NULL,
  is_primary     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT institution_domain_unique UNIQUE (institution_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_inst_domains_inst ON institution_domains (institution_id);

-- Departments — organisational sub-units within an institution (INST-03)
CREATE TABLE IF NOT EXISTS departments (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID         NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
  name           VARCHAR(255) NOT NULL,
  code           VARCHAR(50),                                  -- Unique short code within institution (e.g. CS, BIO)
  parent_id      UUID         REFERENCES departments (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ,

  CONSTRAINT dept_code_unique UNIQUE (institution_id, code)
);

CREATE INDEX IF NOT EXISTS idx_departments_institution ON departments (institution_id) WHERE deleted_at IS NULL;

-- Academic terms / semesters (INST-02)
CREATE TABLE IF NOT EXISTS academic_terms (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID        NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
  name           VARCHAR(100) NOT NULL,                        -- e.g. "Fall 2026"
  start_date     DATE        NOT NULL,
  end_date       DATE        NOT NULL,
  is_current     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT academic_term_date_order CHECK (end_date > start_date)
);

CREATE INDEX IF NOT EXISTS idx_academic_terms_institution ON academic_terms (institution_id);
