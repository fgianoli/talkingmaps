"""
Symbology management system - inspired by SITVI simbologie.php/simbologie-runtime.js.
Handles style definitions, presets, and MapLibre style compilation.
"""
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db
from core.security import get_current_user, require_editor

router = APIRouter()


class SymbologyCreate(BaseModel):
    name: str
    description: str | None = None
    layer_id: int | None = None
    geometry_type: str | None = None  # point, line, polygon, raster
    style_type: str  # simple, graduated, categorized, rule-based, heatmap, cluster, icon, label, pattern, raster-filter
    config: dict
    is_default: bool = False


class SymbologyUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    style_type: str | None = None
    config: dict | None = None
    is_default: bool | None = None


# ── CRUD ──────────────────────────────────────────────

@router.get("/")
async def list_symbologies(
    layer_id: int | None = None,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = "SELECT * FROM symbologies"
    params = {}
    if layer_id is not None:
        q += " WHERE layer_id = :lid"
        params["lid"] = layer_id
    q += " ORDER BY name"
    result = await db.execute(text(q), params)
    return [dict(r) for r in result.mappings().all()]


@router.get("/presets")
async def list_presets(
    category: str | None = None,
    geometry_type: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    q = "SELECT * FROM symbology_presets WHERE 1=1"
    params = {}
    if category:
        q += " AND category = :cat"
        params["cat"] = category
    if geometry_type:
        q += " AND (geometry_type = :gt OR geometry_type IS NULL)"
        params["gt"] = geometry_type
    q += " ORDER BY position"
    result = await db.execute(text(q), params)
    return [dict(r) for r in result.mappings().all()]


@router.get("/{symbology_id}")
async def get_symbology(symbology_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("SELECT * FROM symbologies WHERE id = :id"), {"id": symbology_id})
    row = result.mappings().fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Simbologia non trovata")
    return dict(row)


@router.post("/")
async def create_symbology(req: SymbologyCreate, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    # Compile to MapLibre style
    maplibre_style = compile_to_maplibre(req.config, req.style_type, req.geometry_type)

    # If setting as default, unset other defaults for same layer
    if req.is_default and req.layer_id:
        await db.execute(text(
            "UPDATE symbologies SET is_default = FALSE WHERE layer_id = :lid"
        ), {"lid": req.layer_id})

    result = await db.execute(text(
        """INSERT INTO symbologies (name, description, layer_id, geometry_type, style_type, config, maplibre_style, is_default, owner_id)
           VALUES (:name, :desc, :lid, :gt, :st, :cfg::jsonb, :mls::jsonb, :def, :owner)
           RETURNING id"""
    ), {
        "name": req.name, "desc": req.description, "lid": req.layer_id,
        "gt": req.geometry_type, "st": req.style_type,
        "cfg": json.dumps(req.config), "mls": json.dumps(maplibre_style),
        "def": req.is_default, "owner": user["id"],
    })
    symb_id = result.fetchone()[0]
    await db.commit()
    return {"id": symb_id, "maplibre_style": maplibre_style}


@router.put("/{symbology_id}")
async def update_symbology(symbology_id: int, req: SymbologyUpdate, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    # Get current record for style_type / geometry_type fallback
    current = await db.execute(text("SELECT * FROM symbologies WHERE id = :id"), {"id": symbology_id})
    row = current.mappings().fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Simbologia non trovata")

    sets = []
    params = {"id": symbology_id}

    if req.name is not None:
        sets.append("name = :name")
        params["name"] = req.name
    if req.description is not None:
        sets.append("description = :desc")
        params["desc"] = req.description
    if req.style_type is not None:
        sets.append("style_type = :st")
        params["st"] = req.style_type
    if req.is_default is not None:
        sets.append("is_default = :def")
        params["def"] = req.is_default
        if req.is_default and row["layer_id"]:
            await db.execute(text("UPDATE symbologies SET is_default = FALSE WHERE layer_id = :lid AND id != :id"),
                             {"lid": row["layer_id"], "id": symbology_id})

    if req.config is not None:
        sets.append("config = :cfg::jsonb")
        params["cfg"] = json.dumps(req.config)
        # Recompile MapLibre style
        st = req.style_type or row["style_type"]
        gt = row["geometry_type"]
        maplibre_style = compile_to_maplibre(req.config, st, gt)
        sets.append("maplibre_style = :mls::jsonb")
        params["mls"] = json.dumps(maplibre_style)

    if not sets:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    sets.append("updated_at = NOW()")
    await db.execute(text(f"UPDATE symbologies SET {', '.join(sets)} WHERE id = :id"), params)
    await db.commit()
    return {"detail": "Simbologia aggiornata"}


@router.delete("/{symbology_id}")
async def delete_symbology(symbology_id: int, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("DELETE FROM symbologies WHERE id = :id RETURNING id"), {"id": symbology_id})
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Simbologia non trovata")
    await db.commit()
    return {"detail": "Simbologia eliminata"}


@router.post("/{symbology_id}/compile")
async def recompile_symbology(symbology_id: int, db: AsyncSession = Depends(get_db)):
    """Recompile config to MapLibre style spec."""
    result = await db.execute(text("SELECT * FROM symbologies WHERE id = :id"), {"id": symbology_id})
    row = result.mappings().fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Simbologia non trovata")
    maplibre_style = compile_to_maplibre(row["config"], row["style_type"], row["geometry_type"])
    await db.execute(text(
        "UPDATE symbologies SET maplibre_style = :mls::jsonb, updated_at = NOW() WHERE id = :id"
    ), {"id": symbology_id, "mls": json.dumps(maplibre_style)})
    await db.commit()
    return {"maplibre_style": maplibre_style}


# ══════════════════════════════════════════════════════
# MapLibre Style Compiler
# Port of SITVI's sitviConvertStyleToMapLibre()
# ══════════════════════════════════════════════════════

def compile_to_maplibre(config: dict, style_type: str, geometry_type: str | None) -> dict:
    """Convert a style configuration to MapLibre paint/layout properties."""
    compilers = {
        "simple": _compile_simple,
        "graduated": _compile_graduated,
        "categorized": _compile_categorized,
        "rule-based": _compile_rule_based,
        "heatmap": _compile_heatmap,
        "cluster": _compile_cluster,
        "icon": _compile_icon,
        "label": _compile_label,
        "pattern": _compile_pattern,
        "raster-filter": _compile_raster_filter,
    }
    compiler = compilers.get(style_type, _compile_simple)
    try:
        return compiler(config, geometry_type)
    except Exception:
        return _compile_simple(config, geometry_type)


def _compile_simple(config: dict, geom: str | None) -> dict:
    """Simple single-symbol style."""
    result = {}
    if "paint" in config:
        result["paint"] = config["paint"]
    if "layout" in config:
        result["layout"] = config["layout"]
    if not result:
        # Generate default from config fields
        paint = {}
        if geom == "point" or config.get("type") == "circle":
            paint = {
                "circle-radius": config.get("radius", 6),
                "circle-color": config.get("color", "#3388ff"),
                "circle-opacity": config.get("opacity", 0.8),
                "circle-stroke-width": config.get("stroke_width", 2),
                "circle-stroke-color": config.get("stroke_color", "#ffffff"),
            }
        elif geom == "line":
            paint = {
                "line-color": config.get("color", "#3388ff"),
                "line-width": config.get("width", 3),
                "line-opacity": config.get("opacity", 0.8),
            }
        elif geom == "polygon":
            paint = {
                "fill-color": config.get("color", "#3388ff"),
                "fill-opacity": config.get("opacity", 0.4),
                "fill-outline-color": config.get("outline_color", "#2266cc"),
            }
        result["paint"] = paint
    return result


def _compile_graduated(config: dict, geom: str | None) -> dict:
    """Graduated (choropleth) style using interpolate/step expressions."""
    field = config.get("field", "value")
    colors = config.get("colors", ["#f7fbff", "#08306b"])
    breaks = config.get("breaks", [])
    method = config.get("method", "interpolate")  # interpolate or step

    if not breaks:
        return _compile_simple(config, geom)

    color_prop = _color_property(geom)

    if method == "interpolate":
        expr = ["interpolate", ["linear"], ["get", field]]
        for i, b in enumerate(breaks):
            expr.append(b)
            color_idx = min(i, len(colors) - 1)
            expr.append(colors[color_idx])
    else:
        expr = ["step", ["get", field], colors[0]]
        for i, b in enumerate(breaks):
            expr.append(b)
            color_idx = min(i + 1, len(colors) - 1)
            expr.append(colors[color_idx])

    paint = {color_prop: expr}
    if geom == "polygon":
        paint["fill-opacity"] = config.get("opacity", 0.7)
        paint["fill-outline-color"] = config.get("outline_color", "#333333")
    elif geom == "point":
        paint["circle-radius"] = config.get("radius", 6)
        paint["circle-stroke-width"] = 1
        paint["circle-stroke-color"] = "#ffffff"
    elif geom == "line":
        paint["line-width"] = config.get("width", 3)

    return {"paint": paint}


def _compile_categorized(config: dict, geom: str | None) -> dict:
    """Categorized style using match expressions."""
    field = config.get("field", "category")
    categories = config.get("categories", {})  # {value: color}
    default_color = config.get("default_color", "#cccccc")

    if not categories:
        return _compile_simple(config, geom)

    color_prop = _color_property(geom)
    expr = ["match", ["get", field]]
    for val, color in categories.items():
        expr.append(val)
        expr.append(color)
    expr.append(default_color)

    paint = {color_prop: expr}
    if geom == "polygon":
        paint["fill-opacity"] = config.get("opacity", 0.7)
    elif geom == "point":
        paint["circle-radius"] = config.get("radius", 6)
        paint["circle-stroke-width"] = 1
    elif geom == "line":
        paint["line-width"] = config.get("width", 3)

    return {"paint": paint}


def _compile_rule_based(config: dict, geom: str | None) -> dict:
    """Rule-based style using case expressions."""
    rules = config.get("rules", [])
    default_color = config.get("default_color", "#cccccc")

    if not rules:
        return _compile_simple(config, geom)

    color_prop = _color_property(geom)
    expr = ["case"]
    for rule in rules:
        filter_expr = rule.get("filter", True)
        color = rule.get("color", "#cccccc")
        expr.append(filter_expr)
        expr.append(color)
    expr.append(default_color)

    paint = {color_prop: expr}
    return {"paint": paint}


def _compile_heatmap(config: dict, geom: str | None) -> dict:
    """Heatmap style."""
    return {
        "paint": {
            "heatmap-weight": config.get("weight", 1),
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 9, 3],
            "heatmap-color": [
                "interpolate", ["linear"], ["heatmap-density"],
                0, "rgba(33,102,172,0)",
                0.2, config.get("color_low", "rgb(103,169,207)"),
                0.4, config.get("color_mid_low", "rgb(209,229,240)"),
                0.6, config.get("color_mid", "rgb(253,219,199)"),
                0.8, config.get("color_mid_high", "rgb(239,138,98)"),
                1, config.get("color_high", "rgb(178,24,43)"),
            ],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 2, 9, 20],
            "heatmap-opacity": config.get("opacity", 0.8),
        },
        "type": "heatmap",
    }


def _compile_cluster(config: dict, geom: str | None) -> dict:
    """Cluster configuration."""
    return {
        "cluster": True,
        "cluster_radius": config.get("radius", 50),
        "cluster_max_zoom": config.get("max_zoom", 14),
        "paint": {
            "circle-color": [
                "step", ["get", "point_count"],
                config.get("color_small", "#51bbd6"),
                config.get("threshold_medium", 10),
                config.get("color_medium", "#f1f075"),
                config.get("threshold_large", 50),
                config.get("color_large", "#f28cb1"),
            ],
            "circle-radius": [
                "step", ["get", "point_count"],
                config.get("radius_small", 15),
                config.get("threshold_medium", 10),
                config.get("radius_medium", 20),
                config.get("threshold_large", 50),
                config.get("radius_large", 25),
            ],
        },
    }


def _compile_icon(config: dict, geom: str | None) -> dict:
    """Icon/symbol style for points."""
    return {
        "layout": {
            "icon-image": config.get("icon", "marker"),
            "icon-size": config.get("size", 1),
            "icon-allow-overlap": config.get("allow_overlap", True),
            "icon-anchor": config.get("anchor", "bottom"),
        },
        "paint": {
            "icon-opacity": config.get("opacity", 1),
        },
        "type": "symbol",
    }


def _compile_label(config: dict, geom: str | None) -> dict:
    """Text label style."""
    return {
        "layout": {
            "text-field": ["get", config.get("field", "name")],
            "text-size": config.get("size", 12),
            "text-font": ["Open Sans Regular"],
            "text-anchor": config.get("anchor", "top"),
            "text-offset": config.get("offset", [0, 0.5]),
            "text-allow-overlap": config.get("allow_overlap", False),
            "text-max-width": config.get("max_width", 10),
        },
        "paint": {
            "text-color": config.get("color", "#333333"),
            "text-halo-color": config.get("halo_color", "#ffffff"),
            "text-halo-width": config.get("halo_width", 1),
        },
        "type": "symbol",
    }


def _compile_pattern(config: dict, geom: str | None) -> dict:
    """Pattern fill/line style."""
    paint = {}
    if geom == "polygon":
        paint["fill-pattern"] = config.get("pattern", "")
        paint["fill-opacity"] = config.get("opacity", 1)
    elif geom == "line":
        paint["line-pattern"] = config.get("pattern", "")
        paint["line-width"] = config.get("width", 3)
    return {"paint": paint}


def _compile_raster_filter(config: dict, geom: str | None) -> dict:
    """Raster filter style (opacity, brightness, contrast, saturation)."""
    return {
        "paint": {
            "raster-opacity": config.get("opacity", 1),
            "raster-brightness-min": config.get("brightness_min", 0),
            "raster-brightness-max": config.get("brightness_max", 1),
            "raster-contrast": config.get("contrast", 0),
            "raster-saturation": config.get("saturation", 0),
            "raster-hue-rotate": config.get("hue_rotate", 0),
        },
        "type": "raster",
    }


def _color_property(geom: str | None) -> str:
    if geom == "line":
        return "line-color"
    elif geom == "polygon":
        return "fill-color"
    return "circle-color"
