-- 038_simulation_click_keyboard.sql
-- Adds event_type (click | keydown) and key_name to simulation_click_events.
-- Existing rows default to event_type = 'click', key_name = NULL.

ALTER TABLE simulation_click_events
  ADD COLUMN IF NOT EXISTS event_type VARCHAR(10)  NOT NULL DEFAULT 'click'
                           CHECK (event_type IN ('click', 'keydown')),
  ADD COLUMN IF NOT EXISTS key_name   VARCHAR(100);
