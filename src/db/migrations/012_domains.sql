-- =============================================================================
-- Migration 012 — Learning Subject Domains
-- SRS §4.4 INST-04: Admins define learning domains (e.g. Physics, Biology,
--   Engineering) that group courses and simulations.
-- Back-fills FK on courses and simulations (columns already declared without FK).
-- =============================================================================

CREATE TABLE IF NOT EXISTS domains (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID         REFERENCES institutions (id) ON DELETE CASCADE, -- NULL = global
  name           VARCHAR(100) NOT NULL,
  description    TEXT,
  icon_url       TEXT,
  color          VARCHAR(7)   DEFAULT '#6366F1',              -- brand colour for UI grouping
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT domain_name_unique UNIQUE (institution_id, name)
);

CREATE INDEX IF NOT EXISTS idx_domains_institution ON domains (institution_id);

-- Back-fill FKs now that domains table exists
ALTER TABLE courses
  ADD CONSTRAINT fk_courses_domain FOREIGN KEY (domain_id) REFERENCES domains (id) ON DELETE SET NULL;

ALTER TABLE simulations
  ADD CONSTRAINT fk_simulations_domain FOREIGN KEY (domain_id) REFERENCES domains (id) ON DELETE SET NULL;

-- Seed global subject domains (platform-level; available to all institutions)
INSERT INTO domains (institution_id, name, description) VALUES
  (NULL, 'Biology',          'Cell biology, genetics, anatomy and physiology'),
  (NULL, 'Chemistry',        'Organic, inorganic, and analytical chemistry'),
  (NULL, 'Physics',          'Mechanics, electromagnetism, optics, and quantum physics'),
  (NULL, 'Engineering',      'Mechanical, electrical, civil, and chemical engineering'),
  (NULL, 'Medicine',         'Clinical skills, pharmacology, and patient care'),
  (NULL, 'Environmental',    'Ecology, sustainability, and earth sciences'),
  (NULL, 'Computer Science', 'Algorithms, networks, and systems'),
  (NULL, 'Mathematics',      'Calculus, statistics, and discrete mathematics')
ON CONFLICT (institution_id, name) DO NOTHING;
