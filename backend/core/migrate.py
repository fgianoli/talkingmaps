"""Schema migrations.

The initial schema is created by the SQL in ``docker-entrypoint-initdb.d``, but
Postgres runs those files only when the data directory is empty. Every change made
after the first ``docker compose up`` therefore has to arrive as a migration, and
until now nothing applied them: six files sat in the repo while four tables the code
queries were simply missing from running installations.

Migrations are plain ``.sql`` files in ``backend/migrations``, applied in filename
order and recorded in ``schema_migrations`` so each runs once. They are written to be
re-runnable anyway (``IF NOT EXISTS``, ``ON CONFLICT DO NOTHING``), which is what lets
an installation that was migrated by hand adopt this runner without conflict.
"""

import logging
import os

from sqlalchemy import text

logger = logging.getLogger("talkingmaps.migrate")

MIGRATIONS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "migrations")

_TRACKING_TABLE = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT NOW()
)
"""


def _migration_files() -> list[str]:
    if not os.path.isdir(MIGRATIONS_DIR):
        return []
    return sorted(f for f in os.listdir(MIGRATIONS_DIR) if f.endswith(".sql"))


async def _execute_script(conn, sql: str) -> None:
    """Run a multi-statement SQL script on an async connection.

    asyncpg prepares anything sent through SQLAlchemy's ``execute``, and a prepared
    statement may hold only one command — a migration file holds several. Reaching the
    driver connection directly and calling it without arguments uses Postgres' simple
    query protocol, which accepts a whole script. It still runs inside the transaction
    SQLAlchemy opened, so a failure half-way rolls the file back.
    """
    raw = await conn.get_raw_connection()
    driver_conn = getattr(raw, "driver_connection", None)
    if driver_conn is not None and hasattr(driver_conn, "execute"):
        await driver_conn.execute(sql)
    else:
        # Other drivers (psycopg, sqlite in tests) handle scripts through SQLAlchemy
        await conn.execute(text(sql))


async def run_migrations(engine) -> dict:
    """Apply every migration this database has not seen yet.

    Each file runs in its own transaction: one failure does not roll back the
    migrations that already succeeded, and it does not stop the application from
    starting — a broken migration should be visible in the logs, not turn the whole
    service into a boot loop.

    Returns a summary dict for logging and tests.
    """
    applied: list[str] = []
    skipped: list[str] = []
    failed: list[tuple[str, str]] = []

    files = _migration_files()
    if not files:
        logger.warning("No migration files found in %s", MIGRATIONS_DIR)
        return {"applied": applied, "skipped": skipped, "failed": failed}

    async with engine.begin() as conn:
        await conn.execute(text(_TRACKING_TABLE))
        rows = await conn.execute(text("SELECT filename FROM schema_migrations"))
        done = {r[0] for r in rows.fetchall()}

    for filename in files:
        if filename in done:
            skipped.append(filename)
            continue

        path = os.path.join(MIGRATIONS_DIR, filename)
        with open(path, "r", encoding="utf-8") as fh:
            sql = fh.read().strip()
        if not sql:
            skipped.append(filename)
            continue

        try:
            async with engine.begin() as conn:
                await _execute_script(conn, sql)
                await conn.execute(
                    text("INSERT INTO schema_migrations (filename) VALUES (:f) ON CONFLICT DO NOTHING"),
                    {"f": filename},
                )
            applied.append(filename)
            logger.info("Migration applied: %s", filename)
        except Exception as exc:  # noqa: BLE001 - reported, never fatal at boot
            failed.append((filename, str(exc)))
            logger.error("Migration FAILED: %s — %s", filename, exc)

    if applied:
        logger.info("Migrations applied: %d (%s)", len(applied), ", ".join(applied))
    if failed:
        logger.error("Migrations failed: %d — the app is starting anyway, fix and restart", len(failed))

    return {"applied": applied, "skipped": skipped, "failed": failed}
