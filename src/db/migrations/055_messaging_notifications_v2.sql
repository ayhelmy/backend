-- =============================================================================
-- Migration 053 — Messaging & Notifications v2
-- Extends the migration-009 skeleton (notifications, message_threads,
-- thread_participants, messages) with full tenant/course scoping, priority,
-- channel, read/archive status, thread roles, attachments, and per-user
-- notification preferences. Additive only — every new column is
-- nullable/defaulted so existing (empty) rows are unaffected.
-- =============================================================================

-- ── notifications ────────────────────────────────────────────────────────────
-- is_read/read_at are kept (existing partial index depends on them); the
-- service layer keeps them in sync with the new `status` column.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS department_id  UUID REFERENCES departments  (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS course_id      UUID REFERENCES courses      (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS module_id      UUID REFERENCES course_modules (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS lesson_id      UUID REFERENCES lessons      (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS sender_id      UUID REFERENCES users        (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority       VARCHAR(10) NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  ADD COLUMN IF NOT EXISTS channel        VARCHAR(10) NOT NULL DEFAULT 'in_app'
    CHECK (channel IN ('in_app','email','push')),
  ADD COLUMN IF NOT EXISTS data           JSONB,
  ADD COLUMN IF NOT EXISTS status         VARCHAR(10) NOT NULL DEFAULT 'unread'
    CHECK (status IN ('unread','read','archived')),
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_status
  ON notifications (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_institution
  ON notifications (institution_id) WHERE institution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON notifications (created_at DESC);

-- ── message_threads ───────────────────────────────────────────────────────────

ALTER TABLE message_threads
  ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS archived_at    TIMESTAMPTZ;

-- Backfill institution_id from the creating user for any pre-existing rows,
-- then make it required going forward.
UPDATE message_threads t
   SET institution_id = u.institution_id
  FROM users u
 WHERE t.created_by = u.id AND t.institution_id IS NULL;

ALTER TABLE message_threads
  ALTER COLUMN institution_id SET NOT NULL;

ALTER TABLE message_threads
  DROP CONSTRAINT IF EXISTS message_threads_thread_type_check;
ALTER TABLE message_threads
  ADD CONSTRAINT message_threads_thread_type_check
    CHECK (thread_type IN ('direct','group','course','announcement','support'));

CREATE INDEX IF NOT EXISTS idx_threads_institution ON message_threads (institution_id);

-- ── thread_participants ───────────────────────────────────────────────────────

ALTER TABLE thread_participants
  ADD COLUMN IF NOT EXISTS role_in_thread VARCHAR(12) NOT NULL DEFAULT 'participant'
    CHECK (role_in_thread IN ('owner','participant','viewer')),
  ADD COLUMN IF NOT EXISTS muted          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS left_at        TIMESTAMPTZ;

-- ── messages ──────────────────────────────────────────────────────────────────

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS course_id      UUID REFERENCES courses (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS message_type   VARCHAR(12) NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text','file','system','announcement')),
  ADD COLUMN IF NOT EXISTS attachments    JSONB,
  ADD COLUMN IF NOT EXISTS status         VARCHAR(10) NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent','edited','deleted')),
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE messages m
   SET institution_id = t.institution_id, course_id = t.course_id
  FROM message_threads t
 WHERE m.thread_id = t.id AND m.institution_id IS NULL;

ALTER TABLE messages
  ALTER COLUMN institution_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_institution ON messages (institution_id);

-- ── message_attachments (normalized store) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS message_attachments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID        NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  file_name   VARCHAR(255) NOT NULL,
  file_url    TEXT        NOT NULL,
  file_type   VARCHAR(100),
  file_size   BIGINT,
  uploaded_by UUID        NOT NULL REFERENCES users (id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments (message_id);

-- ── notification_preferences ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_preferences (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  institution_id   UUID        REFERENCES institutions (id) ON DELETE SET NULL,
  email_enabled    BOOLEAN     NOT NULL DEFAULT TRUE,
  in_app_enabled   BOOLEAN     NOT NULL DEFAULT TRUE,
  push_enabled     BOOLEAN     NOT NULL DEFAULT FALSE,
  digest_frequency VARCHAR(10) NOT NULL DEFAULT 'instant'
    CHECK (digest_frequency IN ('instant','daily','weekly','off')),
  preferences      JSONB       NOT NULL DEFAULT '{
    "messages": true,
    "course_announcements": true,
    "enrollment_updates": true,
    "quiz_updates": true,
    "grade_updates": true,
    "simulation_updates": true,
    "system_alerts": true
  }'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
