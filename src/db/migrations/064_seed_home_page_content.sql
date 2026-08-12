-- =============================================================================
-- Migration 062 — Seed Home Page Content
--
-- Seeds page_content rows for page='home', powering the public marketing
-- home page via GET /api/v1/page-content/home-page. Follows the same
-- section/singleton-vs-list convention established in 035_page_content.sql.
-- =============================================================================

BEGIN;

-- ── Hero ──────────────────────────────────────────────────────────────────────

INSERT INTO page_content (page, section, sort_order, title, description, cta_text, extra) VALUES
('home', 'hero', 0,
 'Explore BEDO Interactive 3D Simulations',
 'Access browser-based interactive 3D simulations for engineering and computer science labs. Preview simulations online, explore learning objectives, and support institutional access through LMS/LTI integration.',
 'Explore Simulations',
 '{
   "badgeText": "Explore",
   "highlightedText": "Interactive 3D",
   "primaryButtonLabel": "Explore Simulations",
   "primaryButtonUrl": "/public-catalog",
   "secondaryButtonLabel": "Try Demo",
   "secondaryButtonUrl": "/public-catalog?scope=demo",
   "heroImageUrl": null,
   "backgroundImageUrl": null
 }'::jsonb);

-- ── Platform statistics ──────────────────────────────────────────────────────
-- metric: 'simulations_count' | 'disciplines_count' resolve live at request time;
-- 'static' rows pass extra.value through unchanged.

INSERT INTO page_content (page, section, sort_order, title, description, icon_name, extra) VALUES
('home', 'stats', 0, 'Simulations', 'Interactive 3D labs', 'ExperimentOutlined',
 '{"metric": "simulations_count", "suffix": "+"}'::jsonb),

('home', 'stats', 1, 'Disciplines', 'ENG & CS', 'ApartmentOutlined',
 '{"metric": "disciplines_count", "suffix": ""}'::jsonb),

('home', 'stats', 2, 'WebGL', 'Browser-based', 'GlobalOutlined',
 '{"metric": "static", "value": "WebGL"}'::jsonb),

('home', 'stats', 3, 'LTI Ready', 'LMS Integration', 'ApiOutlined',
 '{"metric": "static", "value": "LTI Ready"}'::jsonb);

-- ── Features ──────────────────────────────────────────────────────────────────

INSERT INTO page_content (page, section, sort_order, title, description, cta_text, extra) VALUES
('home', 'features_intro', 0,
 'Built for practical, interactive learning',
 'Designed to help learners explore technical concepts through interactive 3D environments.',
 'View All Features',
 '{"linkUrl": "/why-simlearn"}'::jsonb);

INSERT INTO page_content (page, section, sort_order, title, description, icon_name, icon_color) VALUES
('home', 'features', 0, 'Interactive 3D Environment',
 'Explore lab equipment and technical concepts through a browser-based 3D simulation.',
 'ExperimentOutlined', '#F59324'),

('home', 'features', 1, 'WebGL-Based Access',
 'Run supported simulations online through the browser.',
 'GlobalOutlined', '#0284C7'),

('home', 'features', 2, 'Guided Lab Interaction',
 'Use structured steps and learning objectives to support practical understanding.',
 'CompassOutlined', '#059669'),

('home', 'features', 3, 'LMS / LTI Ready',
 'Support institutional access through learning management system integration.',
 'ApiOutlined', '#722ed1');

-- ── Featured simulations section copy (cards themselves come from `simulations`) ─

INSERT INTO page_content (page, section, sort_order, title, description, cta_text, extra) VALUES
('home', 'featured_simulations_intro', 0,
 'Start Exploring BEDO Interactive 3D Simulations',
 'Preview selected simulations or browse the full catalog by discipline and topic.',
 'View Full Catalog',
 '{"linkUrl": "/public-catalog"}'::jsonb);

-- ── Demo section ──────────────────────────────────────────────────────────────

