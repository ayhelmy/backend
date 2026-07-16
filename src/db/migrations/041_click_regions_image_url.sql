-- 041_click_regions_image_url.sql
-- Store the reference screenshot URL so the analytics dashboard can render it
-- as the background of the click-scatter map.

ALTER TABLE simulation_click_regions
  ADD COLUMN IF NOT EXISTS reference_image_url TEXT;
