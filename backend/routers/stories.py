import json
import hashlib
import re
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db, get_system_db
from core.security import get_current_user, get_current_user_optional, require_editor

router = APIRouter()


async def _check_story_access(db: AsyncSession, system_db: AsyncSession, story_id: int, user: dict, require_role: str = "viewer") -> str | None:
    """Check if user has access to a story. Returns the effective role or None."""
    if user["role"] == "admin":
        return "owner"
    # Check ownership
    owner_check = await db.execute(text("SELECT author_id FROM stories WHERE id = :id"), {"id": story_id})
    owner_row = owner_check.fetchone()
    if not owner_row:
        return None
    if owner_row[0] == user["id"]:
        return "owner"
    # Check collaborator role
    collab = await db.execute(
        text("SELECT role FROM story_collaborators WHERE story_id = :sid AND user_id = :uid"),
        {"sid": story_id, "uid": user["id"]},
    )
    collab_row = collab.fetchone()
    if not collab_row:
        return None
    collab_role = collab_row[0]  # 'editor' or 'viewer'
    if require_role == "editor" and collab_role == "viewer":
        return None  # viewer can't edit
    return collab_role


async def _can_read_story(db: AsyncSession, story: dict, user: dict | None) -> bool:
    """Whether a caller may read a story in full.

    Published public/unlisted stories are readable by anyone; anything else only by
    its author, its collaborators, or an admin. Callers should answer a failure with
    404 rather than 403, so the endpoint does not confirm that the story exists.
    """
    if story.get("status") == "published" and story.get("visibility") in ("public", "unlisted"):
        return True
    if not user:
        return False
    if user["role"] == "admin" or story.get("author_id") == user["id"]:
        return True
    collab = await db.execute(
        text("SELECT 1 FROM story_collaborators WHERE story_id = :sid AND user_id = :uid"),
        {"sid": story["id"], "uid": user["id"]},
    )
    return collab.fetchone() is not None


def _hash_ip(ip: str | None) -> str | None:
    """Hash IP address for GDPR compliance - store only anonymized fingerprint."""
    if not ip:
        return None
    return hashlib.sha256(ip.encode()).hexdigest()[:16]


def slugify(title: str) -> str:
    slug = re.sub(r"[^\w\s-]", "", title.lower().strip())
    return re.sub(r"[-\s]+", "-", slug)


class StoryCreate(BaseModel):
    title: str
    description: str | None = None
    visibility: str = "private"
    theme: dict = {}
    settings: dict = {}


class StoryUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    cover_image: str | None = None
    status: str | None = None
    visibility: str | None = None
    theme: dict | None = None
    settings: dict | None = None


