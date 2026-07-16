-- =============================================================================
-- Migration 035 — Page Content
--
-- Stores all editable static content for public-facing pages:
-- Why BEDO, About, Resources.  super_admin can manage rows via the
-- /api/v1/page-content endpoints.  Public endpoints return active rows only.
-- Real statistics (simulations / institutions / disciplines) are queried live.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS page_content (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  page           VARCHAR(50)   NOT NULL,         -- 'why_bedo' | 'about' | 'resources' | 'platform'
  section        VARCHAR(100)  NOT NULL,         -- 'features' | 'values' | 'cards' | 'hero' | 'mission' | 'stats'
  sort_order     INTEGER       NOT NULL DEFAULT 0,
  title          TEXT,
  description    TEXT,
  icon_name      VARCHAR(100),                   -- Ant Design icon component name string
  icon_color     VARCHAR(20),
  category       VARCHAR(100),                   -- resources: tag label
  category_color VARCHAR(20),
  cta_text       VARCHAR(200),                   -- resources: CTA button label
  extra          JSONB         NOT NULL DEFAULT '{}',  -- flexible extra fields (href, is_static, uptime…)
  is_active      BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_by     UUID          REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_page_content_page_section
  ON page_content (page, section, sort_order);

-- ── Seed: Why BEDO ────────────────────────────────────────────────────────────

INSERT INTO page_content (page, section, sort_order, description) VALUES
('why_bedo', 'hero', 0,
 'SimuLearn brings the power of virtual laboratory simulations to every student, everywhere — no equipment, no cost, no compromise on quality.');

INSERT INTO page_content (page, section, sort_order, title, description, icon_name, icon_color) VALUES
('why_bedo', 'features', 0, 'Realistic Lab Simulations',
 'Our Unity WebGL simulations mirror real laboratory conditions — interact with equipment, run experiments, and observe results in a safe virtual environment.',
 'ExperimentOutlined', '#F59324'),

('why_bedo', 'features', 1, 'Zero Risk, Full Learning',
 'Students can repeat experiments as many times as needed without consuming reagents, risking injury, or damaging equipment.',
 'SafetyCertificateOutlined', '#52c41a'),

('why_bedo', 'features', 2, 'Multi-Tenant Institution Support',
 'Built for universities and schools. Manage departments, academic years, and cohorts with full role-based access control.',
 'TeamOutlined', '#722ed1'),

('why_bedo', 'features', 3, 'Integrated with Your Courses',
 'Embed simulations directly into your course lessons. Track student progress, scores, and attempts all in one dashboard.',
 'RocketOutlined', '#fa8c16'),

('why_bedo', 'features', 4, 'Automated Grading',
 'Configurable pass/fail thresholds and scoring rules with automatic grade recording linked to your gradebook.',
 'TrophyOutlined', '#f5222d'),

('why_bedo', 'features', 5, 'Public Demo Access',
 'Let prospective students explore your simulation catalog without signing up — convert interest into enrollment.',
 'GlobalOutlined', '#13c2c2');

-- ── Seed: About ───────────────────────────────────────────────────────────────

INSERT INTO page_content (page, section, sort_order, title, description) VALUES
('about', 'hero', 0, 'About SimuLearn',
 'SimuLearn is a simulation-based learning platform built to bring the university laboratory experience to every student — regardless of location, equipment access, or institutional resources.');

INSERT INTO page_content (page, section, sort_order, description) VALUES
('about', 'mission', 0,
 'We believe that every student deserves access to high-quality hands-on science education. Virtual simulations are not a replacement for real labs — they are a powerful complement that removes barriers of cost, safety, and geography.'),

('about', 'mission', 1,
 'SimuLearn gives institutions the tools to embed interactive Unity WebGL simulations directly into their courses, with full learning management integration, automated grading, and analytics.');

INSERT INTO page_content (page, section, sort_order, title, description, icon_name, icon_color) VALUES
('about', 'values', 0, 'Student-First',
 'Every decision we make starts with the question: does this help students learn more effectively?',
 'HeartOutlined', '#f5222d'),

('about', 'values', 1, 'Accessible Science',
 'Laboratory equipment should not determine who gets to do science. We make experiments universally accessible.',
 'RocketOutlined', '#fa8c16'),

('about', 'values', 2, 'Trusted by Institutions',
 'Built with enterprise-grade security, role-based access, and multi-tenant isolation from day one.',
 'SafetyCertificateOutlined', '#52c41a');

-- ── Seed: Resources ───────────────────────────────────────────────────────────

INSERT INTO page_content (page, section, sort_order, description) VALUES
('resources', 'hero', 0,
 'Everything you need to get the most out of SimuLearn — from quick-start guides to in-depth API documentation.');

INSERT INTO page_content (page, section, sort_order, title, description, icon_name, icon_color, category, category_color, cta_text) VALUES
('resources', 'cards', 0, 'Getting Started with SimuLearn',
 'Learn how to set up your institution, create courses, and add simulations in under 30 minutes.',
 'BookOutlined', '#F59324', 'Guide', '#F59324', 'Read Guide'),

('resources', 'cards', 1, 'Running Your First Virtual Lab',
 'A step-by-step walkthrough of launching a WebGL simulation and reviewing student results.',
 'VideoCameraOutlined', '#722ed1', 'Video', '#722ed1', 'Watch Video'),

('resources', 'cards', 2, 'Course Builder Deep Dive',
 'Build multi-lesson courses with embedded simulations, configure scoring, and manage enrollment.',
 'FileTextOutlined', '#52c41a', 'Tutorial', '#52c41a', 'Read Tutorial'),

('resources', 'cards', 3, 'Developer API Reference',
 'Full REST API reference for LTI integration, simulation catalog access, and webhook configuration.',
 'ApiOutlined', '#fa8c16', 'API Docs', '#fa8c16', 'View Docs'),

('resources', 'cards', 4, 'Frequently Asked Questions',
 'Answers to the most common questions from students, instructors, and institution administrators.',
 'QuestionCircleOutlined', '#f5222d', 'FAQ', '#f5222d', 'Browse FAQs'),

('resources', 'cards', 5, 'Instructor Community Forum',
 'Share tips, simulation ideas, and best practices with educators from institutions worldwide.',
 'TeamOutlined', '#13c2c2', 'Community', '#13c2c2', 'Join Forum');

-- ── Seed: Platform stats (uptime — the only static stat) ─────────────────────

INSERT INTO page_content (page, section, sort_order, title, extra) VALUES
('platform', 'stats', 0, 'Uptime', '{"uptime": "99.9%"}');

COMMIT;
