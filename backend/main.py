import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from core.config import settings as app_settings
from core.database import engine, engine_system
from core.security import hash_password
from core.migrate import run_migrations
from core.seed_demo import seed_demo_stories
from routers import auth, stories, slides, media, layers, basemaps, wms_proxy, wfs_proxy, services, users, symbology, ckan, upload3d, settings as settings_router, ai as ai_router, oauth, geodata, contributions


# Ensure upload directory exists before StaticFiles mount
os.makedirs(app_settings.UPLOAD_DIR, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create upload subdirectories
    for subdir in ["images", "videos", "audio", "docs", "layers", "3d", "avatars"]:
        os.makedirs(os.path.join(app_settings.UPLOAD_DIR, subdir), exist_ok=True)
    print(f"[INIT] Upload directories ready at {app_settings.UPLOAD_DIR}")

    # Bring the data schema up to date. The init SQL only ever runs on an empty data
    # directory, so without this an existing installation silently misses every table
    # added after its first start.
    try:
        result = await run_migrations(engine)
        if result["applied"]:
            print(f"[INIT] Migrations applied: {', '.join(result['applied'])}")
        else:
            print(f"[INIT] Schema up to date ({len(result['skipped'])} migrations already applied)")
        for filename, err in result["failed"]:
            print(f"[INIT] MIGRATION FAILED {filename}: {err}")
    except Exception as e:
        print(f"[INIT] Migration runner error: {e}")

    # Create initial admin user if not exists (in system DB)
    admin_id = None
    try:
        async with engine_system.begin() as conn:
            result = await conn.execute(text("SELECT id FROM users WHERE username = :u"), {"u": app_settings.ADMIN_USERNAME})
            row = result.fetchone()
            if not row:
                pw = hash_password(app_settings.ADMIN_PASSWORD)
                created = await conn.execute(
                    text("INSERT INTO users (username, password_hash, display_name, role) VALUES (:u, :p, :d, 'admin') RETURNING id"),
                    {"u": app_settings.ADMIN_USERNAME, "p": pw, "d": "Amministratore"},
                )
                admin_id = created.fetchone()[0]
                print(f"[INIT] Admin user '{app_settings.ADMIN_USERNAME}' created")
            else:
                admin_id = row[0]
    except Exception as e:
        print(f"[INIT] DB init warning: {e}")

    # Sample public storymaps, so a fresh install shows what the tool can do
    if app_settings.SEED_DEMO_STORIES and admin_id is not None:
        try:
            seeded = await seed_demo_stories(engine, admin_id)
            if seeded["created"]:
                print(f"[INIT] Demo stories created: {', '.join(seeded['created'])}")
            for filename, err in seeded["failed"]:
                print(f"[INIT] DEMO SEED FAILED {filename}: {err}")
        except Exception as e:
            print(f"[INIT] Demo seed error: {e}")
    yield
    await engine.dispose()
    await engine_system.dispose()


app = FastAPI(
    title="TalkingMaps API",
    version="2.0.0",
    description="Backend API for TalkingMaps - Interactive Storymaps",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=app_settings.origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Accept", "Accept-Language"],
)

# Mount upload directory for serving media files
app.mount("/uploads", StaticFiles(directory=app_settings.UPLOAD_DIR), name="uploads")

# Register routers
app.include_router(auth.router, prefix="/api/auth", tags=["Autenticazione"])
app.include_router(users.router, prefix="/api/users", tags=["Utenti"])
app.include_router(stories.router, prefix="/api/stories", tags=["Storie"])
app.include_router(slides.router, prefix="/api/slides", tags=["Slide"])
app.include_router(layers.router, prefix="/api/layers", tags=["Layer"])
app.include_router(symbology.router, prefix="/api/symbology", tags=["Simbologia"])
app.include_router(media.router, prefix="/api/media", tags=["Media"])
app.include_router(basemaps.router, prefix="/api/basemaps", tags=["Basemap"])
app.include_router(wms_proxy.router, prefix="/api/wms-proxy", tags=["WMS Proxy"])
app.include_router(wfs_proxy.router, prefix="/api/wfs-proxy", tags=["WFS Proxy"])
app.include_router(services.router, prefix="/api/services", tags=["Service Catalog"])
app.include_router(ckan.router, prefix="/api/ckan", tags=["CKAN Open Data"])
app.include_router(upload3d.router, prefix="/api/3d", tags=["Dati 3D"])
app.include_router(settings_router.router, prefix="/api/settings", tags=["Impostazioni"])
app.include_router(ai_router.router, prefix="/api/ai", tags=["AI Assistant"])
app.include_router(oauth.router, prefix="/api/oauth", tags=["OAuth"])
app.include_router(geodata.router, prefix="/api/geodata", tags=["Geodata (Wikipedia, OSM)"])
app.include_router(contributions.router, prefix="/api/contributions", tags=["Mappe Partecipate"])


@app.get("/health")
async def health():
    return {"status": "ok"}