@router.get("/")
async def list_stories(
    status: str | None = None,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List stories. Admins see all, editors see own + shared, viewers see public."""
    if user["role"] == "admin":
        q = """SELECT s.*, COALESCE(v.view_count, 0) as view_count, NULL as collab_role
               FROM stories s
               LEFT JOIN (SELECT story_id, COUNT(*) as view_count FROM story_views GROUP BY story_id) v ON v.story_id = s.id"""
        params = {}
        if status:
            q += " WHERE s.status = :status"
            params["status"] = status
        q += " ORDER BY s.updated_at DESC"
    elif user["role"] == "editor":
        # Own stories + stories shared with this user
        q = """SELECT s.*, COALESCE(v.view_count, 0) as view_count, sc.role as collab_role
               FROM stories s
               LEFT JOIN (SELECT story_id, COUNT(*) as view_count FROM story_views GROUP BY story_id) v ON v.story_id = s.id
               LEFT JOIN story_collaborators sc ON sc.story_id = s.id AND sc.user_id = :uid
               WHERE (s.author_id = :uid OR sc.user_id = :uid)"""
        params = {"uid": user["id"]}
        if status:
            # The OR group must stay parenthesised: AND binds tighter, so without the
            # brackets the status filter silently stops applying to the caller's own stories
            q += " AND s.status = :status"
            params["status"] = status
        q += " ORDER BY s.updated_at DESC"
    else:
        q = """SELECT s.*, COALESCE(v.view_count, 0) as view_count, sc.role as collab_role
               FROM stories s
               LEFT JOIN (SELECT story_id, COUNT(*) as view_count FROM story_views GROUP BY story_id) v ON v.story_id = s.id
               LEFT JOIN story_collaborators sc ON sc.story_id = s.id AND sc.user_id = :uid
               WHERE (s.status = 'published' AND s.visibility = 'public') OR sc.user_id = :uid
               ORDER BY s.updated_at DESC"""
        params = {"uid": user["id"]}
    result = await db.execute(text(q), params)
    return [dict(r) for r in result.mappings().all()]


@router.get("/public")
async def list_public_stories(db: AsyncSession = Depends(get_db)):
    """Public endpoint: no auth needed."""
    result = await db.execute(text(
        """SELECT s.id, s.slug, s.title, s.description, s.cover_image, s.theme,
                  s.author_id, s.created_at, s.updated_at
           FROM stories s
           WHERE s.status = 'published' AND s.visibility = 'public'
           ORDER BY s.updated_at DESC"""
    ))
    return [dict(r) for r in result.mappings().all()]


@router.post("/import")
async def import_story(user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db), file: UploadFile = File(...)):
    """Import a story from a TalkingMaps JSON export."""
    import json as json_module
    content = await file.read()
    try:
        data = json_module.loads(content)
    except Exception:
        raise HTTPException(400, "JSON non valido")

    if "talkingmaps_version" not in data:
        raise HTTPException(400, "Non è un export TalkingMaps valido")

    story_data = data.get("story", {})
    # Create story
    slug = (story_data.get("title", "imported") or "imported").lower().replace(" ", "-")[:50] + "-" + uuid.uuid4().hex[:6]
    result = await db.execute(text(
        "INSERT INTO stories (slug, title, description, author_id, status, visibility, theme, settings) "
        "VALUES (:slug, :title, :desc, :uid, 'draft', 'private', CAST(:theme AS jsonb), CAST(:settings AS jsonb)) RETURNING id"
    ), {
        "slug": slug, "title": story_data.get("title", "Imported story"),
        "desc": story_data.get("description", ""), "uid": user["id"],
        "theme": json_module.dumps(story_data.get("theme", {})),
        "settings": json_module.dumps(story_data.get("settings", {})),
    })
    story_id = result.fetchone()[0]

    # Create slides
    for idx, slide_data in enumerate(data.get("slides", [])):
        markers = slide_data.pop("markers", [])
        slide_result = await db.execute(text(
            "INSERT INTO slides (story_id, title, narrative, position, visible, layout, map_center, map_zoom, "
            "map_bearing, map_pitch, map_animation, layer_visibility, background_media, background_opacity, style_overrides) "
            "VALUES (:sid, :title, :narrative, :pos, :vis, :layout, CAST(:center AS jsonb), :zoom, :bearing, :pitch, "
            ":anim, CAST(:lv AS jsonb), :bg, :opacity, CAST(:style AS jsonb)) RETURNING id"
        ), {
            "sid": story_id, "title": slide_data.get("title", ""),
            "narrative": slide_data.get("narrative", ""), "pos": idx,
            "vis": slide_data.get("visible", True), "layout": slide_data.get("layout", "side-left"),
            "center": json_module.dumps(slide_data.get("map_center")) if slide_data.get("map_center") else None,
            "zoom": slide_data.get("map_zoom"), "bearing": slide_data.get("map_bearing", 0),
            "pitch": slide_data.get("map_pitch", 0), "anim": slide_data.get("map_animation", "flyTo"),
            "lv": json_module.dumps(slide_data.get("layer_visibility", {})),
            "bg": slide_data.get("background_media", ""), "opacity": slide_data.get("background_opacity", 1),
            "style": json_module.dumps(slide_data.get("style_overrides", {})),
        })
        slide_id = slide_result.fetchone()[0]

        # Create markers
        for m in markers:
            await db.execute(text(
                "INSERT INTO markers (slide_id, geom, title, popup_content, icon, color) "
                "VALUES (:sid, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), :title, :content, :icon, :color)"
            ), {
                "sid": slide_id, "lng": m.get("lng", 0), "lat": m.get("lat", 0),
                "title": m.get("title", ""), "content": m.get("popup_content", ""),
                "icon": m.get("icon", "marker"), "color": m.get("color", "#e74c3c"),
            })

    await db.commit()
    return {"id": story_id, "detail": "Storia importata con successo"}


@router.get("/shared/{token}")
async def get_shared_story(token: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Access story via share token (no auth)."""
    result = await db.execute(text(
        """SELECT s.* FROM stories s
           WHERE s.share_token = :token AND s.status = 'published'"""
    ), {"token": token})
    story = result.mappings().fetchone()
    if not story:
        raise HTTPException(status_code=404, detail="Storia non trovata")
    # Record view
    try:
        await db.execute(text(
            "INSERT INTO story_views (story_id, viewer_ip, user_agent, referrer) VALUES (:sid, :ip, :ua, :ref)"
        ), {"sid": story["id"], "ip": _hash_ip(request.client.host if request.client else None),
            "ua": request.headers.get("user-agent", "")[:500], "ref": request.headers.get("referer", "")[:500]})
        await db.commit()
    except Exception:
        # A failed insert leaves the session dirty; without a rollback every later
        # statement in this request fails too.
        await db.rollback()
    return dict(story)


@router.get("/{story_id}/embed")
async def get_story_embed(story_id: int, request: Request, db: AsyncSession = Depends(get_db), system_db: AsyncSession = Depends(get_system_db)):
    """Get full story data for embed mode (no auth, only public/shared stories)."""
    story_r = await db.execute(text(
        "SELECT s.* FROM stories s WHERE s.id = :id AND s.status = 'published' AND s.visibility IN ('public', 'unlisted')"
    ), {"id": story_id})
    story = story_r.mappings().fetchone()
    if not story:
        raise HTTPException(status_code=404, detail="Storia non trovata o non pubblica")

    # Record view
    try:
        await db.execute(text(
            "INSERT INTO story_views (story_id, viewer_ip, user_agent, referrer) VALUES (:sid, :ip, :ua, :ref)"
        ), {"sid": story_id, "ip": _hash_ip(request.client.host if request.client else None),
            "ua": request.headers.get("user-agent", "")[:500], "ref": request.headers.get("referer", "")[:500]})
        await db.commit()
    except Exception:
        # A failed insert leaves the session dirty; without a rollback every later
        # statement in this request fails too.
        await db.rollback()

    # Slides
    slides_r = await db.execute(text(
        "SELECT * FROM slides WHERE story_id = :sid ORDER BY position"
    ), {"sid": story_id})
    slides = [dict(s) for s in slides_r.mappings().all()]

    # Markers
    slide_ids = [s["id"] for s in slides]
    markers = []
    if slide_ids:
        markers_r = await db.execute(text(
            "SELECT id, slide_id, ST_X(geom) as lng, ST_Y(geom) as lat, title, popup_content, icon, color FROM markers WHERE slide_id = ANY(:ids)"
        ), {"ids": slide_ids})
        markers = [dict(m) for m in markers_r.mappings().all()]

    # Story layers
    layers_r = await db.execute(text(
        """SELECT sl.*, l.name as layer_name, l.layer_type, l.source_config, l.style_config, l.legend_config
           FROM story_layers sl JOIN layers l ON sl.layer_id = l.id
           WHERE sl.story_id = :sid ORDER BY sl.position"""
    ), {"sid": story_id})
    layers = [dict(l) for l in layers_r.mappings().all()]

    # Basemaps
    basemaps_r = await system_db.execute(text("SELECT * FROM basemaps WHERE active = TRUE ORDER BY position"))
    basemaps = [dict(b) for b in basemaps_r.mappings().all()]

    # Cesium Ion token (system DB)
    cesium_token = ""
    try:
        token_r = await system_db.execute(text("SELECT value FROM system_settings WHERE key = 'cesium_ion_token'"))
        token_row = token_r.fetchone()
        if token_row and token_row[0]:
            cesium_token = token_row[0]
    except Exception:
        await system_db.rollback()

    story_dict = dict(story)
    settings = story_dict.get("settings") or {}
    if isinstance(settings, str):
        import json
        settings = json.loads(settings)
    if cesium_token:
        settings["cesium_ion_token"] = cesium_token
    story_dict["settings"] = settings

    return {
        "story": story_dict,
        "slides": slides,
        "markers": markers,
        "layers": layers,
        "basemaps": basemaps,
    }


@router.get("/{story_id}")
async def get_story(
    story_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict | None = Depends(get_current_user_optional),
):
    result = await db.execute(text(
        "SELECT s.* FROM stories s WHERE s.id = :id"
    ), {"id": story_id})
    story = result.mappings().fetchone()
    if not story:
        raise HTTPException(status_code=404, detail="Storia non trovata")
    story = dict(story)
    if not await _can_read_story(db, story, user):
        raise HTTPException(status_code=404, detail="Storia non trovata")
    return story


@router.post("/")
async def create_story(req: StoryCreate, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    slug = slugify(req.title) or "untitled"
    # Ensure unique slug
    existing = await db.execute(text("SELECT id FROM stories WHERE slug = :s"), {"s": slug})
    if existing.fetchone():
        slug = f"{slug}-{uuid.uuid4().hex[:6]}"

    try:
        result = await db.execute(text(
            """INSERT INTO stories (title, slug, description, visibility, theme, settings, author_id)
               VALUES (:title, :slug, :desc, :vis, CAST(:theme AS jsonb), CAST(:settings AS jsonb), :author)
               RETURNING id, slug, share_token"""
        ), {
            "title": req.title, "slug": slug, "desc": req.description,
            "vis": req.visibility or "private",
            "theme": json.dumps(req.theme) if req.theme else "{}",
            "settings": json.dumps(req.settings) if req.settings else "{}",
            "author": user["id"],
        })
        row = result.mappings().fetchone()
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Error creating story: {e}")

    return {"id": row["id"], "slug": row["slug"], "share_token": row["share_token"]}


@router.put("/{story_id}")
async def update_story(story_id: int, req: StoryUpdate, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    # Ownership or collaborator-editor check
    access = await _check_story_access(db, None, story_id, user, require_role="editor")
    if not access:
        raise HTTPException(status_code=403, detail="Non autorizzato a modificare questa storia")
    import json
    sets = []
    params = {"id": story_id}
    if req.title is not None:
        sets.append("title = :title")
        params["title"] = req.title
    if req.description is not None:
        sets.append("description = :desc")
        params["desc"] = req.description
    if req.cover_image is not None:
        sets.append("cover_image = :cover")
        params["cover"] = req.cover_image
    if req.status is not None:
        sets.append("status = :status")
        params["status"] = req.status
    if req.visibility is not None:
        sets.append("visibility = :vis")
        params["vis"] = req.visibility
    if req.theme is not None:
        sets.append("theme = CAST(:theme AS jsonb)")
        params["theme"] = json.dumps(req.theme)
    if req.settings is not None:
        sets.append("settings = CAST(:settings AS jsonb)")
        params["settings"] = json.dumps(req.settings)
    if not sets:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    sets.append("updated_at = NOW()")
    q = f"UPDATE stories SET {', '.join(sets)} WHERE id = :id RETURNING id"
    result = await db.execute(text(q), params)
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Storia non trovata")
    await db.commit()
    return {"detail": "Storia aggiornata"}


@router.delete("/{story_id}")
async def delete_story(story_id: int, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    # Ownership check
    if user["role"] != "admin":
        result = await db.execute(text("DELETE FROM stories WHERE id = :id AND author_id = :uid RETURNING id"), {"id": story_id, "uid": user["id"]})
    else:
        result = await db.execute(text("DELETE FROM stories WHERE id = :id RETURNING id"), {"id": story_id})
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Storia non trovata o non autorizzato")
    await db.commit()
    return {"detail": "Storia eliminata"}


@router.post("/{story_id}/duplicate")
async def duplicate_story(story_id: int, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    import json
    # Duplicating copies the whole story into the caller's account, so it needs read
    # rights on the source — otherwise any editor could clone private work by id
    if not await _check_story_access(db, None, story_id, user, require_role="viewer"):
        raise HTTPException(status_code=404, detail="Storia non trovata")
    # Get original story
    result = await db.execute(text("SELECT * FROM stories WHERE id = :id"), {"id": story_id})
    original = result.mappings().fetchone()
    if not original:
        raise HTTPException(status_code=404, detail="Storia non trovata")

    new_slug = f"{original['slug']}-copy-{uuid.uuid4().hex[:6]}"
    new_story = await db.execute(text(
        """INSERT INTO stories (title, slug, description, cover_image, author_id, status, visibility, theme, settings)
           VALUES (:title, :slug, :desc, :cover, :author, 'draft', 'private', CAST(:theme AS jsonb), CAST(:settings AS jsonb))
           RETURNING id"""
    ), {
        "title": f"{original['title']} (copia)",
        "slug": new_slug,
        "desc": original["description"],
        "cover": original["cover_image"],
        "author": user["id"],
        "theme": json.dumps(original["theme"] or {}),
        "settings": json.dumps(original["settings"] or {}),
    })
    new_id = new_story.fetchone()[0]

    # Duplicate slides
    slides = await db.execute(text("SELECT * FROM slides WHERE story_id = :sid ORDER BY position"), {"sid": story_id})
    for slide in slides.mappings().all():
        await db.execute(text(
            """INSERT INTO slides (story_id, title, narrative, position, visible, layout,
                map_center, map_zoom, map_bearing, map_pitch, map_bounds, map_animation,
                layer_visibility, background_media, background_opacity, style_overrides)
               VALUES (:sid, :title, :narrative, :pos, :vis, :layout,
                CAST(:center AS jsonb), :zoom, :bearing, :pitch, CAST(:bounds AS jsonb), :anim,
                CAST(:lv AS jsonb), :bg, :bgo, CAST(:so AS jsonb))"""
        ), {
            "sid": new_id, "title": slide["title"], "narrative": slide["narrative"],
            "pos": slide["position"], "vis": slide["visible"], "layout": slide["layout"],
            "center": json.dumps(slide["map_center"]) if slide["map_center"] else None,
            "zoom": slide["map_zoom"], "bearing": slide["map_bearing"], "pitch": slide["map_pitch"],
            "bounds": json.dumps(slide["map_bounds"]) if slide["map_bounds"] else None,
            "anim": slide["map_animation"],
            "lv": json.dumps(slide["layer_visibility"] or {}),
            "bg": slide["background_media"], "bgo": slide["background_opacity"],
            "so": json.dumps(slide["style_overrides"] or {}),
        })

    # Duplicate story_layers
    layers = await db.execute(text("SELECT * FROM story_layers WHERE story_id = :sid"), {"sid": story_id})
    for layer in layers.mappings().all():
        await db.execute(text(
            """INSERT INTO story_layers (story_id, layer_id, position, visible, opacity, custom_style)
               VALUES (:sid, :lid, :pos, :vis, :opa, CAST(:cs AS jsonb))"""
        ), {
            "sid": new_id, "lid": layer["layer_id"], "pos": layer["position"],
            "vis": layer["visible"], "opa": layer["opacity"],
            "cs": json.dumps(layer["custom_style"] or {}),
        })

    await db.commit()
    return {"id": new_id, "slug": new_slug}


@router.get("/{story_id}/full")
async def get_story_full(
    story_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    system_db: AsyncSession = Depends(get_system_db),
    user: dict | None = Depends(get_current_user_optional),
):
    """Get complete story with slides, layers, markers - for the viewer."""
    # Story (data DB)
    story_r = await db.execute(text(
        "SELECT s.* FROM stories s WHERE s.id = :id"
    ), {"id": story_id})
    story = story_r.mappings().fetchone()
    if not story:
        raise HTTPException(status_code=404, detail="Storia non trovata")
    if not await _can_read_story(db, dict(story), user):
        raise HTTPException(status_code=404, detail="Storia non trovata")

    # Record view
    try:
        await db.execute(text(
            "INSERT INTO story_views (story_id, viewer_ip, user_agent, referrer) VALUES (:sid, :ip, :ua, :ref)"
        ), {"sid": story_id, "ip": _hash_ip(request.client.host if request.client else None),
            "ua": request.headers.get("user-agent", "")[:500], "ref": request.headers.get("referer", "")[:500]})
        await db.commit()
    except Exception:
        # A failed insert leaves the session dirty; without a rollback every later
        # statement in this request fails too and the whole read turns into a 500.
        await db.rollback()

    # Slides
    slides_r = await db.execute(text(
        "SELECT * FROM slides WHERE story_id = :sid ORDER BY position"
    ), {"sid": story_id})
    slides = [dict(s) for s in slides_r.mappings().all()]

    # Markers for each slide
    slide_ids = [s["id"] for s in slides]
    markers = []
    if slide_ids:
        markers_r = await db.execute(text(
            "SELECT id, slide_id, ST_X(geom) as lng, ST_Y(geom) as lat, title, popup_content, icon, color FROM markers WHERE slide_id = ANY(:ids)"
        ), {"ids": slide_ids})
        markers = [dict(m) for m in markers_r.mappings().all()]

    # Story layers
    layers_r = await db.execute(text(
        """SELECT sl.*, l.name as layer_name, l.layer_type, l.source_config, l.style_config, l.legend_config
           FROM story_layers sl JOIN layers l ON sl.layer_id = l.id
           WHERE sl.story_id = :sid ORDER BY sl.position"""
    ), {"sid": story_id})
    layers = [dict(l) for l in layers_r.mappings().all()]

    # Basemaps (system DB)
    basemaps_r = await system_db.execute(text("SELECT * FROM basemaps WHERE active = TRUE ORDER BY position"))
    basemaps = [dict(b) for b in basemaps_r.mappings().all()]

    # Cesium Ion token (system DB)
    cesium_token = ""
    try:
        token_r = await system_db.execute(text("SELECT value FROM system_settings WHERE key = 'cesium_ion_token'"))
        token_row = token_r.fetchone()
        if token_row and token_row[0]:
            cesium_token = token_row[0]
    except Exception:
        await system_db.rollback()

    story_dict = dict(story)
    # Inject cesium token into story settings so the frontend can use it
    settings = story_dict.get("settings") or {}
    if isinstance(settings, str):
        import json
        settings = json.loads(settings)
    if cesium_token:
        settings["cesium_ion_token"] = cesium_token
    story_dict["settings"] = settings

    return {
        "story": story_dict,
        "slides": slides,
        "markers": markers,
        "layers": layers,
        "basemaps": basemaps,
    }


@router.get("/{story_id}/analytics")
async def get_story_analytics(story_id: int, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Get view analytics for a story."""
    # Total views
    total = await db.execute(text("SELECT COUNT(*) FROM story_views WHERE story_id = :sid"), {"sid": story_id})
    total_count = total.scalar()
    # Views last 7 days
    week = await db.execute(text("SELECT COUNT(*) FROM story_views WHERE story_id = :sid AND viewed_at > NOW() - INTERVAL '7 days'"), {"sid": story_id})
    week_count = week.scalar()
    # Views last 30 days
    month = await db.execute(text("SELECT COUNT(*) FROM story_views WHERE story_id = :sid AND viewed_at > NOW() - INTERVAL '30 days'"), {"sid": story_id})
    month_count = month.scalar()
    # Daily views last 30 days for chart
    daily = await db.execute(text("""
        SELECT DATE(viewed_at) as day, COUNT(*) as views
        FROM story_views WHERE story_id = :sid AND viewed_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE(viewed_at) ORDER BY day
    """), {"sid": story_id})
    daily_data = [{"day": str(r[0]), "views": r[1]} for r in daily.fetchall()]
    return {"total": total_count, "week": week_count, "month": month_count, "daily": daily_data}


@router.get("/{story_id}/export")
async def export_story(story_id: int, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Export story with all slides, markers and layer configs as JSON."""
    story_result = await db.execute(text("SELECT * FROM stories WHERE id = :id AND author_id = :uid"), {"id": story_id, "uid": user["id"]})
    story = story_result.mappings().first()
    if not story:
        raise HTTPException(404, "Storia non trovata")

    slides_result = await db.execute(text("SELECT * FROM slides WHERE story_id = :sid ORDER BY position"), {"sid": story_id})
    slides = [dict(s) for s in slides_result.mappings().all()]

    for slide in slides:
        markers_result = await db.execute(text(
            "SELECT title, popup_content, icon, color, ST_X(geom) as lng, ST_Y(geom) as lat FROM markers WHERE slide_id = :sid"
        ), {"sid": slide["id"]})
        slide["markers"] = [dict(m) for m in markers_result.mappings().all()]
        # Remove DB internal fields
        for key in ["id", "story_id", "created_at", "updated_at"]:
            slide.pop(key, None)

    layers_result = await db.execute(text(
        "SELECT l.name, l.layer_type, l.source_config, l.style_config, sl.position, sl.visible, sl.opacity "
        "FROM story_layers sl JOIN layers l ON l.id = sl.layer_id WHERE sl.story_id = :sid ORDER BY sl.position"
    ), {"sid": story_id})
    layers = [dict(l) for l in layers_result.mappings().all()]

    export = {
        "talkingmaps_version": "2.0",
        "exported_at": datetime.utcnow().isoformat(),
        "story": {
            "title": story["title"],
            "description": story["description"],
            "theme": story["theme"],
            "settings": story["settings"],
            "status": story["status"],
            "visibility": story["visibility"],
        },
        "slides": slides,
        "layers": layers,
    }

    return JSONResponse(content=export, headers={
        "Content-Disposition": f'attachment; filename="talkingmaps-{story["slug"] or story_id}.json"'
    })


# ── Story Versioning ─────────────────────

@router.post("/{story_id}/versions")
async def create_version(story_id: int, body: dict, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    """Save a snapshot of the current story state."""
    # Get current version number
    last = await db.execute(text("SELECT MAX(version_number) FROM story_versions WHERE story_id = :sid"), {"sid": story_id})
    next_version = (last.scalar() or 0) + 1

    # Verify ownership
    story = await db.execute(text("SELECT * FROM stories WHERE id = :sid AND author_id = :uid"), {"sid": story_id, "uid": user["id"]})
    if not story.fetchone():
        raise HTTPException(404, "Storia non trovata")

    slides = await db.execute(text("SELECT * FROM slides WHERE story_id = :sid ORDER BY position"), {"sid": story_id})
    slides_data = [dict(s) for s in slides.mappings().all()]

    for s in slides_data:
        markers = await db.execute(text(
            "SELECT title, popup_content, icon, color, ST_X(geom) as lng, ST_Y(geom) as lat FROM markers WHERE slide_id = :sid"
        ), {"sid": s["id"]})
        s["markers"] = [dict(m) for m in markers.mappings().all()]

    snapshot = {"slides": slides_data}

    await db.execute(text(
        "INSERT INTO story_versions (story_id, version_number, snapshot, created_by, message) VALUES (:sid, :ver, CAST(:snap AS jsonb), :uid, :msg)"
    ), {"sid": story_id, "ver": next_version, "snap": json.dumps(snapshot, default=str), "uid": user["id"], "msg": body.get("message", f"Versione {next_version}")})
    await db.commit()
    return {"version": next_version, "detail": "Versione salvata"}


@router.get("/{story_id}/versions")
async def list_versions(story_id: int, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(text(
        "SELECT id, version_number, message, created_by, created_at FROM story_versions WHERE story_id = :sid ORDER BY version_number DESC"
    ), {"sid": story_id})
    return [dict(r) for r in result.mappings().all()]


@router.post("/{story_id}/versions/{version_id}/restore")
async def restore_version(story_id: int, version_id: int, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    """Restore a story to a specific version."""
    # This wipes every slide in the story, so it needs edit rights on that story,
    # not merely the editor role
    if not await _check_story_access(db, None, story_id, user, require_role="editor"):
        raise HTTPException(status_code=403, detail="Non autorizzato a modificare questa storia")
    version = await db.execute(text("SELECT snapshot FROM story_versions WHERE id = :vid AND story_id = :sid"), {"vid": version_id, "sid": story_id})
    row = version.fetchone()
    if not row:
        raise HTTPException(404, "Versione non trovata")

    snapshot = row[0] if isinstance(row[0], dict) else json.loads(row[0])

    # Delete current slides (cascade deletes markers too)
    await db.execute(text("DELETE FROM slides WHERE story_id = :sid"), {"sid": story_id})

    # Recreate slides from snapshot
    for s in snapshot.get("slides", []):
        markers = s.pop("markers", [])
        s.pop("id", None)
        s.pop("created_at", None)
        s.pop("updated_at", None)

        result = await db.execute(text(
            "INSERT INTO slides (story_id, title, narrative, position, visible, layout, map_center, map_zoom, "
            "map_bearing, map_pitch, map_animation, layer_visibility, background_media, background_opacity, style_overrides) "
            "VALUES (:sid, :title, :narrative, :pos, :vis, :layout, CAST(:center AS jsonb), :zoom, :bearing, :pitch, "
            ":anim, CAST(:lv AS jsonb), :bg, :opacity, CAST(:style AS jsonb)) RETURNING id"
        ), {
            "sid": story_id, "title": s.get("title", ""), "narrative": s.get("narrative", ""),
            "pos": s.get("position", 0), "vis": s.get("visible", True), "layout": s.get("layout", "side-left"),
            "center": json.dumps(s["map_center"]) if s.get("map_center") else None,
            "zoom": s.get("map_zoom"), "bearing": s.get("map_bearing", 0), "pitch": s.get("map_pitch", 0),
            "anim": s.get("map_animation", "flyTo"),
            "lv": json.dumps(s.get("layer_visibility", {})),
            "bg": s.get("background_media", ""), "opacity": s.get("background_opacity", 1),
            "style": json.dumps(s.get("style_overrides", {})),
        })
        slide_id = result.fetchone()[0]

        for m in markers:
            await db.execute(text(
                "INSERT INTO markers (slide_id, geom, title, popup_content, icon, color) "
                "VALUES (:sid, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), :title, :content, :icon, :color)"
            ), {"sid": slide_id, "lng": m.get("lng", 0), "lat": m.get("lat", 0),
                "title": m.get("title", ""), "content": m.get("popup_content", ""),
                "icon": m.get("icon", "marker"), "color": m.get("color", "#e74c3c")})

    await db.commit()
    return {"detail": "Versione ripristinata"}


# ── Custom Templates ─────────────────────

@router.post("/{story_id}/save-as-template")
async def save_as_template(story_id: int, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    """Save current story as a reusable template."""
    await db.execute(text("UPDATE stories SET settings = jsonb_set(COALESCE(settings, '{}'), '{is_template}', 'true') WHERE id = :id AND author_id = :uid"), {"id": story_id, "uid": user["id"]})
    await db.commit()
    return {"detail": "Salvata come template"}


@router.get("/templates/list")
async def list_templates(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """List stories marked as templates."""
    result = await db.execute(text(
        "SELECT id, title, description, slug FROM stories WHERE settings->>'is_template' = 'true' AND (author_id = :uid OR visibility = 'public') ORDER BY title"
    ), {"uid": user["id"]})
    return [dict(r) for r in result.mappings().all()]


@router.get("/templates/system")
async def list_system_templates(db: AsyncSession = Depends(get_db)):
    """List pre-built system templates (no auth required)."""
    result = await db.execute(text(
        "SELECT * FROM story_templates WHERE is_system = TRUE ORDER BY position"
    ))
    return [dict(r) for r in result.mappings().all()]


# ── Story Collaborators (per-story sharing) ──────

class CollaboratorAdd(BaseModel):
    user_id: int
    role: str = "viewer"  # 'editor' or 'viewer'


@router.get("/{story_id}/collaborators")
async def list_collaborators(
    story_id: int,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    system_db: AsyncSession = Depends(get_system_db),
):
    """List collaborators for a story. Only owner/admin or existing collaborators can see."""
    access = await _check_story_access(db, system_db, story_id, user)
    if not access:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    # Get collaborators with user info from system DB
    collabs = await db.execute(text(
        "SELECT id, story_id, user_id, role, created_at FROM story_collaborators WHERE story_id = :sid ORDER BY created_at"
    ), {"sid": story_id})
    collab_list = [dict(c) for c in collabs.mappings().all()]
    # Enrich with user info
    if collab_list:
        user_ids = [c["user_id"] for c in collab_list]
        users_r = await system_db.execute(text(
            "SELECT id, username, display_name, email, avatar FROM users WHERE id = ANY(:ids)"
        ), {"ids": user_ids})
        users_map = {u["id"]: dict(u) for u in users_r.mappings().all()}
        for c in collab_list:
            u = users_map.get(c["user_id"], {})
            c["username"] = u.get("username", "?")
            c["display_name"] = u.get("display_name", "")
            c["email"] = u.get("email", "")
            c["avatar"] = u.get("avatar", "")
    return collab_list


@router.post("/{story_id}/collaborators")
async def add_collaborator(
    story_id: int,
    req: CollaboratorAdd,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    system_db: AsyncSession = Depends(get_system_db),
):
    """Add a collaborator to a story. Only owner/admin can add."""
    access = await _check_story_access(db, system_db, story_id, user, require_role="editor")
    if access not in ("owner",):
        raise HTTPException(status_code=403, detail="Solo il proprietario può gestire i collaboratori")
    if req.role not in ("editor", "viewer"):
        raise HTTPException(status_code=400, detail="Ruolo non valido (editor o viewer)")
    # Verify user exists
    target = await system_db.execute(text("SELECT id, username FROM users WHERE id = :id AND active = TRUE"), {"id": req.user_id})
    if not target.fetchone():
        raise HTTPException(status_code=404, detail="Utente non trovato")
    # Check not adding self
    owner_r = await db.execute(text("SELECT author_id FROM stories WHERE id = :id"), {"id": story_id})
    owner = owner_r.fetchone()
    if owner and owner[0] == req.user_id:
        raise HTTPException(status_code=400, detail="Non puoi aggiungere il proprietario come collaboratore")
    try:
        await db.execute(text(
            "INSERT INTO story_collaborators (story_id, user_id, role, created_by) VALUES (:sid, :uid, :role, :by)"
        ), {"sid": story_id, "uid": req.user_id, "role": req.role, "by": user["id"]})
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Utente già collaboratore")
    return {"detail": "Collaboratore aggiunto", "user_id": req.user_id, "role": req.role}


@router.put("/{story_id}/collaborators/{collab_user_id}")
async def update_collaborator(
    story_id: int,
    collab_user_id: int,
    body: dict,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    system_db: AsyncSession = Depends(get_system_db),
):
    """Update a collaborator's role. Only owner/admin can update."""
    access = await _check_story_access(db, system_db, story_id, user, require_role="editor")
    if access not in ("owner",):
        raise HTTPException(status_code=403, detail="Solo il proprietario può gestire i collaboratori")
    new_role = body.get("role", "viewer")
    if new_role not in ("editor", "viewer"):
        raise HTTPException(status_code=400, detail="Ruolo non valido")
    result = await db.execute(text(
        "UPDATE story_collaborators SET role = :role WHERE story_id = :sid AND user_id = :uid RETURNING id"
    ), {"role": new_role, "sid": story_id, "uid": collab_user_id})
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Collaboratore non trovato")
    await db.commit()
    return {"detail": "Ruolo aggiornato", "role": new_role}


@router.delete("/{story_id}/collaborators/{collab_user_id}")
async def remove_collaborator(
    story_id: int,
    collab_user_id: int,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    system_db: AsyncSession = Depends(get_system_db),
):
    """Remove a collaborator. Owner/admin can remove anyone; collaborators can remove themselves."""
    access = await _check_story_access(db, system_db, story_id, user, require_role="editor")
    is_owner = access == "owner"
    is_self = collab_user_id == user["id"]
    if not is_owner and not is_self:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    result = await db.execute(text(
        "DELETE FROM story_collaborators WHERE story_id = :sid AND user_id = :uid RETURNING id"
    ), {"sid": story_id, "uid": collab_user_id})
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Collaboratore non trovato")
    await db.commit()
    return {"detail": "Collaboratore rimosso"}