INSERT INTO page_content (page, section, sort_order, title, description, extra) VALUES
('home', 'demo', 0,
 'See SimuLearn in Action',
 'Explore BEDO lab experiences through interactive 3D simulations designed to help learners visualize, practice, and understand complex lab concepts online.',
 '{
   "thumbnailUrl": null,
   "videoUrl": null,
   "sampleSimulationId": null,
   "watchButtonLabel": "Watch Demo",
   "launchButtonLabel": "Launch Sample Simulation"
 }'::jsonb);

-- ── Learning benefits ─────────────────────────────────────────────────────────

INSERT INTO page_content (page, section, sort_order, title, extra) VALUES
('home', 'benefits_intro', 0, 'Built for practical, interactive learning',
 '{"imageUrl": null}'::jsonb);

INSERT INTO page_content (page, section, sort_order, title, description, icon_name, icon_color) VALUES
('home', 'benefits', 0, 'Bring BEDO Labs Online',
 'Present engineering and computer science lab concepts through browser-based interactive 3D simulations that learners can access online.',
 'CloudServerOutlined', '#F59324'),

('home', 'benefits', 1, 'Learn Through Interactive 3D Simulation',
 'Learners can explore lab environments, interact with tools, adjust values, and observe system behavior through guided visual interaction.',
 'RocketOutlined', '#0284C7'),

('home', 'benefits', 2, 'Make Lab Access Easier for Every Learner',
 'Give learners more opportunities to preview, repeat, and understand selected lab activities beyond limited physical lab time.',
 'TeamOutlined', '#059669'),

('home', 'benefits', 3, 'Designed for Digital Learning',
 'Support institutional learning workflows with browser-based access and LMS / LTI integration.',
 'BookOutlined', '#722ed1');

-- ── LMS / LTI integration ─────────────────────────────────────────────────────

INSERT INTO page_content (page, section, sort_order, title, description, cta_text, extra) VALUES
('home', 'lms_intro', 0,
 'Ready for Your LMS',
 'BEDO SimuLearn integrates with learning management systems through LTI, helping institutions launch simulations from their existing learning platforms.',
 'Learn About LTI Integration',
 '{"linkUrl": "/lti-info"}'::jsonb);

INSERT INTO page_content (page, section, sort_order, title, description, icon_name, icon_color) VALUES
('home', 'lms', 0, 'LTI Compatible',
 'Connect SimuLearn with supported learning systems through LTI-based workflows.',
 'ApiOutlined', '#F59324'),

('home', 'lms', 1, 'Easy Student Access',
 'Allow learners to access simulations directly from their institution''s learning environment.',
 'UserOutlined', '#0284C7'),

('home', 'lms', 2, 'Institution-Ready Deployment',
 'Support scalable digital lab access across courses, departments, and learning programs.',
 'BankOutlined', '#059669');

-- ── Final institutional CTA ───────────────────────────────────────────────────

INSERT INTO page_content (page, section, sort_order, title, description, extra) VALUES
('home', 'cta', 0,
 'Bring BEDO Interactive 3D Simulation to Your Institution',
 'Explore browser-based simulations for engineering and computer science labs, and see how they can support practical learning online.',
 '{
   "backgroundImageUrl": null,
   "primaryButtonLabel": "Explore Simulations",
   "primaryButtonUrl": "/public-catalog",
   "secondaryButtonLabel": "Book Demo",
   "secondaryButtonUrl": "/register"
 }'::jsonb);

-- ── Best-effort: mark up to 3 existing demo-visible simulations as featured ──

UPDATE simulations
   SET is_featured = TRUE,
       featured_order = sub.rn - 1
  FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS rn
      FROM simulations
     WHERE visibility IN ('demo_public', 'demo_and_institution')
       AND status = 'active'
       AND deleted_at IS NULL
     LIMIT 3
  ) AS sub
 WHERE simulations.id = sub.id;

COMMIT;
