-- 039_fix_click_nulls.sql
-- Allow canvas_x / canvas_y to be NULL so that keyboard events
-- (which have no position) can be stored in the same table.
-- Without this, any batch containing a keydown event causes the
-- entire INSERT to fail due to the NOT NULL constraint, which
-- silently discards all events in that batch.

ALTER TABLE simulation_click_events
  ALTER COLUMN canvas_x DROP NOT NULL,
  ALTER COLUMN canvas_y DROP NOT NULL;
