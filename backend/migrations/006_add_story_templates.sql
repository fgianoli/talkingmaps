-- Migration 006: Add story_templates table with pre-built system templates

CREATE TABLE IF NOT EXISTS story_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    icon VARCHAR(50) DEFAULT 'bi-file-earmark',
    template_data JSONB NOT NULL DEFAULT '{}',
    thumbnail VARCHAR(500),
    position INTEGER DEFAULT 0,
    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO story_templates (name, description, category, icon, template_data, position, is_system) VALUES
    ('Environmental Report', 'Map-driven environmental analysis with satellite comparison, data layers, and charts.', 'science', 'bi-tree',
     '{"slides": [{"layout": "cover", "title": "Environmental Report", "narrative": "<h2>Environmental Report</h2><p>An analysis of environmental changes using satellite imagery and data.</p>"}, {"layout": "side-left", "title": "Study Area", "narrative": "<h3>Study Area</h3><p>Description of the geographic area under study.</p>", "map_animation": "flyTo"}, {"layout": "side-right", "title": "Satellite Comparison", "narrative": "<h3>Before & After</h3><p>Use the map swipe tool to compare imagery from different dates.</p>", "map_animation": "easeTo"}, {"layout": "center", "title": "Data Analysis", "narrative": "<h3>Key Findings</h3><p>Add your charts and data visualizations here.</p>"}, {"layout": "side-left", "title": "Conclusions", "narrative": "<h3>Conclusions</h3><p>Summary of findings and recommendations.</p>"}]}', 0, TRUE),
    ('Tourist Tour', 'Guided tour through points of interest with photos, descriptions and cinematic transitions.', 'tourism', 'bi-geo-alt',
     '{"slides": [{"layout": "cover", "title": "City Tour", "narrative": "<h2>Welcome!</h2><p>Discover the most beautiful places in our guided tour.</p>"}, {"layout": "side-left", "title": "Stop 1", "narrative": "<h3>First Stop</h3><p>Add description, photos and facts about this location.</p>", "map_animation": "cinematic"}, {"layout": "side-right", "title": "Stop 2", "narrative": "<h3>Second Stop</h3><p>Continue your journey with another point of interest.</p>", "map_animation": "cinematic"}, {"layout": "side-left", "title": "Stop 3", "narrative": "<h3>Third Stop</h3><p>Keep exploring!</p>", "map_animation": "cinematic"}, {"layout": "full-map", "title": "Full Route", "narrative": "", "map_animation": "flyTo"}, {"layout": "cover", "title": "Thank You", "narrative": "<h2>Thanks for joining!</h2><p>We hope you enjoyed the tour.</p>"}]}', 1, TRUE),
    ('Historical Timeline', 'Chronicle events across time and space with maps, timelines and archival media.', 'history', 'bi-clock-history',
     '{"slides": [{"layout": "cover", "title": "Historical Timeline", "narrative": "<h2>A Journey Through Time</h2><p>Explore how events unfolded across geography and time.</p>"}, {"layout": "side-left", "title": "Origins", "narrative": "<h3>The Beginning</h3><p>Set the historical context.</p>", "map_animation": "flyTo"}, {"layout": "side-right", "title": "Key Event", "narrative": "<h3>Turning Point</h3><p>Describe the pivotal moment.</p>", "map_animation": "cinematic"}, {"layout": "center", "title": "Timeline", "narrative": "<h3>Event Timeline</h3><p>Add a TimelineJS timeline here.</p>"}, {"layout": "side-left", "title": "Legacy", "narrative": "<h3>Impact Today</h3><p>How does this history affect us today?</p>"}]}', 2, TRUE),
    ('Urban Planning', 'Compare urban development scenarios with before/after maps, zoning data and indicators.', 'planning', 'bi-building',
     '{"slides": [{"layout": "cover", "title": "Urban Development Plan", "narrative": "<h2>Urban Development Plan</h2><p>Analyzing proposed changes to the urban landscape.</p>"}, {"layout": "side-left", "title": "Current State", "narrative": "<h3>Current Situation</h3><p>Overview of the existing urban fabric.</p>", "map_animation": "flyTo"}, {"layout": "side-right", "title": "Proposed Changes", "narrative": "<h3>Development Proposal</h3><p>Details of the planned intervention.</p>", "map_animation": "easeTo"}, {"layout": "center", "title": "Impact Analysis", "narrative": "<h3>Key Indicators</h3><p>Add KPI dashboard widgets here.</p>"}, {"layout": "side-left", "title": "Participatory Input", "narrative": "<h3>Community Feedback</h3><p>Enable participatory mode to collect citizen input.</p>"}]}', 3, TRUE),
    ('Data Dashboard', 'Data-driven presentation with charts, KPIs, and thematic maps.', 'data', 'bi-bar-chart',
     '{"slides": [{"layout": "cover", "title": "Data Report", "narrative": "<h2>Data Report</h2><p>Key metrics and spatial analysis.</p>"}, {"layout": "side-left", "title": "Overview Map", "narrative": "<h3>Geographic Distribution</h3><p>Thematic map showing spatial patterns.</p>", "map_animation": "flyTo"}, {"layout": "center", "title": "Key Metrics", "narrative": "<h3>Dashboard</h3><p>Add KPI dashboard widgets.</p>"}, {"layout": "side-right", "title": "Trend Analysis", "narrative": "<h3>Trends</h3><p>Add charts showing temporal trends.</p>"}, {"layout": "side-left", "title": "Heatmap", "narrative": "<h3>Density Analysis</h3><p>Use heatmap layers to visualize density.</p>"}]}', 4, TRUE)
ON CONFLICT DO NOTHING;
