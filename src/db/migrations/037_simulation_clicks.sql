-- 037_simulation_clicks.sql
-- Records each canvas mouse-down position during a simulation session.
-- One row per click; rows are tied to the session and cascade on delete.

CREATE TABLE IF NOT EXISTS simulation_click_events (
  id           BIGSERIAL    PRIMARY KEY,
  session_id   UUID         NOT NULL
                            REFERENCES simulation_activity_sessions(id)
                            ON DELETE CASCADE,
  sequence_no  INTEGER      NOT NULL,
  canvas_x     REAL         NOT NULL,
  canvas_y     REAL         NOT NULL,
  norm_x       REAL,
  norm_y       REAL,
  clicked_at   TIMESTAMPTZ  NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sim_click_session
  ON simulation_click_events (session_id);

CREATE INDEX IF NOT EXISTS idx_sim_click_session_seq
  ON simulation_click_events (session_id, sequence_no);
