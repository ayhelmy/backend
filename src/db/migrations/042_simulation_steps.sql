-- Migration 042: Simulation completion steps
-- Each simulation can have an ordered list of component steps.
-- When a session ends, the backend checks whether the student
-- performed every step in sequence and stores the result.

CREATE TABLE IF NOT EXISTS simulation_steps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id UUID    NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  step_order    INTEGER NOT NULL,
  label         TEXT    NOT NULL,          -- human-readable display name
  category_name TEXT    NOT NULL,          -- must match a click-region category name
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (simulation_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_simulation_steps_sim
  ON simulation_steps (simulation_id, step_order);
