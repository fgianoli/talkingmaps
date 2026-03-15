-- Migration 004: Add audio columns to slides table
-- Run on DATA database

ALTER TABLE slides ADD COLUMN IF NOT EXISTS audio_url VARCHAR(500);
ALTER TABLE slides ADD COLUMN IF NOT EXISTS audio_autoplay BOOLEAN DEFAULT FALSE;
