-- Per-user Copernicus (CDSE) credentials.
-- Runs on the SYSTEM database, where users live.
--
-- Shaped like ai_settings: a JSONB blob holding the client id in the clear and the
-- client secret encrypted with the application key. Credentials belong to a person
-- because CDSE meters usage against whoever makes the request, so there is
-- deliberately no server-wide fallback for real requests.

ALTER TABLE users ADD COLUMN IF NOT EXISTS cdse_settings JSONB DEFAULT '{}';
