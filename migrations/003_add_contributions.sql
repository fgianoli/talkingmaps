-- Migration 003: Add contributions table for participatory maps
-- Run on DATA database

CREATE TABLE IF NOT EXISTS contributions (
    id SERIAL PRIMARY KEY,
    story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    author_id INTEGER,
    author_name VARCHAR(255),
    geom GEOMETRY(Point, 4326),
    title VARCHAR(500) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    media_url VARCHAR(500),
    media_type VARCHAR(50),
    thumbnail_url VARCHAR(500),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    admin_note TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contributions_story ON contributions(story_id);
CREATE INDEX IF NOT EXISTS idx_contributions_author ON contributions(author_id);
CREATE INDEX IF NOT EXISTS idx_contributions_status ON contributions(status);
CREATE INDEX IF NOT EXISTS idx_contributions_geom ON contributions USING GIST(geom);

-- Add participatory_upload_limit_mb to system_settings (run on SYSTEM database)
-- INSERT INTO system_settings (key, value, description) VALUES
--     ('participatory_upload_limit_mb', '5', 'Max upload size for participatory contributions in MB')
-- ON CONFLICT DO NOTHING;
