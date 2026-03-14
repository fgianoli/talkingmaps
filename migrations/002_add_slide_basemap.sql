-- Migration: Add basemap_id, map_config, audio to slides
-- Run on DATA database (talkingmaps_data)
-- Date: 2026-03-14

ALTER TABLE slides ADD COLUMN IF NOT EXISTS basemap_id INTEGER;
ALTER TABLE slides ADD COLUMN IF NOT EXISTS map_config JSONB DEFAULT '{}';
ALTER TABLE slides ADD COLUMN IF NOT EXISTS audio_url VARCHAR(500);
ALTER TABLE slides ADD COLUMN IF NOT EXISTS audio_autoplay BOOLEAN DEFAULT FALSE;
