import json
import re
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db
from core.security import get_current_user, require_editor

router = APIRouter()


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
    """List stories. Admins/editors see all, viewers see only published/public."""
    if user["role"] in ("admin", "editor"):
        q = "SELECT s.*, u.display_name as author_name FROM stories s LEFT JOIN users u ON s.author_id = u.id"
        params = {}
        if status:
            q += " WHERE s.status = :status"
            params["status"] = status
        q += " ORDER BY s.updated_at DESC"
    else:
        q = """SELECT s.*, u.display_name as author_name FROM stories s
               LEFT JOIN users u ON s.author_id = u.id
               WHERE s.status = 'published' AND s.visibility = 'public'
               ORDER BY s.updated_at DESC"""
        params = {}
    result = await db.execute(text(q), params)
    return [dict(r) for r in result.mappings().all()]


@router.get("/public")
async def list_public_stories(db: AsyncSession = Depends(get_db)):
    """Public endpoint: no auth needed."""
    result = await db.execute(text(
        """SELECT s.id, s.slug, s.title, s.description, s.cover_image, s.theme,
                  u.display_name as author_name, s.created_at, s.updated_at
           FROM stories s LEFT JOIN users u ON s.author_id = u.id
           WHERE s.status = 'published' AND s.visibility = 'public'
           ORDER BY s.updated_at DESC"""
    ))
    return [dict(r) for r in result.mappings().all()]


@router.get("/shared/{token}")
async def get_shared_story(token: str, db: AsyncSession = Depends(get_db)):
    """Access story via share token (no auth)."""
    result = await db.execute(text(
        """SELECT s.*, u.display_name as author_name FROM stories s
           LEFT JOIN users u ON s.author_id = u.id
           WHERE s.share_token = :token AND s.status = 'published'"""
    ), {"token": token})
    story = result.mappings().fetchone()
    if not story:
        raise HTTPException(status_code=404, detail="Storia non trovata")
    return dict(story)


@router.get("/{story_id}")
async def get_story(story_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(text(
        "SELECT s.*, u.display_name as author_name FROM stories s LEFT JOIN users u ON s.author_id = u.id WHERE s.id = :id"
    ), {"id": story_id})
    story = result.mappings().fetchone()
    if not story:
        raise HTTPException(status_code=404, detail="Storia non trovata")
    return dict(story)


@router.post("/")
async def create_story(req: StoryCreate, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    slug = slugify(req.title)
    # Ensure unique slug
    existing = await db.execute(text("SELECT id FROM stories WHERE slug = :s"), {"s": slug})
    if existing.fetchone():
        slug = f"{slug}-{uuid.uuid4().hex[:6]}"

    result = await db.execute(text(
        """INSERT INTO stories (title, slug, description, visibility, theme, settings, author_id)
           VALUES (:title, :slug, :desc, :vis, :theme::jsonb, :settings::jsonb, :author)
           RETURNING id, slug, share_token"""
    ), {
        "title": req.title, "slug": slug, "desc": req.description,
        "vis": req.visibility, "theme": json.dumps(req.theme),
        "settings": json.dumps(req.settings), "author": user["id"],
    })
    row = result.mappings().fetchone()
    await db.commit()

    # Create default first slide (cover)
    await db.execute(text(
        """INSERT INTO slides (story_id, title, position, layout, narrative)
           VALUES (:sid, :title, 0, 'cover', '<h1></h1><p></p>')"""
    ), {"sid": row["id"], "title": req.title})
    await db.commit()

    return {"id": row["id"], "slug": row["slug"], "share_token": row["share_token"]}


@router.put("/{story_id}")
async def update_story(story_id: int, req: StoryUpdate, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
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
        sets.append("theme = :theme::jsonb")
        params["theme"] = json.dumps(req.theme)
    if req.settings is not None:
        sets.append("settings = :settings::jsonb")
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
    result = await db.execute(text("DELETE FROM stories WHERE id = :id RETURNING id"), {"id": story_id})
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Storia non trovata")
    await db.commit()
    return {"detail": "Storia eliminata"}


@router.post("/{story_id}/duplicate")
async def duplicate_story(story_id: int, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    import json
    # Get original story
    result = await db.execute(text("SELECT * FROM stories WHERE id = :id"), {"id": story_id})
    original = result.mappings().fetchone()
    if not original:
        raise HTTPException(status_code=404, detail="Storia non trovata")

    new_slug = f"{original['slug']}-copy-{uuid.uuid4().hex[:6]}"
    new_story = await db.execute(text(
        """INSERT INTO stories (title, slug, description, cover_image, author_id, status, visibility, theme, settings)
           VALUES (:title, :slug, :desc, :cover, :author, 'draft', 'private', :theme::jsonb, :settings::jsonb)
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
                :center::jsonb, :zoom, :bearing, :pitch, :bounds::jsonb, :anim,
                :lv::jsonb, :bg, :bgo, :so::jsonb)"""
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
               VALUES (:sid, :lid, :pos, :vis, :opa, :cs::jsonb)"""
        ), {
            "sid": new_id, "lid": layer["layer_id"], "pos": layer["position"],
            "vis": layer["visible"], "opa": layer["opacity"],
            "cs": json.dumps(layer["custom_style"] or {}),
        })

    await db.commit()
    return {"id": new_id, "slug": new_slug}


@router.get("/{story_id}/full")
async def get_story_full(story_id: int, db: AsyncSession = Depends(get_db)):
    """Get complete story with slides, layers, markers - for the viewer."""
    # Story
    story_r = await db.execute(text(
        "SELECT s.*, u.display_name as author_name FROM stories s LEFT JOIN users u ON s.author_id = u.id WHERE s.id = :id"
    ), {"id": story_id})
    story = story_r.mappings().fetchone()
    if not story:
        raise HTTPException(status_code=404, detail="Storia non trovata")

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

    # Basemaps
    basemaps_r = await db.execute(text("SELECT * FROM basemaps WHERE active = TRUE ORDER BY position"))
    basemaps = [dict(b) for b in basemaps_r.mappings().all()]

    return {
        "story": dict(story),
        "slides": slides,
        "markers": markers,
        "layers": layers,
        "basemaps": basemaps,
    }
