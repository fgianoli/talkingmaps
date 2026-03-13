"""
TalkingMaps – 3D Data Upload & Conversion Router
Supports: LAS/LAZ, GLB/GLTF, OBJ, 3D Tiles (ZIP), KML/KMZ, GeoTIFF DEM
Converts point clouds to 3D Tiles, serves mesh directly.
"""
import json
import os
import shutil
import subprocess
import tempfile
import uuid
import zipfile

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db, get_system_db
from core.security import get_current_user, require_editor
from core.config import settings

router = APIRouter()

# Supported 3D file extensions and their categories
SUPPORTED_3D = {
    # Point clouds
    ".las": "pointcloud",
    ".laz": "pointcloud",
    ".ply": "pointcloud",
    ".xyz": "pointcloud",
    ".pts": "pointcloud",
    # Mesh / 3D models
    ".glb": "mesh",
    ".gltf": "mesh",
    ".obj": "mesh",
    ".fbx": "mesh",
    ".ifc": "mesh",         # BIM
    ".3ds": "mesh",
    ".dae": "mesh",          # Collada
    # 3D Tiles (pre-built)
    ".zip": "tileset",       # ZIP with tileset.json inside
    # Terrain
    ".tif": "terrain",
    ".tiff": "terrain",
    # KML/KMZ (may contain 3D models)
    ".kml": "kml",
    ".kmz": "kml",
}

MAX_3D_UPLOAD_MB = 500  # 3D files can be large


def _get_user_3d_dir(user_id: int) -> str:
    """Get per-user 3D upload directory."""
    d = os.path.join(settings.UPLOAD_DIR, "3d", str(user_id))
    os.makedirs(d, exist_ok=True)
    return d


