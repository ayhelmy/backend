-- 040_simulation_click_regions.sql
-- Reference image dimensions + named bounding boxes for a simulation, used to
-- map a recorded click's normalized position to a component category name
-- in the click-tracking CSV export.

CREATE TABLE IF NOT EXISTS simulation_click_regions (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id UUID         NOT NULL UNIQUE
                              REFERENCES simulations(id) ON DELETE CASCADE,
  image_width   INTEGER      NOT NULL,
  image_height  INTEGER      NOT NULL,
  regions       JSONB        NOT NULL, -- [{ "categoryName": "...", "bbox": [x,y,w,h] }, ...]
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
