-- =============================================================================
-- Migration 009 — Notifications and Messages
-- SRS §4.12 NOT-01 – NOT-05: in-app + push notifications
-- SRS §4.13 MSG-01 – MSG-06: direct and course discussion threads
-- =============================================================================

-- In-app notifications (NOT-01; NOT-02: real-time via WebSocket)
CREATE TABLE IF NOT EXISTS notifications (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type            VARCHAR(50) NOT NULL,                        -- grade_posted | assignment_due | announcement | system
  title           VARCHAR(255) NOT NULL,
  body            TEXT,
  reference_type  VARCHAR(50),                                 -- polymorphic: course | simulation_session | grade
  reference_id    UUID,
  is_read         BOOLEAN     NOT NULL DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index on unread — the most common query (NOT-03: badge count)
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id, created_at DESC) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_notifications_user_all    ON notifications (user_id, created_at DESC);

-- Message threads (MSG-01: direct; MSG-02: course discussion)
CREATE TABLE IF NOT EXISTS message_threads (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject     VARCHAR(255),
  thread_type VARCHAR(20) NOT NULL DEFAULT 'direct'            -- direct | course
               CHECK (thread_type IN ('direct','course')),
  course_id   UUID        REFERENCES courses (id) ON DELETE SET NULL,
  created_by  UUID        NOT NULL REFERENCES users (id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()               -- bumped on each new message
);

CREATE INDEX IF NOT EXISTS idx_threads_course      ON message_threads (course_id)   WHERE course_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_threads_created_by  ON message_threads (created_by);

-- Participants in a thread (MSG-03: last_read_at drives unread count)
CREATE TABLE IF NOT EXISTS thread_participants (
  thread_id    UUID        NOT NULL REFERENCES message_threads (id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_thread_participants_user ON thread_participants (user_id);

-- Messages within a thread (MSG-04: soft-delete for moderation MSG-06)
CREATE TABLE IF NOT EXISTS messages (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id      UUID        NOT NULL REFERENCES message_threads (id) ON DELETE CASCADE,
  sender_id      UUID        NOT NULL REFERENCES users (id),
  body           TEXT        NOT NULL,
  attachment_url TEXT,                                         -- S3/CloudFront URL
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ                                   -- soft-delete (MSG-06)
);

CREATE INDEX IF NOT EXISTS idx_messages_thread  ON messages (thread_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_sender  ON messages (sender_id);
