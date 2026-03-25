-- Service Catalog: personal GIS service endpoints (WMS, WFS, WMTS, Vector Tiles)
CREATE TABLE IF NOT EXISTS service_catalog (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    service_type VARCHAR(50) NOT NULL,  -- wms, wfs, wmts, xyz, vector-tiles
    url VARCHAR(1000) NOT NULL,
    description TEXT,
    auth_config JSONB DEFAULT '{}',
    capabilities_cache JSONB,
    last_checked TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_service_catalog_owner ON service_catalog(owner_id);
