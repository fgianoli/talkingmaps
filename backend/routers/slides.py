import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db
from core.security import require_editor

router = APIRouter()


class SlideCreate(BaseModel):
    story_id: int
    title: str | None = None
    narrative: str | None = None
    layout: str = "side-left"
    position: int | None = None


class SlideUpdate(BaseModel):
    title: str | None = None
    narrative: str | None = None
    layout: str | None = None
    visible: bool | None = None
    map_center: dict | None = None
    map_zoom: float | None = None
    map_bearing: float | None = None
    map_pitch: float | None = None
    map_bounds: list | None = None
    map_animation: str | None = None
    layer_visibility: dict | None = None
    background_media: str | None = None
    background_opacity: float | None = None
    style_overrides: dict | None = None


class MarkerCreate(BaseModel):
    lng: float
    lat: float
    title: str | None = None
    popup_content: str | None = None
    icon: str = "marker"
    color: str = "#e74c3c"


class ReorderRequest(BaseModel):
    slide_ids: list[int]


@router.get("/story/{story_id}")
async def list_slides(story_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(text(
        "SELECT * FROM slides WHERE story_id = :sid ORDER BY position"
    ), {"sid": story_id})
    return [dict(r) for r in result.mappings().all()]


@router.get("/{slide_id}")
async def get_slide(slide_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("SELECT * FROM slides WHERE id = :id"), {"id": slide_id})
    slide = result.mappings().fetchone()
    if not slide:
        raise HTTPException(status_code=404, detail="Slide non trovata")
    # Include markers
    markers_r = await db.execute(text(
        "SELECT id, ST_X(geom) as lng, ST_Y(geom) as lat, title, popup_content, icon, color FROM markers WHERE slide_id = :id"
    ), {"id": slide_id})
    return {**dict(slide), "markers": [dict(m) for m in markers_r.mappings().all()]}


@router.post("/")
async def create_slide(req: SlideCreate, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    # Get next position
    if req.position is None:
        pos_r = await db.execute(text("SELECT COALESCE(MAX(position), -1) + 1 FROM slides WHERE story_id = :sid"), {"sid": req.story_id})
        position = pos_r.scalar()
    else:
        position = req.position
        # Shift existing slides
        await db.execute(text(
            "UPDATE slides SET position = position + 1 WHERE story_id = :sid AND position >= :pos"
        ), {"sid": req.story_id, "pos": position})

    result = await db.execute(text(
        """INSERT INTO slides (story_id, title, narrative, layout, position)
           VALUES (:sid, :title, :narr, :layout, :pos) RETURNING id"""
    ), {"sid": req.story_id, "title": req.title, "narr": req.narrative or "", "layout": req.layout, "pos": position})
    slide_id = result.fetchone()[0]

    # Update story timestamp
    await db.execute(text("UPDATE stories SET updated_at = NOW() WHERE id = :sid"), {"sid": req.story_id})
    await db.commit()
    return {"id": slide_id, "position": position}


@router.put("/{slide_id}")
async def update_slide(slide_id: int, req: SlideUpdate, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    sets = []
    params = {"id": slide_id}

    for field in ["title", "narrative", "layout", "visible", "map_zoom", "map_bearing", "map_pitch", "map_animation", "background_media", "background_opacity"]:
        val = getattr(req, field, None)
        if val is not None:
            sets.append(f"{field} = :{field}")
            params[field] = val

    for jfield in ["map_center", "map_bounds", "layer_visibility", "style_overrides"]:
        val = getattr(req, jfield, None)
        if val is not None:
            sets.append(f"{jfield} = :{jfield}::jsonb")
            params[jfield] = json.dumps(val)

    if not sets:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    sets.append("updated_at = NOW()")
    q = f"UPDATE slides SET {', '.join(sets)} WHERE id = :id RETURNING story_id"
    result = await db.execute(text(q), params)
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Slide non trovata")
    # Update story timestamp
    await db.execute(text("UPDATE stories SET updated_at = NOW() WHERE id = :sid"), {"sid": row[0]})
    await db.commit()
    return {"detail": "Slide aggiornata"}


@router.delete("/{slide_id}")
async def delete_slide(slide_id: int, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("DELETE FROM slides WHERE id = :id RETURNING story_id, position"), {"id": slide_id})
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Slide non trovata")
    # Reorder remaining slides
    await db.execute(text(
        "UPDATE slides SET position = position - 1 WHERE story_id = :sid AND position > :pos"
    ), {"sid": row[0], "pos": row[1]})
    await db.execute(text("UPDATE stories SET updated_at = NOW() WHERE id = :sid"), {"sid": row[0]})
    await db.commit()
    return {"detail": "Slide eliminata"}


@router.put("/reorder")
async def reorder_slides(req: ReorderRequest, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    for idx, slide_id in enumerate(req.slide_ids):
        await db.execute(text("UPDATE slides SET position = :pos WHERE id = :id"), {"pos": idx, "id": slide_id})
    await db.commit()
    return {"detail": "Ordine aggiornato"}


# ── Markers ──────────────────────────────────────────

@router.post("/{slide_id}/markers")
async def add_marker(slide_id: int, req: MarkerCreate, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    result = await db.execute(text(
        """INSERT INTO markers (slide_id, geom, title, popup_content, icon, color)
           VALUES (:sid, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), :title, :popup, :icon, :color)
           RETURNING id"""
    ), {"sid": slide_id, "lng": req.lng, "lat": req.lat, "title": req.title, "popup": req.popup_content, "icon": req.icon, "color": req.color})
    marker_id = result.fetchone()[0]
    await db.commit()
    return {"id": marker_id}


@router.put("/markers/{marker_id}")
async def update_marker(marker_id: int, req: MarkerCreate, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    result = await db.execute(text(
        """UPDATE markers SET geom = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326),
           title = :title, popup_content = :popup, icon = :icon, color = :color
           WHERE id = :id RETURNING id"""
    ), {"id": marker_id, "lng": req.lng, "lat": req.lat, "title": req.title, "popup": req.popup_content, "icon": req.icon, "color": req.color})
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Marker non trovato")
    await db.commit()
    return {"detail": "Marker aggiornato"}


@router.delete("/markers/{marker_id}")
async def delete_marker(marker_id: int, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("DELETE FROM markers WHERE id = :id RETURNING id"), {"id": marker_id})
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Marker non trovato")
    await db.commit()
    return {"detail": "Marker eliminato"}
