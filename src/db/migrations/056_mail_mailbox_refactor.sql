-- =============================================================================
-- Migration 054 — Mail mailbox refactor
-- Converts the chat-style messages/message_threads/thread_participants model
-- (migrations 009, 053) into email/mailbox semantics: per-recipient
-- Inbox/Sent/Drafts/Archived/Trash state, subject-per-message, To/Cc/Bcc,
-- reply/forward chains. thread_participants is fully superseded by
-- mail_recipients (per-message, not per-thread, granularity).
-- =============================================================================

-- ── Rename the existing tables ────────────────────────────────────────────────
ALTER TABLE messages RENAME TO mail_messages;
ALTER TABLE message_threads RENAME TO mail_threads;

-- ── mail_messages: add mail-specific columns ──────────────────────────────────
ALTER TABLE mail_messages
  ADD COLUMN IF NOT EXISTS subject           VARCHAR(255),
  ADD COLUMN IF NOT EXISTS parent_message_id UUID REFERENCES mail_messages (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_recipients  JSONB;

-- Backfill subject from the parent thread, and treat every pre-existing
-- message as historically "sent" (all had no draft concept before).
UPDATE mail_messages m
   SET subject = t.subject,
       sent_at = m.created_at
  FROM mail_threads t
 WHERE m.thread_id = t.id AND m.subject IS NULL;

-- Drop columns superseded by per-recipient state in mail_recipients.
ALTER TABLE mail_messages
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS attachment_url;

-- Widen message_type for mail semantics (was text|file|system|announcement).
ALTER TABLE mail_messages
  DROP CONSTRAINT IF EXISTS messages_message_type_check;
UPDATE mail_messages SET message_type = 'normal' WHERE message_type IN ('text', 'file');
ALTER TABLE mail_messages
  ADD CONSTRAINT mail_messages_message_type_check
    CHECK (message_type IN ('normal', 'reply', 'forward', 'announcement', 'system'));

-- ── mail_threads: narrow thread_type, add nothing else (already matches spec) ─
UPDATE mail_threads SET thread_type = 'direct' WHERE thread_type = 'group';
ALTER TABLE mail_threads
  DROP CONSTRAINT IF EXISTS message_threads_thread_type_check;
ALTER TABLE mail_threads
  ADD CONSTRAINT mail_threads_thread_type_check
    CHECK (thread_type IN ('direct', 'course', 'announcement', 'support'));

-- ── mail_recipients — per-user, per-message mailbox state ─────────────────────
CREATE TABLE IF NOT EXISTS mail_recipients (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     UUID        NOT NULL REFERENCES mail_messages (id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recipient_type VARCHAR(3)  CHECK (recipient_type IN ('to', 'cc', 'bcc')), -- NULL = sender's own Sent copy
  folder         VARCHAR(10) NOT NULL CHECK (folder IN ('inbox', 'sent', 'draft', 'archived', 'trash')),
  read_at        TIMESTAMPTZ,
  archived_at    TIMESTAMPTZ,
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mail_recipients_message_user_unique UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_mail_recipients_user_folder ON mail_recipients (user_id, folder, deleted_at);
CREATE INDEX IF NOT EXISTS idx_mail_recipients_message     ON mail_recipients (message_id);
CREATE INDEX IF NOT EXISTS idx_mail_messages_thread         ON mail_messages (thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mail_messages_parent         ON mail_messages (parent_message_id) WHERE parent_message_id IS NOT NULL;

-- Backfill mail_recipients from existing data — the sender's own Sent copy...
INSERT INTO mail_recipients (message_id, user_id, recipient_type, folder, read_at, created_at, updated_at)
SELECT m.id, m.sender_id, NULL, 'sent', m.created_at, m.created_at, m.created_at
  FROM mail_messages m
ON CONFLICT (message_id, user_id) DO NOTHING;

-- ...and one Inbox copy per other thread participant, marking it read if the
-- participant's last_read_at (per-thread, the old granularity) postdates the message.
INSERT INTO mail_recipients (message_id, user_id, recipient_type, folder, read_at, created_at, updated_at)
SELECT m.id, tp.user_id, 'to', 'inbox',
       CASE WHEN tp.last_read_at IS NOT NULL AND tp.last_read_at >= m.created_at THEN m.created_at ELSE NULL END,
       m.created_at, m.created_at
  FROM mail_messages m
  JOIN thread_participants tp ON tp.thread_id = m.thread_id AND tp.user_id != m.sender_id
ON CONFLICT (message_id, user_id) DO NOTHING;

-- thread_participants is fully superseded by mail_recipients.
DROP TABLE IF EXISTS thread_participants;
