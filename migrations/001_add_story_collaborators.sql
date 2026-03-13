-- Migration: Add story_collaborators table
-- Run on DATA database (talkingmaps_data)
-- Date: 2026-03-13

CREATE TABLE IF NOT EXISTS story_collaborators (
    id SERIAL PRIMARY KEY,
    story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'viewer',
    created_at TIMESTAMP DEFAULT NOW(),
    created_by INTEGER,
    UNIQUE(story_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_collaborators_story ON story_collaborators(story_id);
CREATE INDEX IF NOT EXISTS idx_collaborators_user ON story_collaborators(user_id);
