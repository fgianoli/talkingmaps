-- TalkingMaps – DATA Database Schema
-- Contains: stories, slides, markers, layers, media
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Stories
CREATE TABLE IF NOT EXISTS stories (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(255) UNIQUE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    cover_image VARCHAR(500),
    author_id INTEGER,  -- references users in system DB (soft ref)
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    visibility VARCHAR(20) NOT NULL DEFAULT 'private',
    share_token VARCHAR(64) UNIQUE DEFAULT uuid_generate_v4()::text,
    theme JSONB DEFAULT '{}',
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stories_author ON stories(author_id);
CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status);
CREATE INDEX IF NOT EXISTS idx_stories_slug ON stories(slug);

-- Slides
CREATE TABLE IF NOT EXISTS slides (
    id SERIAL PRIMARY KEY,
    story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    title VARCHAR(500),
    narrative TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    visible BOOLEAN NOT NULL DEFAULT TRUE,
    layout VARCHAR(50) DEFAULT 'side-left',
    map_center JSONB,
    map_zoom NUMERIC(5,2),
    map_bearing NUMERIC(6,2) DEFAULT 0,
    map_pitch NUMERIC(5,2) DEFAULT 0,
    map_bounds JSONB,
    map_animation VARCHAR(20) DEFAULT 'flyTo',
    layer_visibility JSONB DEFAULT '{}',
    background_media VARCHAR(500),
    background_opacity NUMERIC(3,2) DEFAULT 1.0,
    basemap_id INTEGER,
    map_config JSONB DEFAULT '{}',
    audio_url VARCHAR(500),
    audio_autoplay BOOLEAN DEFAULT FALSE,
    style_overrides JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_slides_story ON slides(story_id);
CREATE INDEX IF NOT EXISTS idx_slides_position ON slides(story_id, position);

-- Layers
CREATE TABLE IF NOT EXISTS layers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    layer_type VARCHAR(50) NOT NULL,
    source_config JSONB NOT NULL,
    style_config JSONB DEFAULT '{}',
    legend_config JSONB DEFAULT '{}',
    owner_id INTEGER,  -- soft ref to system.users
    public BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_layers_owner ON layers(owner_id);

-- Story-Layer association
CREATE TABLE IF NOT EXISTS story_layers (
    id SERIAL PRIMARY KEY,
    story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    layer_id INTEGER NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    visible BOOLEAN NOT NULL DEFAULT TRUE,
    opacity NUMERIC(3,2) DEFAULT 1.0,
    custom_style JSONB DEFAULT '{}',
    UNIQUE(story_id, layer_id)
);

-- Markers
CREATE TABLE IF NOT EXISTS markers (
    id SERIAL PRIMARY KEY,
    slide_id INTEGER NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
    geom GEOMETRY(Point, 4326),
    title VARCHAR(500),
    popup_content TEXT,
    icon VARCHAR(100) DEFAULT 'marker',
    color VARCHAR(20) DEFAULT '#e74c3c',
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_markers_slide ON markers(slide_id);
CREATE INDEX IF NOT EXISTS idx_markers_geom ON markers USING GIST(geom);

-- Media library
CREATE TABLE IF NOT EXISTS media (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(500) NOT NULL,
    original_name VARCHAR(500),
    mime_type VARCHAR(100),
    file_size BIGINT,
    file_path VARCHAR(500) NOT NULL,
    thumbnail_path VARCHAR(500),
    width INTEGER,
    height INTEGER,
    owner_id INTEGER,  -- soft ref to system.users
    story_id INTEGER REFERENCES stories(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_media_owner ON media(owner_id);
CREATE INDEX IF NOT EXISTS idx_media_story ON media(story_id);

-- 3D Assets (point clouds, meshes, tilesets, terrain)
CREATE TABLE IF NOT EXISTS assets_3d (
    id SERIAL PRIMARY KEY,
    asset_id VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(30) NOT NULL,   -- pointcloud, mesh, tileset, terrain, kml
    format VARCHAR(10) NOT NULL,     -- .las, .glb, .zip, etc.
    file_size BIGINT,
    serve_url VARCHAR(500),
    viewer_type VARCHAR(20),         -- cesium, potree
    original_filename VARCHAR(500),
    info JSONB DEFAULT '{}',         -- conversion results, bounds, point count, etc.
    owner_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assets3d_owner ON assets_3d(owner_id);
CREATE INDEX IF NOT EXISTS idx_assets3d_category ON assets_3d(category);

-- Story analytics (view tracking)
CREATE TABLE IF NOT EXISTS story_views (
    id SERIAL PRIMARY KEY,
    story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    viewer_ip VARCHAR(45),
    user_agent TEXT,
    referrer TEXT,
    viewed_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_views_story ON story_views(story_id);
CREATE INDEX IF NOT EXISTS idx_views_date ON story_views(viewed_at);

-- Story collaborators (per-story sharing with roles)
CREATE TABLE IF NOT EXISTS story_collaborators (
    id SERIAL PRIMARY KEY,
    story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,  -- soft ref to system.users
    role VARCHAR(20) NOT NULL DEFAULT 'viewer',  -- 'editor', 'viewer'
    created_at TIMESTAMP DEFAULT NOW(),
    created_by INTEGER,  -- who invited them (soft ref)
    UNIQUE(story_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_collaborators_story ON story_collaborators(story_id);
CREATE INDEX IF NOT EXISTS idx_collaborators_user ON story_collaborators(user_id);

-- Story version snapshots
CREATE TABLE IF NOT EXISTS story_versions (
    id SERIAL PRIMARY KEY,
    story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL DEFAULT 1,
    snapshot JSONB NOT NULL,
    created_by INTEGER,
    message VARCHAR(500),
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_versions_story ON story_versions(story_id);

-- Participatory map contributions
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
