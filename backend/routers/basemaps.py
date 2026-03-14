import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db, get_system_db
from core.security import require_admin

router = APIRouter()


class BasemapCreate(BaseModel):
    name: str
    type: str  # xyz, wms, wmts, style, image
    url: str
    config: dict = {}
    thumbnail: str | None = None
    position: int = 0


@router.get("/")
async def list_basemaps(db: AsyncSession = Depends(get_system_db)):
    result = await db.execute(text("SELECT * FROM basemaps WHERE active = TRUE ORDER BY position"))
    return [dict(r) for r in result.mappings().all()]


@router.get("/all")
async def list_all_basemaps(user: dict = Depends(require_admin), db: AsyncSession = Depends(get_system_db)):
    result = await db.execute(text("SELECT * FROM basemaps ORDER BY position"))
    return [dict(r) for r in result.mappings().all()]


@router.post("/")
async def create_basemap(req: BasemapCreate, user: dict = Depends(require_admin), db: AsyncSession = Depends(get_system_db)):
    result = await db.execute(text(
        """INSERT INTO basemaps (name, type, url, config, thumbnail, position)
           VALUES (:name, :type, :url, CAST(:cfg AS jsonb), :thumb, :pos) RETURNING id"""
    ), {"name": req.name, "type": req.type, "url": req.url, "cfg": json.dumps(req.config), "thumb": req.thumbnail, "pos": req.position})
    basemap_id = result.fetchone()[0]
    await db.commit()
    return {"id": basemap_id}


@router.put("/{basemap_id}/toggle")
async def toggle_basemap(basemap_id: int, user: dict = Depends(require_admin), db: AsyncSession = Depends(get_system_db)):
    result = await db.execute(text("UPDATE basemaps SET active = NOT active WHERE id = :id RETURNING active"), {"id": basemap_id})
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Basemap non trovata")
    await db.commit()
    return {"id": basemap_id, "active": row[0]}


@router.delete("/{basemap_id}")
async def delete_basemap(basemap_id: int, user: dict = Depends(require_admin), db: AsyncSession = Depends(get_system_db)):
    result = await db.execute(text("DELETE FROM basemaps WHERE id = :id RETURNING id"), {"id": basemap_id})
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Basemap non trovata")
    await db.commit()
    return {"detail": "Basemap eliminata"}
