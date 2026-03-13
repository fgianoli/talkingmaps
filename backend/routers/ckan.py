"""
CKAN Data Import – fetch datasets from CKAN open data portals.
Inspired by https://github.com/ondata/ckan-mcp-server
Allows users to search and import tabular/geographic data from CKAN instances.
"""
import json
import ipaddress
import socket
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, Query
import httpx
from core.security import get_current_user

router = APIRouter()


def _is_safe_url(url: str) -> bool:
    """Block SSRF: reject private IPs, localhost, and non-http schemes."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = parsed.hostname
        if not hostname:
            return False
        if hostname in ("localhost", "127.0.0.1", "0.0.0.0", "::1"):
            return False
        for info in socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return False
        return True
    except Exception:
        return False


# Well-known CKAN portals
KNOWN_PORTALS = {
    "dati.gov.it": "https://dati.gov.it",
    "data.europa.eu": "https://data.europa.eu/data/api",
    "opendata.comune.venezia": "https://dati.venezia.it",
    "dati.trentino": "https://dati.trentino.it",
}


@router.get("/portals")
async def list_portals():
    """List known CKAN portals."""
    return [{"id": k, "url": v} for k, v in KNOWN_PORTALS.items()]


@router.get("/search")
async def search_datasets(
    portal_url: str = Query(..., description="Base URL del portale CKAN"),
    q: str = Query("", description="Query di ricerca"),
    rows: int = Query(20, ge=1, le=100),
    start: int = Query(0, ge=0),
    format_filter: str | None = Query(None, description="Filtra per formato (csv, geojson, json, shp)"),
    user: dict = Depends(get_current_user),
):
    """Search datasets on a CKAN portal."""
    if not _is_safe_url(portal_url):
        raise HTTPException(status_code=400, detail="URL non consentito (indirizzo privato o non valido)")
    api_url = f"{portal_url.rstrip('/')}/api/3/action/package_search"
    params = {"q": q, "rows": rows, "start": start}
    if format_filter:
        params["fq"] = f"res_format:{format_filter.upper()}"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(api_url, params=params)
            data = resp.json()
            if not data.get("success"):
                raise HTTPException(status_code=502, detail="Errore dal portale CKAN")
            result = data.get("result", {})
            return {
                "count": result.get("count", 0),
                "datasets": [
                    {
                        "id": ds.get("id"),
                        "title": ds.get("title"),
                        "notes": ds.get("notes", "")[:200],
                        "organization": ds.get("organization", {}).get("title", ""),
                        "resources": [
                            {
                                "id": r.get("id"),
                                "name": r.get("name"),
                                "format": r.get("format", "").upper(),
                                "url": r.get("url"),
                                "size": r.get("size"),
                                "last_modified": r.get("last_modified"),
                            }
                            for r in ds.get("resources", [])
                            if r.get("format", "").upper() in ("CSV", "GEOJSON", "JSON", "SHP", "KML", "XLSX", "ODS", "WMS", "WFS")
                        ],
                    }
                    for ds in result.get("results", [])
                ],
            }
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Errore connessione al portale: {str(e)}")


@router.get("/resource")
async def get_resource(
    url: str = Query(..., description="URL della risorsa CKAN"),
    user: dict = Depends(get_current_user),
):
    """Fetch a CKAN resource (CSV, GeoJSON) and return its content."""
    if not _is_safe_url(url):
        raise HTTPException(status_code=400, detail="URL non consentito (indirizzo privato o non valido)")
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(url)
            content_type = resp.headers.get("content-type", "")

            # GeoJSON
            if "json" in content_type or url.endswith(".geojson") or url.endswith(".json"):
                return resp.json()

            # CSV - parse to JSON
            if "csv" in content_type or url.endswith(".csv"):
                text = resp.text
                lines = text.strip().split("\n")
                if not lines:
                    return {"columns": [], "rows": []}

                # Detect separator
                sep = ";" if lines[0].count(";") > lines[0].count(",") else ","
                headers = [h.strip().strip('"') for h in lines[0].split(sep)]
                rows = []
                for line in lines[1:]:
                    vals = [v.strip().strip('"') for v in line.split(sep)]
                    if len(vals) == len(headers):
                        rows.append(dict(zip(headers, vals)))

                return {
                    "columns": headers,
                    "rows": rows[:5000],  # Limit for safety
                    "total": len(rows),
                }

            # Other - return raw text
            return {"content": resp.text[:100000], "content_type": content_type}

    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Errore fetch risorsa: {str(e)}")


@router.post("/import-as-layer")
async def import_as_layer(
    body: dict,
    user: dict = Depends(get_current_user),
):
    """
    Import a CKAN resource directly as a TalkingMaps layer.
    Body: { url, name, format }
    For GeoJSON: creates a geojson layer
    For CSV with lat/lon: creates a geojson layer from tabular data
    For WMS: creates a wms layer
    """
    from sqlalchemy import text as sql_text
    from core.database import AsyncSessionLocal

    url = body.get("url")
    name = body.get("name", "CKAN Import")
    fmt = body.get("format", "").upper()
    lat_field = body.get("lat_field")
    lon_field = body.get("lon_field")

    if not url:
        raise HTTPException(status_code=400, detail="URL risorsa mancante")
    if not _is_safe_url(url):
        raise HTTPException(status_code=400, detail="URL non consentito (indirizzo privato o non valido)")

    async with AsyncSessionLocal() as db:
        if fmt in ("WMS", "WFS"):
            # Create WMS layer
            result = await db.execute(sql_text(
                """INSERT INTO layers (name, layer_type, source_config, owner_id, public)
                   VALUES (:name, 'wms', CAST(:src AS jsonb), :owner, FALSE) RETURNING id"""
            ), {"name": name, "src": json.dumps({"url": url, "layers": body.get("layers", "")}), "owner": user["id"]})
            layer_id = result.fetchone()[0]
            await db.commit()
            return {"id": layer_id, "type": "wms"}

        # Fetch the data
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(url)
            content = resp.text

        if fmt == "GEOJSON" or "geojson" in url.lower():
            geojson = json.loads(content)
        elif fmt == "CSV" and lat_field and lon_field:
            # Convert CSV to GeoJSON
            lines = content.strip().split("\n")
            sep = ";" if lines[0].count(";") > lines[0].count(",") else ","
            headers = [h.strip().strip('"') for h in lines[0].split(sep)]
            features = []
            for line in lines[1:]:
                vals = [v.strip().strip('"') for v in line.split(sep)]
                if len(vals) != len(headers):
                    continue
                row = dict(zip(headers, vals))
                try:
                    lat = float(row.get(lat_field, 0))
                    lon = float(row.get(lon_field, 0))
                    if lat and lon:
                        features.append({
                            "type": "Feature",
                            "geometry": {"type": "Point", "coordinates": [lon, lat]},
                            "properties": {k: v for k, v in row.items() if k not in (lat_field, lon_field)},
                        })
                except ValueError:
                    continue
            geojson = {"type": "FeatureCollection", "features": features}
        else:
            raise HTTPException(status_code=400, detail=f"Formato {fmt} non supportato per import diretto. Usa GeoJSON o CSV con coordinate.")

        # Save GeoJSON to filesystem and create layer
        import uuid, os, aiofiles
        from core.config import settings

        filename = f"{uuid.uuid4().hex}.geojson"
        filepath = os.path.join(settings.UPLOAD_DIR, "layers", filename)
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        async with aiofiles.open(filepath, "w") as f:
            await f.write(json.dumps(geojson))

        # Detect geometry type
        geom_type = "point"
        if geojson.get("features"):
            gt = geojson["features"][0].get("geometry", {}).get("type", "").lower()
            if "polygon" in gt:
                geom_type = "polygon"
            elif "line" in gt:
                geom_type = "line"

        result = await db.execute(sql_text(
            """INSERT INTO layers (name, layer_type, source_config, style_config, owner_id, public)
               VALUES (:name, 'geojson', CAST(:src AS jsonb), CAST(:style AS jsonb), :owner, FALSE) RETURNING id"""
        ), {
            "name": name,
            "src": json.dumps({"url": f"/uploads/layers/{filename}", "type": "geojson"}),
            "style": json.dumps(_default_style(geom_type)),
            "owner": user["id"],
        })
        layer_id = result.fetchone()[0]
        await db.commit()
        return {"id": layer_id, "type": "geojson", "features": len(geojson.get("features", []))}


def _default_style(geom_type: str) -> dict:
    styles = {
        "point": {"type": "circle", "paint": {"circle-radius": 6, "circle-color": "#3388ff", "circle-stroke-width": 2, "circle-stroke-color": "#fff"}},
        "line": {"paint": {"line-color": "#3388ff", "line-width": 3}},
        "polygon": {"paint": {"fill-color": "#3388ff", "fill-opacity": 0.4, "fill-outline-color": "#2266cc"}},
    }
    return styles.get(geom_type, styles["point"])
