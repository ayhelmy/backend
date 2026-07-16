-- =============================================================================
-- Migration 010 — Audit Logs (immutable, insert-only)
-- SRS §4.15 AUD-01 – AUD-05; §9: entity_type + entity_id (not resource_type)
-- Captures actor, action, entity, before/after delta, IP, user agent
-- Retention: 2 years online; archive older to cold storage (AUD-05)
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID         REFERENCES institutions (id),   -- NULL = platform-level action
  actor_id       UUID         REFERENCES users (id),          -- NULL = system / cron action
  actor_email    VARCHAR(255),                                 -- denormalised snapshot (survives user deletion)
  action         VARCHAR(100) NOT NULL,                        -- verb-noun: "user.create", "grade.override"
  entity_type    VARCHAR(100) NOT NULL,                        -- e.g. "User", "Course", "SimulationSession"
  entity_id      UUID,                                         -- subject of the action
  delta          JSONB,                                        -- {before: {…}, after: {…}} snapshot
  ip_address     INET,
  user_agent     TEXT,
  occurred_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- No UPDATE or DELETE should ever touch this table — enforced at application layer + DB role grants
-- Production: consider PARTITION BY RANGE (occurred_at) monthly (AUD-04)

CREATE INDEX IF NOT EXISTS idx_audit_actor       ON audit_logs (actor_id)              WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_entity      ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_institution ON audit_logs (institution_id)         WHERE institution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_occurred    ON audit_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action      ON audit_logs (action);
