-- TalkingMaps Database Schema
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ══════════════════════════════════════
-- Users
-- ══════════════════════════════════════
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    email VARCHAR(255),
    role VARCHAR(20) NOT NULL DEFAULT 'viewer',  -- admin, editor, viewer
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ══════════════════════════════════════
-- Stories (storymaps)
-- ══════════════════════════════════════
CREATE TABLE IF NOT EXISTS stories (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(255) UNIQUE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    cover_image VARCHAR(500),
    author_id INTEGER REFERENCES users(id),
    status VARCHAR(20) NOT NULL DEFAULT 'draft',  -- draft, published, archived
    visibility VARCHAR(20) NOT NULL DEFAULT 'private',  -- public, private, unlisted
    share_token VARCHAR(64) UNIQUE DEFAULT uuid_generate_v4()::text,
    theme JSONB DEFAULT '{}',
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stories_author ON stories(author_id);
CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status);
CREATE INDEX IF NOT EXISTS idx_stories_slug ON stories(slug);

-- ══════════════════════════════════════
-- Slides (chapters of a story)
-- ══════════════════════════════════════
CREATE TABLE IF NOT EXISTS slides (
    id SERIAL PRIMARY KEY,
    story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    title VARCHAR(500),
    narrative TEXT,                          -- HTML content
    position INTEGER NOT NULL DEFAULT 0,    -- ordering
    visible BOOLEAN NOT NULL DEFAULT TRUE,
    layout VARCHAR(50) DEFAULT 'side-left', -- side-left, side-right, center, full-map, full-media, cover
    -- Map state for this slide
    map_center JSONB,                       -- {lng, lat}
    map_zoom NUMERIC(5,2),
    map_bearing NUMERIC(6,2) DEFAULT 0,
    map_pitch NUMERIC(5,2) DEFAULT 0,
    map_bounds JSONB,                       -- [[sw_lng, sw_lat], [ne_lng, ne_lat]]
    map_animation VARCHAR(20) DEFAULT 'flyTo',  -- flyTo, jumpTo, easeTo
    -- Visible layers override for this slide
    layer_visibility JSONB DEFAULT '{}',    -- {layer_id: true/false}
    -- Media
    background_media VARCHAR(500),          -- image/video URL
    background_opacity NUMERIC(3,2) DEFAULT 1.0,
    -- Custom CSS/styling
    style_overrides JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_slides_story ON slides(story_id);
CREATE INDEX IF NOT EXISTS idx_slides_position ON slides(story_id, position);

-- ══════════════════════════════════════
-- Layers (reusable map layers)
-- ══════════════════════════════════════
CREATE TABLE IF NOT EXISTS layers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    layer_type VARCHAR(50) NOT NULL,        -- geojson, wms, wmts, xyz, vector-tiles
    source_config JSONB NOT NULL,           -- {url, params, attribution, ...}
    style_config JSONB DEFAULT '{}',        -- MapLibre style spec
    legend_config JSONB DEFAULT '{}',       -- legend entries
    owner_id INTEGER REFERENCES users(id),
    public BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_layers_owner ON layers(owner_id);

-- ══════════════════════════════════════
-- Story-Layer association
-- ══════════════════════════════════════
CREATE TABLE IF NOT EXISTS story_layers (
    id SERIAL PRIMARY KEY,
    story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    layer_id INTEGER NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    visible BOOLEAN NOT NULL DEFAULT TRUE,
    opacity NUMERIC(3,2) DEFAULT 1.0,
    custom_style JSONB DEFAULT '{}',        -- per-story style override
    UNIQUE(story_id, layer_id)
);

-- ══════════════════════════════════════
-- Markers (points of interest on slides)
-- ══════════════════════════════════════
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

-- ══════════════════════════════════════
-- Media library
-- ══════════════════════════════════════
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
    owner_id INTEGER REFERENCES users(id),
    story_id INTEGER REFERENCES stories(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_media_owner ON media(owner_id);
CREATE INDEX IF NOT EXISTS idx_media_story ON media(story_id);

-- ══════════════════════════════════════
-- Basemaps (available base layers)
-- ══════════════════════════════════════
CREATE TABLE IF NOT EXISTS basemaps (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL,              -- xyz, wms, wmts, style
    url VARCHAR(1000) NOT NULL,
    config JSONB DEFAULT '{}',
    thumbnail VARCHAR(500),
    position INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT TRUE
);

-- ══════════════════════════════════════
-- Symbology library (reusable styles)
-- ══════════════════════════════════════
CREATE TABLE IF NOT EXISTS symbologies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    layer_id INTEGER REFERENCES layers(id) ON DELETE SET NULL,
    geometry_type VARCHAR(20),              -- point, line, polygon, raster
    style_type VARCHAR(30) NOT NULL,        -- simple, graduated, categorized, rule-based, heatmap, cluster, icon, label, pattern, raster-filter
    config JSONB NOT NULL DEFAULT '{}',     -- full style configuration
    maplibre_style JSONB DEFAULT '{}',      -- pre-compiled MapLibre paint/layout
    is_default BOOLEAN DEFAULT FALSE,
    owner_id INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_symbologies_layer ON symbologies(layer_id);
CREATE INDEX IF NOT EXISTS idx_symbologies_owner ON symbologies(owner_id);

-- ══════════════════════════════════════
-- Symbology presets (templates)
-- ══════════════════════════════════════
CREATE TABLE IF NOT EXISTS symbology_presets (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100),                  -- color-ramps, point-styles, line-styles, polygon-styles
    geometry_type VARCHAR(20),
    style_type VARCHAR(30) NOT NULL,
    config JSONB NOT NULL DEFAULT '{}',
    thumbnail VARCHAR(500),
    position INTEGER DEFAULT 0
);

-- Default color ramps
INSERT INTO symbology_presets (name, category, geometry_type, style_type, config, position) VALUES
    ('Rosso → Giallo → Verde', 'color-ramps', NULL, 'graduated',
     '{"colors": ["#d73027","#fc8d59","#fee08b","#d9ef8b","#91cf60","#1a9850"], "steps": 6}', 0),
    ('Blu → Bianco → Rosso', 'color-ramps', NULL, 'graduated',
     '{"colors": ["#2166ac","#67a9cf","#d1e5f0","#fddbc7","#ef8a62","#b2182b"], "steps": 6}', 1),
    ('Viridis', 'color-ramps', NULL, 'graduated',
     '{"colors": ["#440154","#414487","#2a788e","#22a884","#7ad151","#fde725"], "steps": 6}', 2),
    ('Blues', 'color-ramps', NULL, 'graduated',
     '{"colors": ["#f7fbff","#c6dbef","#6baed6","#2171b5","#08306b"], "steps": 5}', 3),
    ('Cerchio semplice', 'point-styles', 'point', 'simple',
     '{"type": "circle", "paint": {"circle-radius": 6, "circle-color": "#3388ff", "circle-stroke-width": 2, "circle-stroke-color": "#ffffff"}}', 0),
    ('Linea semplice', 'line-styles', 'line', 'simple',
     '{"paint": {"line-color": "#3388ff", "line-width": 3, "line-opacity": 0.8}}', 0),
    ('Poligono semplice', 'polygon-styles', 'polygon', 'simple',
     '{"paint": {"fill-color": "#3388ff", "fill-opacity": 0.4, "fill-outline-color": "#2266cc"}}', 0)
ON CONFLICT DO NOTHING;

-- Default basemaps
INSERT INTO basemaps (name, type, url, config, position) VALUES
    ('OpenStreetMap', 'xyz', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
     '{"attribution": "&copy; OpenStreetMap contributors", "maxzoom": 19}', 0),
    ('Satellite (ESRI)', 'xyz', 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
     '{"attribution": "&copy; Esri", "maxzoom": 18}', 1),
    ('CartoDB Positron', 'xyz', 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
     '{"attribution": "&copy; CartoDB", "maxzoom": 20}', 2),
    ('CartoDB Dark Matter', 'xyz', 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
     '{"attribution": "&copy; CartoDB", "maxzoom": 20}', 3),
    ('Stadia Stamen Watercolor', 'xyz', 'https://tiles.stadiamaps.com/tiles/stamen_watercolor/{z}/{x}/{y}.jpg',
     '{"attribution": "&copy; Stamen Design", "maxzoom": 16}', 4)
ON CONFLICT DO NOTHING;
