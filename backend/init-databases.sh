#!/bin/bash
set -e

# Create the system database (data DB is created automatically via POSTGRES_DB)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE talkingmaps_system'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'talkingmaps_system')\gexec
EOSQL

# Run system schema on system DB
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "talkingmaps_system" -f /docker-entrypoint-initdb.d/01-setup-system.sql

echo "[INIT] Both databases initialized: talkingmaps_data (PostGIS) + talkingmaps_system"
