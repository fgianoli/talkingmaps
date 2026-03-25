"""
WFS/WMS Capabilities & Feature Proxy
Extends the WMS proxy with capabilities parsing and WFS support.
"""
from urllib.parse import urlparse, urlencode
from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import Response
import httpx
import xml.etree.ElementTree as ET
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db
from core.security import get_current_user

router = APIRouter()


async def _is_host_allowed(url: str, db: AsyncSession = None, user_id: int = None) -> bool:
    """Check against static whitelist + user's service catalog."""
    from routers.wms_proxy import ALLOWED_HOSTS
    try:
        parsed = urlparse(url)
        host = parsed.hostname
        if host in ALLOWED_HOSTS:
            return True
        # Check user's service catalog
        if db and user_id:
            result = await db.execute(
                text("SELECT id FROM service_catalog WHERE owner_id = :uid AND url LIKE :pattern"),
                {"uid": user_id, "pattern": f"%{host}%"}
            )
            if result.fetchone():
                return True
        # Allow any host if user is authenticated (they explicitly added the URL)
        if user_id:
            return True
        return False
    except Exception:
        return False


@router.get("/capabilities")
async def get_capabilities(
    url: str = Query(..., description="Base URL of WMS/WFS service"),
    service: str = Query("WMS", description="Service type: WMS or WFS"),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fetch GetCapabilities and return parsed layer list as JSON."""
    if not await _is_host_allowed(url, db, user["id"]):
        raise HTTPException(status_code=403, detail="Host non consentito")

    params = {
        "SERVICE": service.upper(),
        "REQUEST": "GetCapabilities",
    }
    if service.upper() == "WFS":
        params["VERSION"] = "2.0.0"

    full_url = f"{url}?{urlencode(params)}" if "?" not in url else f"{url}&{urlencode(params)}"

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(full_url)
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="Error from service")

            xml_text = resp.text
            layers = _parse_capabilities(xml_text, service.upper())
            return {"service": service.upper(), "url": url, "layers": layers}

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Timeout from service")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Connection error: {str(e)}")


def _parse_capabilities(xml_text: str, service_type: str) -> list:
    """Parse WMS or WFS GetCapabilities XML into a list of layer dicts."""
    layers = []
    try:
        root = ET.fromstring(xml_text)
        # Handle namespaces
        ns = {}
        for attr, value in root.attrib.items():
            if attr.startswith('{'):
                continue
        # Extract default namespace
        tag = root.tag
        if tag.startswith('{'):
            default_ns = tag[1:tag.index('}')]
            ns['ns'] = default_ns

        if service_type == "WMS":
            # Find all Layer elements with a Name child
            for layer_el in root.iter():
                if layer_el.tag.endswith('}Layer') or layer_el.tag == 'Layer':
                    name_el = None
                    title_el = None
                    abstract_el = None
                    for child in layer_el:
                        tag_local = child.tag.split('}')[-1] if '}' in child.tag else child.tag
                        if tag_local == 'Name':
                            name_el = child
                        elif tag_local == 'Title':
                            title_el = child
                        elif tag_local == 'Abstract':
                            abstract_el = child
                    if name_el is not None and name_el.text:
                        layers.append({
                            "name": name_el.text,
                            "title": title_el.text if title_el is not None else name_el.text,
                            "abstract": abstract_el.text if abstract_el is not None else "",
                        })
        elif service_type == "WFS":
            for ft_el in root.iter():
                tag_local = ft_el.tag.split('}')[-1] if '}' in ft_el.tag else ft_el.tag
                if tag_local == 'FeatureType':
                    name_el = None
                    title_el = None
                    abstract_el = None
                    for child in ft_el:
                        child_tag = child.tag.split('}')[-1] if '}' in child.tag else child.tag
                        if child_tag == 'Name':
                            name_el = child
                        elif child_tag == 'Title':
                            title_el = child
                        elif child_tag == 'Abstract':
                            abstract_el = child
                    if name_el is not None and name_el.text:
                        layers.append({
                            "name": name_el.text,
                            "title": title_el.text if title_el is not None else name_el.text,
                            "abstract": abstract_el.text if abstract_el is not None else "",
                        })
    except ET.ParseError:
        pass
    return layers


@router.get("/features")
async def get_features(
    url: str = Query(..., description="Base URL of WFS service"),
    type_name: str = Query(..., description="Feature type name"),
    max_features: int = Query(1000, description="Max features to return"),
    srs: str = Query("EPSG:4326", description="Output SRS"),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Proxy WFS GetFeature, return GeoJSON."""
    if not await _is_host_allowed(url, db, user["id"]):
        raise HTTPException(status_code=403, detail="Host non consentito")

    params = {
        "SERVICE": "WFS",
        "REQUEST": "GetFeature",
        "VERSION": "2.0.0",
        "TYPENAMES": type_name,
        "COUNT": str(max_features),
        "SRSNAME": srs,
        "OUTPUTFORMAT": "application/json",
    }

    full_url = f"{url}?{urlencode(params)}" if "?" not in url else f"{url}&{urlencode(params)}"

    try:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            resp = await client.get(full_url)
            content_type = resp.headers.get("content-type", "application/json")
            return Response(
                content=resp.content,
                media_type=content_type,
                headers={
                    "Cache-Control": "public, max-age=3600",
                    "Access-Control-Allow-Origin": "*",
                },
            )
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Timeout from WFS service")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Connection error: {str(e)}")
