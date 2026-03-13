-- TalkingMaps – SYSTEM Database Schema
-- Contains: users, basemaps, symbologies, presets
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL DEFAULT '',
    display_name VARCHAR(255),
    email VARCHAR(255),
    avatar VARCHAR(500) DEFAULT '',
    role VARCHAR(20) NOT NULL DEFAULT 'viewer',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    auth_provider VARCHAR(20) DEFAULT 'local',
    storage_used_mb NUMERIC(10,2) DEFAULT 0,
    storage_limit_mb NUMERIC(10,2) DEFAULT 100,
    ai_settings JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Basemaps
CREATE TABLE IF NOT EXISTS basemaps (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL,
    url VARCHAR(1000) NOT NULL,
    config JSONB DEFAULT '{}',
    thumbnail VARCHAR(500),
    position INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT TRUE
);

-- Symbology library
CREATE TABLE IF NOT EXISTS symbologies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    layer_id INTEGER,
    geometry_type VARCHAR(20),
    style_type VARCHAR(30) NOT NULL,
    config JSONB NOT NULL DEFAULT '{}',
    maplibre_style JSONB DEFAULT '{}',
    is_default BOOLEAN DEFAULT FALSE,
    owner_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Symbology presets
CREATE TABLE IF NOT EXISTS symbology_presets (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    geometry_type VARCHAR(20),
    style_type VARCHAR(30) NOT NULL,
    config JSONB NOT NULL DEFAULT '{}',
    thumbnail VARCHAR(500),
    position INTEGER DEFAULT 0
);

-- System settings (admin-configurable key-value)
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    description TEXT,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Default settings
INSERT INTO system_settings (key, value, description) VALUES
    ('cesium_ion_token', '', 'Cesium Ion access token for 3D tilesets'),
    ('default_storage_limit_mb', '1024', 'Default storage quota per user in MB'),
    ('max_upload_size_mb', '50', 'Max single file upload size in MB'),
    ('analytics_enabled', 'true', 'Enable story view tracking')
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

-- Default presets
INSERT INTO symbology_presets (name, category, geometry_type, style_type, config, position) VALUES
    ('Red-Yellow-Green', 'color-ramps', NULL, 'graduated',
     '{"colors": ["#d73027","#fc8d59","#fee08b","#d9ef8b","#91cf60","#1a9850"], "steps": 6}', 0),
    ('Blue-White-Red', 'color-ramps', NULL, 'graduated',
     '{"colors": ["#2166ac","#67a9cf","#d1e5f0","#fddbc7","#ef8a62","#b2182b"], "steps": 6}', 1),
    ('Viridis', 'color-ramps', NULL, 'graduated',
     '{"colors": ["#440154","#414487","#2a788e","#22a884","#7ad151","#fde725"], "steps": 6}', 2),
    ('Simple circle', 'point-styles', 'point', 'simple',
     '{"type": "circle", "paint": {"circle-radius": 6, "circle-color": "#3388ff", "circle-stroke-width": 2, "circle-stroke-color": "#ffffff"}}', 0),
    ('Simple line', 'line-styles', 'line', 'simple',
     '{"paint": {"line-color": "#3388ff", "line-width": 3, "line-opacity": 0.8}}', 0),
    ('Simple polygon', 'polygon-styles', 'polygon', 'simple',
     '{"paint": {"fill-color": "#3388ff", "fill-opacity": 0.4, "fill-outline-color": "#2266cc"}}', 0)
ON CONFLICT DO NOTHING;
