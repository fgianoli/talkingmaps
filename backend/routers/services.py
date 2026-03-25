"""
Service Catalog - Personal GIS service endpoints (WMS, WFS, WMTS, Vector Tiles)
Users can save and reuse their GeoServer/QGIS Server/etc. endpoints.
"""
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db
from core.security import get_current_user, require_editor

router = APIRouter()


class ServiceCreate(BaseModel):
    name: str
    service_type: str  # wms, wfs, wmts, xyz, vector-tiles
    url: str
    description: str | None = None
    auth_config: dict = {}  # optional credentials


class ServiceUpdate(BaseModel):
    name: str | None = None
    service_type: str | None = None
    url: str | None = None
    description: str | None = None
    auth_config: dict | None = None


@router.get("/")
async def list_services(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """List user's saved service endpoints."""
    result = await db.execute(
        text("SELECT * FROM service_catalog WHERE owner_id = :uid ORDER BY name"),
        {"uid": user["id"]}
    )
    return [dict(r) for r in result.mappings().all()]


@router.get("/{service_id}")
async def get_service(service_id: int, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("SELECT * FROM service_catalog WHERE id = :id AND owner_id = :uid"),
        {"id": service_id, "uid": user["id"]}
    )
    row = result.mappings().fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Service not found")
    return dict(row)


@router.post("/")
async def create_service(req: ServiceCreate, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    result = await db.execute(text(
        """INSERT INTO service_catalog (owner_id, name, service_type, url, description, auth_config)
           VALUES (:uid, :name, :type, :url, :desc, CAST(:auth AS jsonb))
           RETURNING id"""
    ), {
        "uid": user["id"], "name": req.name, "type": req.service_type,
        "url": req.url, "desc": req.description,
        "auth": json.dumps(req.auth_config),
    })
    service_id = result.fetchone()[0]
    await db.commit()
    return {"id": service_id, "name": req.name}


@router.put("/{service_id}")
async def update_service(service_id: int, req: ServiceUpdate, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    sets = []
    params = {"id": service_id, "uid": user["id"]}
    if req.name is not None:
        sets.append("name = :name"); params["name"] = req.name
    if req.service_type is not None:
        sets.append("service_type = :type"); params["type"] = req.service_type
    if req.url is not None:
        sets.append("url = :url"); params["url"] = req.url
    if req.description is not None:
        sets.append("description = :desc"); params["desc"] = req.description
    if req.auth_config is not None:
        sets.append("auth_config = CAST(:auth AS jsonb)"); params["auth"] = json.dumps(req.auth_config)
    if not sets:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = await db.execute(
        text(f"UPDATE service_catalog SET {', '.join(sets)} WHERE id = :id AND owner_id = :uid RETURNING id"),
        params
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Service not found")
    await db.commit()
    return {"detail": "Service updated"}


@router.delete("/{service_id}")
async def delete_service(service_id: int, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("DELETE FROM service_catalog WHERE id = :id AND owner_id = :uid RETURNING id"),
        {"id": service_id, "uid": user["id"]}
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Service not found")
    await db.commit()
    return {"detail": "Service deleted"}
