-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 017 — Multi-tenant isolation: add institution_id to all tenant-scoped
-- tables that were missing it. Also adds compound indexes for efficient scoped queries.
-- SRS §1.2 (multi-tenant), §9 (database design).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── simulation_sessions ───────────────────────────────────────────────────────
ALTER TABLE simulation_sessions
  ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL;

-- Back-populate via course → institution_id
UPDATE simulation_sessions ss
   SET institution_id = c.institution_id
  FROM courses c
 WHERE c.id = ss.course_id
   AND ss.institution_id IS NULL;

-- Remaining sessions (standalone launches) — via simulation owner
UPDATE simulation_sessions ss
   SET institution_id = s.institution_id
  FROM simulations s
 WHERE s.id = ss.simulation_id
   AND ss.institution_id IS NULL
   AND s.institution_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sim_sessions_institution
  ON simulation_sessions(institution_id) WHERE institution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sim_sessions_user_institution
  ON simulation_sessions(user_id, institution_id);

-- ── grades ────────────────────────────────────────────────────────────────────
ALTER TABLE grades
  ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL;

-- Back-populate via grade_item → course → institution
UPDATE grades g
   SET institution_id = c.institution_id
  FROM grade_items gi
  JOIN courses c ON c.id = gi.course_id
 WHERE gi.id = g.grade_item_id
   AND g.institution_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_grades_institution
  ON grades(institution_id) WHERE institution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grades_user_institution
  ON grades(user_id, institution_id);

-- ── course_progress ───────────────────────────────────────────────────────────
ALTER TABLE course_progress
  ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL;

UPDATE course_progress cp
   SET institution_id = c.institution_id
  FROM courses c
 WHERE c.id = cp.course_id
   AND cp.institution_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_course_progress_institution
  ON course_progress(institution_id) WHERE institution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_course_progress_user_institution
  ON course_progress(user_id, institution_id);

-- ── module_progress ───────────────────────────────────────────────────────────
ALTER TABLE module_progress
  ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL;

UPDATE module_progress mp
   SET institution_id = c.institution_id
  FROM course_modules m
  JOIN courses c ON c.id = m.course_id
 WHERE m.id = mp.module_id
   AND mp.institution_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_module_progress_institution
  ON module_progress(institution_id) WHERE institution_id IS NOT NULL;

-- ── lesson_progress ───────────────────────────────────────────────────────────
ALTER TABLE lesson_progress
  ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL;

UPDATE lesson_progress lp
   SET institution_id = c.institution_id
  FROM lessons l
  JOIN course_modules m ON m.id = l.module_id
  JOIN courses c ON c.id = m.course_id
 WHERE l.id = lp.lesson_id
   AND lp.institution_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_lesson_progress_institution
  ON lesson_progress(institution_id) WHERE institution_id IS NOT NULL;

-- ── notifications ─────────────────────────────────────────────────────────────
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL;

UPDATE notifications n
   SET institution_id = u.institution_id
  FROM users u
 WHERE u.id = n.user_id
   AND n.institution_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_institution
  ON notifications(institution_id) WHERE institution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_institution
  ON notifications(user_id, institution_id);

-- ── message_threads ───────────────────────────────────────────────────────────
ALTER TABLE message_threads
  ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL;

-- Threads tied to a course → inherit course's institution
UPDATE message_threads mt
   SET institution_id = c.institution_id
  FROM courses c
 WHERE c.id = mt.course_id
   AND mt.institution_id IS NULL;

-- Direct threads without course → inherit creator's institution
UPDATE message_threads mt
   SET institution_id = u.institution_id
  FROM users u
 WHERE u.id = mt.created_by
   AND mt.institution_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_message_threads_institution
  ON message_threads(institution_id) WHERE institution_id IS NOT NULL;

-- ── messages ──────────────────────────────────────────────────────────────────
-- Denormalized from thread for query efficiency (avoids always joining threads)
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL;

UPDATE messages msg
   SET institution_id = mt.institution_id
  FROM message_threads mt
 WHERE mt.id = msg.thread_id
   AND msg.institution_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_institution
  ON messages(institution_id) WHERE institution_id IS NOT NULL;

-- ── Compound indexes for common cross-column queries ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_grades_item_user
  ON grades(grade_item_id, user_id);

CREATE INDEX IF NOT EXISTS idx_course_progress_course_user
  ON course_progress(course_id, user_id);

CREATE INDEX IF NOT EXISTS idx_lesson_progress_lesson_user
  ON lesson_progress(lesson_id, user_id);

CREATE INDEX IF NOT EXISTS idx_sim_sessions_sim_user
  ON simulation_sessions(simulation_id, user_id);

COMMIT;
