-- =============================================================================
-- Migration 013 — Settings Store
-- Key-value configuration scoped to institution or platform
-- SRS §4.16 SET-01 – SET-05: institution branding, feature flags, notification defaults
-- =============================================================================

CREATE TABLE IF NOT EXISTS settings (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID        REFERENCES institutions (id) ON DELETE CASCADE, -- NULL = platform defaults
  key            VARCHAR(200) NOT NULL,                       -- namespaced: "notifications.email_enabled"
  value          JSONB       NOT NULL,                        -- typed value; string/number/bool/object
  description    TEXT,
  updated_by     UUID        REFERENCES users (id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT settings_key_unique UNIQUE (institution_id, key)
);

CREATE INDEX IF NOT EXISTS idx_settings_institution ON settings (institution_id);
CREATE INDEX IF NOT EXISTS idx_settings_key         ON settings (key);

-- Seed platform-level defaults
INSERT INTO settings (institution_id, key, value, description) VALUES
  (NULL, 'notifications.email_enabled',         'true',    'Send email notifications by default'),
  (NULL, 'notifications.push_enabled',           'true',    'Send push notifications by default'),
  (NULL, 'simulations.max_attempts_default',     '3',       'Default max attempts for new simulations'),
  (NULL, 'simulations.pass_score_default',       '70',      'Default passing score (percentage)'),
  (NULL, 'courses.enrollment_type_default',      '"open"',  'Default enrollment type for new courses'),
  (NULL, 'auth.session_duration_days',           '7',       'Refresh token TTL in days'),
  (NULL, 'auth.require_email_verification',      'true',    'Users must verify email before accessing content'),
  (NULL, 'storage.max_upload_mb',                '500',     'Maximum single-file upload size in MB'),
  (NULL, 'analytics.retention_days',             '730',     'Days to retain analytics data (2 years per AUD-05)')
ON CONFLICT (institution_id, key) DO NOTHING;
