-- Migration 004: Add missing columns to slides table
-- Run on DATA database (talkingmaps_data)
-- These columns exist in setup_data.sql but may be missing on older deployments

ALTER TABLE slides ADD COLUMN IF NOT EXISTS map_config JSONB DEFAULT '{}';
ALTER TABLE slides ADD COLUMN IF NOT EXISTS audio_url VARCHAR(500);
ALTER TABLE slides ADD COLUMN IF NOT EXISTS audio_autoplay BOOLEAN DEFAULT FALSE;
ALTER TABLE slides ADD COLUMN IF NOT EXISTS map_bounds JSONB;
ALTER TABLE slides ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
