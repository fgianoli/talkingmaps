"""
WMS Proxy - ported from anncsu-tool wms_proxy.py.
Proxies WMS requests to whitelisted servers, handling CORS and reprojection.
"""
from urllib.parse import urlparse, urlencode, parse_qs
from fastapi import APIRouter, HTTPException, Query
from core.safe_http import fetch_validated
from fastapi.responses import Response
import httpx

router = APIRouter()

# Whitelist of allowed WMS hosts
ALLOWED_HOSTS = [
    "wms.cartografia.agenziaentrate.gov.it",
    "www.pcn.minambiente.it",
    "geoserver.studiogis.eu",
    "idt2-geoserver.regione.veneto.it",
    "wms.qgiscloud.com",
    "tile.openstreetmap.org",
    "server.arcgisonline.com",
    "basemaps.cartocdn.com",
    "tiles.stadiamaps.com",
    "mt0.google.com",
    "mt1.google.com",
    "a.tile.opentopomap.org",
    "b.tile.opentopomap.org",
    "c.tile.opentopomap.org",
]


def _is_host_allowed(url: str) -> bool:
    try:
        parsed = urlparse(url)
        return parsed.hostname in ALLOWED_HOSTS
    except Exception:
        return False


@router.get("/tile")
async def proxy_tile(url: str = Query(..., description="URL del servizio WMS/tile")):
    if not _is_host_allowed(url):
        raise HTTPException(status_code=403, detail="Host non consentito")

    try:
        # Redirects are followed by hand so the allow-list is re-checked on each hop
        async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
            resp = await fetch_validated(client, url, _is_host_allowed)
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="Errore dal server WMS")
            content_type = resp.headers.get("content-type", "image/png")
            return Response(
                content=resp.content,
                media_type=content_type,
                headers={
                    "Cache-Control": "public, max-age=86400",
                    "Access-Control-Allow-Origin": "*",
                },
            )
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Timeout dal server WMS")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Errore di connessione: {str(e)}")


@router.get("/wms")
async def proxy_wms(
    url: str = Query(..., description="Base URL del servizio WMS"),
    service: str = "WMS",
    request: str = "GetMap",
    layers: str = "",
    styles: str = "",
    format: str = "image/png",
    transparent: str = "true",
    version: str = "1.1.1",
    width: int = 256,
    height: int = 256,
    srs: str = "EPSG:3857",
    bbox: str = "",
):
    """Proxy WMS GetMap requests with parameter normalization."""
    if not _is_host_allowed(url):
        raise HTTPException(status_code=403, detail="Host non consentito")

    params = {
        "SERVICE": service,
        "REQUEST": request,
        "LAYERS": layers,
        "STYLES": styles,
        "FORMAT": format,
        "TRANSPARENT": transparent,
        "VERSION": version,
        "WIDTH": str(width),
        "HEIGHT": str(height),
    }

    # Handle SRS vs CRS based on WMS version
    if version >= "1.3.0":
        params["CRS"] = srs
    else:
        params["SRS"] = srs
    params["BBOX"] = bbox

    full_url = f"{url}?{urlencode(params)}"

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
            resp = await fetch_validated(client, full_url, _is_host_allowed)
            content_type = resp.headers.get("content-type", "image/png")
            return Response(
                content=resp.content,
                media_type=content_type,
                headers={
                    "Cache-Control": "public, max-age=86400",
                    "Access-Control-Allow-Origin": "*",
                },
            )
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Timeout dal server WMS")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Errore di connessione: {str(e)}")