def _dir_size_mb(path: str) -> float:
    """Calculate directory size in MB."""
    total = 0
    for dirpath, _, filenames in os.walk(path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            if os.path.isfile(fp):
                total += os.path.getsize(fp)
    return total / (1024 * 1024)


async def _check_quota(user_id: int, file_size: int, system_db: AsyncSession):
    """Check user storage quota."""
    result = await system_db.execute(
        text("SELECT storage_used_mb, storage_limit_mb FROM users WHERE id = :id"),
        {"id": user_id},
    )
    row = result.fetchone()
    if not row:
        return
    used_mb = float(row[0] or 0)
    limit_mb = float(row[1] or settings.DEFAULT_STORAGE_LIMIT_MB)
    file_mb = file_size / (1024 * 1024)
    if used_mb + file_mb > limit_mb:
        raise HTTPException(
            status_code=400,
            detail=f"Quota di spazio superata: {used_mb:.0f}/{limit_mb:.0f} MB usati. "
                   f"File: {file_mb:.1f} MB. Contatta l'amministratore per aumentare il limite.",
        )


async def _update_storage(user_id: int, added_mb: float, system_db: AsyncSession):
    """Update user storage usage."""
    await system_db.execute(
        text("UPDATE users SET storage_used_mb = COALESCE(storage_used_mb, 0) + :mb WHERE id = :id"),
        {"id": user_id, "mb": round(added_mb, 2)},
    )
    await system_db.commit()


@router.get("/")
async def list_3d_assets(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List 3D assets for the current user."""
    if user["role"] == "admin":
        result = await db.execute(text(
            "SELECT * FROM assets_3d ORDER BY created_at DESC"
        ))
    else:
        result = await db.execute(text(
            "SELECT * FROM assets_3d WHERE owner_id = :uid ORDER BY created_at DESC"
        ), {"uid": user["id"]})
    return [dict(r) for r in result.mappings().all()]


@router.post("/upload")
async def upload_3d(
    file: UploadFile = File(...),
    name: str = Form(None),
    user: dict = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
    system_db: AsyncSession = Depends(get_system_db),
):
    """
    Upload a 3D file. Supported formats:
    - Point clouds: LAS, LAZ, PLY, XYZ, PTS
    - 3D models: GLB, GLTF, OBJ, FBX, IFC (BIM), 3DS, DAE
    - Pre-built 3D Tiles: ZIP (containing tileset.json)
    - Terrain: GeoTIFF (DEM)
    - KML/KMZ with 3D content
    """
    fname = (file.filename or "").lower()
    ext = os.path.splitext(fname)[1]
    if ext not in SUPPORTED_3D:
        supported = ", ".join(sorted(SUPPORTED_3D.keys()))
        raise HTTPException(status_code=400, detail=f"Formato non supportato. Formati accettati: {supported}")

    category = SUPPORTED_3D[ext]

    # Read file content
    content = await file.read()
    file_size = len(content)
    max_bytes = MAX_3D_UPLOAD_MB * 1024 * 1024
    if file_size > max_bytes:
        raise HTTPException(status_code=400, detail=f"File troppo grande (max {MAX_3D_UPLOAD_MB} MB)")

    # Check user quota
    await _check_quota(user["id"], file_size, system_db)

    # Create asset directory
    asset_id = uuid.uuid4().hex[:12]
    user_dir = _get_user_3d_dir(user["id"])
    asset_dir = os.path.join(user_dir, asset_id)
    os.makedirs(asset_dir, exist_ok=True)

    # Save original file
    original_filename = file.filename or f"upload{ext}"
    original_path = os.path.join(asset_dir, original_filename)
    with open(original_path, "wb") as f:
        f.write(content)

    # Process based on category
    result_info = {"category": category, "format": ext}
    serve_url = None
    viewer_type = None  # "cesium" or "potree"

    try:
        if category == "pointcloud":
            serve_url, viewer_type, result_info = await _process_pointcloud(
                asset_dir, original_path, ext, asset_id, user["id"], result_info
            )
        elif category == "mesh":
            serve_url, viewer_type, result_info = _process_mesh(
                asset_dir, original_path, ext, asset_id, user["id"], result_info
            )
        elif category == "tileset":
            serve_url, viewer_type, result_info = _process_tileset_zip(
                asset_dir, original_path, asset_id, user["id"], result_info
            )
        elif category == "terrain":
            serve_url, viewer_type, result_info = _process_terrain(
                asset_dir, original_path, asset_id, user["id"], result_info
            )
        elif category == "kml":
            serve_url, viewer_type, result_info = _process_kml(
                asset_dir, original_path, ext, asset_id, user["id"], result_info
            )
    except HTTPException:
        raise
    except Exception as e:
        result_info["conversion_error"] = str(e)
        # Still save the original file, just without conversion
        serve_url = f"/uploads/3d/{user['id']}/{asset_id}/{original_filename}"
        viewer_type = "cesium" if category != "pointcloud" else "potree"

    # Calculate actual storage used
    actual_size_mb = _dir_size_mb(asset_dir)

    # Save to database
    display_name = name or os.path.splitext(file.filename or "3D Asset")[0]
    row = await db.execute(text(
        """INSERT INTO assets_3d (asset_id, name, category, format, file_size, serve_url, viewer_type,
                                   original_filename, info, owner_id)
           VALUES (:aid, :name, :cat, :fmt, :size, :url, :vtype, :orig, CAST(:info AS jsonb), :owner)
           RETURNING id"""
    ), {
        "aid": asset_id, "name": display_name, "cat": category, "fmt": ext,
        "size": file_size, "url": serve_url, "vtype": viewer_type,
        "orig": file.filename, "info": json.dumps(result_info), "owner": user["id"],
    })
    db_id = row.fetchone()[0]
    await db.commit()

    # Update storage usage
    await _update_storage(user["id"], actual_size_mb, system_db)

    return {
        "id": db_id,
        "asset_id": asset_id,
        "name": display_name,
        "category": category,
        "format": ext,
        "serve_url": serve_url,
        "viewer_type": viewer_type,
        "file_size": file_size,
        "info": result_info,
    }


@router.delete("/{asset_id}")
async def delete_3d_asset(
    asset_id: str,
    user: dict = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
    system_db: AsyncSession = Depends(get_system_db),
):
    """Delete a 3D asset and free storage."""
    result = await db.execute(
        text("SELECT id, owner_id, file_size FROM assets_3d WHERE asset_id = :aid"),
        {"aid": asset_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Asset 3D non trovato")
    if row[1] != user["id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Non autorizzato")

    # Remove from disk
    asset_dir = os.path.join(_get_user_3d_dir(row[1]), asset_id)
    freed_mb = _dir_size_mb(asset_dir) if os.path.exists(asset_dir) else 0
    if os.path.exists(asset_dir):
        shutil.rmtree(asset_dir, ignore_errors=True)

    # Remove from DB
    await db.execute(text("DELETE FROM assets_3d WHERE asset_id = :aid"), {"aid": asset_id})
    await db.commit()

    # Update storage
    if freed_mb > 0:
        await system_db.execute(
            text("UPDATE users SET storage_used_mb = GREATEST(0, COALESCE(storage_used_mb, 0) - :mb) WHERE id = :id"),
            {"id": row[1], "mb": round(freed_mb, 2)},
        )
        await system_db.commit()

    return {"detail": "Asset 3D eliminato", "freed_mb": round(freed_mb, 2)}


# ── Processing functions ─────────────────────────────

async def _process_pointcloud(asset_dir, filepath, ext, asset_id, user_id, info):
    """Process point cloud files (LAS/LAZ/PLY/XYZ/PTS)."""
    viewer_type = "potree"
    output_dir = os.path.join(asset_dir, "potree")
    os.makedirs(output_dir, exist_ok=True)

    # Try py3dtiles conversion (LAS/LAZ → 3D Tiles)
    converted_3dtiles = False
    if ext in (".las", ".laz"):
        try:
            tiles_dir = os.path.join(asset_dir, "3dtiles")
            os.makedirs(tiles_dir, exist_ok=True)
            result = subprocess.run(
                ["py3dtiles", "convert", filepath, "--out", tiles_dir],
                capture_output=True, text=True, timeout=300,
            )
            if result.returncode == 0 and os.path.exists(os.path.join(tiles_dir, "tileset.json")):
                converted_3dtiles = True
                info["has_3dtiles"] = True
                info["tileset_url"] = f"/uploads/3d/{user_id}/{asset_id}/3dtiles/tileset.json"
                viewer_type = "cesium"  # Prefer Cesium if we have 3D Tiles
            else:
                info["conversion_log"] = result.stderr[:500] if result.stderr else "Conversione fallita"
        except FileNotFoundError:
            info["conversion_note"] = "py3dtiles non disponibile, file originale mantenuto"
        except subprocess.TimeoutExpired:
            info["conversion_note"] = "Conversione interrotta (timeout 5 min)"
        except Exception as e:
            info["conversion_note"] = f"Errore conversione: {str(e)[:200]}"

    # Try PotreeConverter if available
    try:
        result = subprocess.run(
            ["PotreeConverter", filepath, "-o", output_dir],
            capture_output=True, text=True, timeout=600,
        )
        if result.returncode == 0:
            # Check for metadata.json (Potree 2.0) or cloud.js (Potree 1.x)
            for meta_file in ["metadata.json", "cloud.js"]:
                meta_path = os.path.join(output_dir, meta_file)
                if os.path.exists(meta_path):
                    info["has_potree"] = True
                    info["potree_url"] = f"/uploads/3d/{user_id}/{asset_id}/potree/{meta_file}"
                    if not converted_3dtiles:
                        viewer_type = "potree"
                    break
    except FileNotFoundError:
        info["potree_note"] = "PotreeConverter non installato, usa il file originale"
    except subprocess.TimeoutExpired:
        info["potree_note"] = "Conversione Potree interrotta (timeout 10 min)"
    except Exception:
        pass

    # Fallback: serve original file (client-side viewers may handle it)
    serve_url = info.get("tileset_url") or info.get("potree_url") or \
        f"/uploads/3d/{user_id}/{asset_id}/{os.path.basename(filepath)}"

    # Try to get basic stats with laspy
    if ext in (".las", ".laz"):
        try:
            import laspy
            with laspy.open(filepath) as f:
                info["point_count"] = f.header.point_count
                info["bounds"] = {
                    "min": [f.header.x_min, f.header.y_min, f.header.z_min],
                    "max": [f.header.x_max, f.header.y_max, f.header.z_max],
                }
                if hasattr(f.header, 'parse_crs') and f.header.parse_crs():
                    info["crs"] = str(f.header.parse_crs())
        except ImportError:
            pass
        except Exception:
            pass

    return serve_url, viewer_type, info


def _process_mesh(asset_dir, filepath, ext, asset_id, user_id, info):
    """Process 3D mesh files (GLB/GLTF/OBJ/FBX/IFC/3DS/DAE)."""
    viewer_type = "cesium"
    filename = os.path.basename(filepath)
    serve_url = f"/uploads/3d/{user_id}/{asset_id}/{filename}"

    # GLB/GLTF can be loaded directly by Cesium
    if ext in (".glb", ".gltf"):
        info["cesium_type"] = "model"
        info["direct_load"] = True
        # For GLTF, check if there are referenced textures/bins
        if ext == ".gltf":
            info["note"] = "GLTF: assicurati che textures e .bin siano inclusi nella stessa directory"

    # OBJ needs conversion ideally, but can be loaded by some viewers
    elif ext == ".obj":
        info["cesium_type"] = "model"
        info["note"] = "OBJ: per migliori prestazioni, converti in GLB con tool come obj2gltf"
        # Check for .mtl file
        mtl_path = filepath.replace(".obj", ".mtl")
        if os.path.exists(mtl_path):
            info["has_material"] = True

    # IFC (BIM) - note that direct loading isn't supported
    elif ext == ".ifc":
        info["cesium_type"] = "model"
        info["note"] = "IFC (BIM): converti in GLB con IfcConvert o carica su Cesium Ion per 3D Tiles"

    # Other formats
    else:
        info["cesium_type"] = "model"
        info["note"] = f"Formato {ext}: per migliori risultati converti in GLB"

    return serve_url, viewer_type, info


def _process_tileset_zip(asset_dir, filepath, asset_id, user_id, info):
    """Process pre-built 3D Tiles ZIP archive."""
    viewer_type = "cesium"

    # Extract ZIP
    extract_dir = os.path.join(asset_dir, "tileset")
    os.makedirs(extract_dir, exist_ok=True)

    try:
        with zipfile.ZipFile(filepath, "r") as zf:
            zf.extractall(extract_dir)
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="File ZIP non valido")

    # Find tileset.json (may be in root or subdirectory)
    tileset_path = None
    for root, dirs, files in os.walk(extract_dir):
        if "tileset.json" in files:
            tileset_path = os.path.join(root, "tileset.json")
            break

    if not tileset_path:
        raise HTTPException(
            status_code=400,
            detail="Nessun tileset.json trovato nell'archivio. "
                   "Assicurati che il ZIP contenga un set di 3D Tiles valido.",
        )

    # Make relative URL
    rel_path = os.path.relpath(tileset_path, settings.UPLOAD_DIR).replace("\\", "/")
    serve_url = f"/uploads/{rel_path}"
    info["tileset_url"] = serve_url
    info["direct_load"] = True

    # Remove original ZIP to save space
    os.remove(filepath)

    return serve_url, viewer_type, info


def _process_terrain(asset_dir, filepath, asset_id, user_id, info):
    """Process terrain GeoTIFF (DEM/DTM)."""
    viewer_type = "cesium"
    filename = os.path.basename(filepath)
    serve_url = f"/uploads/3d/{user_id}/{asset_id}/{filename}"

    info["terrain_type"] = "dem"
    info["note"] = (
        "Per usare come terreno 3D in Cesium, carica su Cesium Ion che lo converte "
        "in Quantized Mesh. In alternativa, usa come layer raster COG sulla mappa 2D."
    )

    # Try to read basic info with GDAL
    try:
        from osgeo import gdal
        ds = gdal.Open(filepath)
        if ds:
            info["raster_size"] = [ds.RasterXSize, ds.RasterYSize]
            info["bands"] = ds.RasterCount
            gt = ds.GetGeoTransform()
            if gt:
                info["bounds"] = {
                    "min_x": gt[0],
                    "max_x": gt[0] + gt[1] * ds.RasterXSize,
                    "min_y": gt[3] + gt[5] * ds.RasterYSize,
                    "max_y": gt[3],
                }
            ds = None
    except ImportError:
        pass
    except Exception:
        pass

    return serve_url, viewer_type, info


def _process_kml(asset_dir, filepath, ext, asset_id, user_id, info):
    """Process KML/KMZ files."""
    viewer_type = "cesium"
    filename = os.path.basename(filepath)

    # KMZ is a ZIP, extract it
    if ext == ".kmz":
        extract_dir = os.path.join(asset_dir, "kml")
        os.makedirs(extract_dir, exist_ok=True)
        try:
            with zipfile.ZipFile(filepath, "r") as zf:
                zf.extractall(extract_dir)
            # Find the .kml inside
            for f in os.listdir(extract_dir):
                if f.endswith(".kml"):
                    filename = f"kml/{f}"
                    break
        except zipfile.BadZipFile:
            pass

    serve_url = f"/uploads/3d/{user_id}/{asset_id}/{filename}"
    info["cesium_type"] = "kml"
    info["note"] = "KML/KMZ: supportato nativamente da Cesium"

    return serve_url, viewer_type, info


@router.get("/quota")
async def get_storage_quota(
    user: dict = Depends(get_current_user),
    system_db: AsyncSession = Depends(get_system_db),
):
    """Get user's storage usage and quota."""
    result = await system_db.execute(
        text("SELECT storage_used_mb, storage_limit_mb FROM users WHERE id = :id"),
        {"id": user["id"]},
    )
    row = result.fetchone()
    if not row:
        return {"used_mb": 0, "limit_mb": settings.DEFAULT_STORAGE_LIMIT_MB, "percent": 0}
    used = float(row[0] or 0)
    limit = float(row[1] or settings.DEFAULT_STORAGE_LIMIT_MB)
    return {
        "used_mb": round(used, 2),
        "limit_mb": round(limit, 2),
        "percent": round((used / limit * 100) if limit > 0 else 0, 1),
    }
