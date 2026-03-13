import json
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db
from core.security import get_current_user, require_editor
from core.config import settings
import aiofiles
import os
import uuid

router = APIRouter()


class LayerCreate(BaseModel):
    name: str
    description: str | None = None
    layer_type: str  # geojson, wms, wmts, xyz, vector-tiles, cog
    source_config: dict
    style_config: dict = {}
    legend_config: dict = {}
    public: bool = False


class LayerUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    source_config: dict | None = None
    style_config: dict | None = None
    legend_config: dict | None = None
    public: bool | None = None


@router.get("/")
async def list_layers(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user["role"] in ("admin", "editor"):
        result = await db.execute(text(
            """SELECT l.*, u.display_name as owner_name FROM layers l
               LEFT JOIN users u ON l.owner_id = u.id ORDER BY l.name"""
        ))
    else:
        result = await db.execute(text(
            """SELECT l.*, u.display_name as owner_name FROM layers l
               LEFT JOIN users u ON l.owner_id = u.id
               WHERE l.public = TRUE OR l.owner_id = :uid ORDER BY l.name"""
        ), {"uid": user["id"]})
    return [dict(r) for r in result.mappings().all()]


@router.get("/{layer_id}")
async def get_layer(layer_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("SELECT * FROM layers WHERE id = :id"), {"id": layer_id})
    layer = result.mappings().fetchone()
    if not layer:
        raise HTTPException(status_code=404, detail="Layer non trovato")
    return dict(layer)


@router.post("/")
async def create_layer(req: LayerCreate, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    result = await db.execute(text(
        """INSERT INTO layers (name, description, layer_type, source_config, style_config, legend_config, public, owner_id)
           VALUES (:name, :desc, :type, CAST(:source AS jsonb), CAST(:style AS jsonb), CAST(:legend AS jsonb), :pub, :owner)
           RETURNING id"""
    ), {
        "name": req.name, "desc": req.description, "type": req.layer_type,
        "source": json.dumps(req.source_config), "style": json.dumps(req.style_config),
        "legend": json.dumps(req.legend_config), "pub": req.public, "owner": user["id"],
    })
    layer_id = result.fetchone()[0]
    await db.commit()
    return {"id": layer_id, "name": req.name}


@router.put("/{layer_id}")
async def update_layer(layer_id: int, req: LayerUpdate, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    # Ownership check
    if user["role"] != "admin":
        owner_check = await db.execute(text("SELECT owner_id FROM layers WHERE id = :id"), {"id": layer_id})
        owner_row = owner_check.fetchone()
        if not owner_row or owner_row[0] != user["id"]:
            raise HTTPException(status_code=403, detail="Non autorizzato a modificare questo layer")
    sets = []
    params = {"id": layer_id}
    if req.name is not None:
        sets.append("name = :name")
        params["name"] = req.name
    if req.description is not None:
        sets.append("description = :desc")
        params["desc"] = req.description
    if req.source_config is not None:
        sets.append("source_config = CAST(:source AS jsonb)")
        params["source"] = json.dumps(req.source_config)
    if req.style_config is not None:
        sets.append("style_config = CAST(:style AS jsonb)")
        params["style"] = json.dumps(req.style_config)
    if req.legend_config is not None:
        sets.append("legend_config = CAST(:legend AS jsonb)")
        params["legend"] = json.dumps(req.legend_config)
    if req.public is not None:
        sets.append("public = :pub")
        params["pub"] = req.public
    if not sets:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    sets.append("updated_at = NOW()")
    result = await db.execute(text(f"UPDATE layers SET {', '.join(sets)} WHERE id = :id RETURNING id"), params)
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Layer non trovato")
    await db.commit()
    return {"detail": "Layer aggiornato"}


@router.delete("/{layer_id}")
async def delete_layer(layer_id: int, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    # Ownership check
    if user["role"] != "admin":
        result = await db.execute(text("DELETE FROM layers WHERE id = :id AND owner_id = :uid RETURNING id"), {"id": layer_id, "uid": user["id"]})
    else:
        result = await db.execute(text("DELETE FROM layers WHERE id = :id RETURNING id"), {"id": layer_id})
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Layer non trovato o non autorizzato")
    await db.commit()
    return {"detail": "Layer eliminato"}


@router.post("/upload-geojson")
async def upload_geojson(
    file: UploadFile = File(...),
    user: dict = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
):
    """Upload a GeoJSON, Shapefile (zip), or GeoPackage and create a layer."""
    fname = file.filename.lower()
    supported = (".geojson", ".json", ".zip", ".shp", ".gpkg")
    if not any(fname.endswith(ext) for ext in supported):
        raise HTTPException(status_code=400, detail="Formati supportati: GeoJSON, Shapefile (.zip), GeoPackage (.gpkg)")

    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File troppo grande (max {settings.MAX_UPLOAD_SIZE_MB}MB)")

    # Determine if conversion needed
    is_geojson = fname.endswith((".geojson", ".json"))
    geojson_data = None

    if is_geojson:
        try:
            geojson_data = json.loads(content)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="File GeoJSON non valido")
    else:
        # Convert SHP/GPKG to GeoJSON using fiona
        geojson_data = await _convert_to_geojson(content, fname)

    # Save as GeoJSON
    out_filename = f"{uuid.uuid4().hex}.geojson"
    filepath = os.path.join(settings.UPLOAD_DIR, "layers", out_filename)
    geojson_bytes = json.dumps(geojson_data).encode("utf-8")
    async with aiofiles.open(filepath, "wb") as f:
        await f.write(geojson_bytes)

    # Detect geometry type
    geom_type = "point"
    features = geojson_data.get("features", [])
    if features:
        gt = features[0].get("geometry", {}).get("type", "").lower()
        if "polygon" in gt:
            geom_type = "polygon"
        elif "line" in gt:
            geom_type = "line"

    # Create layer record
    name = file.filename.rsplit(".", 1)[0]
    result = await db.execute(text(
        """INSERT INTO layers (name, layer_type, source_config, style_config, owner_id, public)
           VALUES (:name, 'geojson', CAST(:source AS jsonb), CAST(:style AS jsonb), :owner, FALSE)
           RETURNING id"""
    ), {
        "name": name,
        "source": json.dumps({"url": f"/uploads/layers/{out_filename}", "type": "geojson"}),
        "style": json.dumps(_default_style(geom_type)),
        "owner": user["id"],
    })
    layer_id = result.fetchone()[0]
    await db.commit()
    return {"id": layer_id, "name": name, "geometry_type": geom_type}


async def _convert_to_geojson(content: bytes, filename: str) -> dict:
    """Convert SHP (zip) or GPKG to GeoJSON using fiona."""
    import tempfile
    import zipfile

    try:
        import fiona
        from fiona.transform import transform_geom
    except ImportError:
        raise HTTPException(status_code=500, detail="Fiona non installato. Solo GeoJSON supportato.")

    with tempfile.TemporaryDirectory() as tmpdir:
        if filename.endswith(".zip") or filename.endswith(".shp"):
            # Save and extract zip
            zip_path = os.path.join(tmpdir, "upload.zip")
            with open(zip_path, "wb") as f:
                f.write(content)
            if zipfile.is_zipfile(zip_path):
                with zipfile.ZipFile(zip_path, "r") as zf:
                    zf.extractall(tmpdir)
            # Find .shp
            shp_files = [os.path.join(tmpdir, f) for f in os.listdir(tmpdir) if f.endswith(".shp")]
            if not shp_files:
                raise HTTPException(status_code=400, detail="Nessun file .shp trovato nell'archivio")
            src_path = shp_files[0]
        elif filename.endswith(".gpkg"):
            src_path = os.path.join(tmpdir, "upload.gpkg")
            with open(src_path, "wb") as f:
                f.write(content)
        else:
            raise HTTPException(status_code=400, detail="Formato non supportato")

        features = []
        with fiona.open(src_path) as src:
            src_crs = src.crs
            for feat in src:
                geom = feat.get("geometry")
                props = dict(feat.get("properties", {}))
                # Reproject to EPSG:4326 if needed
                if src_crs and str(src_crs).upper() != "EPSG:4326":
                    try:
                        geom = transform_geom(src_crs, "EPSG:4326", geom)
                    except Exception:
                        pass
                features.append({"type": "Feature", "geometry": dict(geom), "properties": props})

        if not features:
            raise HTTPException(status_code=400, detail="Nessuna feature trovata nel file")

        return {"type": "FeatureCollection", "features": features}


# ── Story-Layer association ──────────────────────────

class StoryLayerAdd(BaseModel):
    layer_id: int
    position: int = 0
    visible: bool = True
    opacity: float = 1.0


@router.post("/story/{story_id}")
async def add_layer_to_story(story_id: int, req: StoryLayerAdd, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    result = await db.execute(text(
        """INSERT INTO story_layers (story_id, layer_id, position, visible, opacity)
           VALUES (:sid, :lid, :pos, :vis, :opa)
           ON CONFLICT (story_id, layer_id) DO UPDATE SET position = :pos, visible = :vis, opacity = :opa
           RETURNING id"""
    ), {"sid": story_id, "lid": req.layer_id, "pos": req.position, "vis": req.visible, "opa": req.opacity})
    sl_id = result.fetchone()[0]
    await db.commit()
    return {"id": sl_id}


@router.delete("/story/{story_id}/{layer_id}")
async def remove_layer_from_story(story_id: int, layer_id: int, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    await db.execute(text("DELETE FROM story_layers WHERE story_id = :sid AND layer_id = :lid"), {"sid": story_id, "lid": layer_id})
    await db.commit()
    return {"detail": "Layer rimosso dalla storia"}


def _default_style(geom_type: str) -> dict:
    styles = {
        "point": {"type": "circle", "paint": {"circle-radius": 6, "circle-color": "#3388ff", "circle-stroke-width": 2, "circle-stroke-color": "#fff"}},
        "line": {"paint": {"line-color": "#3388ff", "line-width": 3}},
        "polygon": {"paint": {"fill-color": "#3388ff", "fill-opacity": 0.4, "fill-outline-color": "#2266cc"}},
    }
    return styles.get(geom_type, styles["point"])
