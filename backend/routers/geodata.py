"""
TalkingMaps – External Geodata Router
Wikipedia geosearch, OSM Overpass queries, Wikidata enrichment.
No API keys required — uses public APIs with respectful rate limiting.
"""
import re
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from core.security import get_current_user

router = APIRouter()

HEADERS = {"User-Agent": "TalkingMaps/2.0 (storymap tool; contact@studiogis.eu)"}


# ── Wikipedia Geosearch ──────

@router.get("/wikipedia/nearby")
async def wikipedia_nearby(
    lat: float = Query(..., description="Latitude"),
    lng: float = Query(..., description="Longitude"),
    radius: int = Query(5000, ge=100, le=10000, description="Search radius in meters"),
    limit: int = Query(20, ge=1, le=50),
    lang: str = Query("it", description="Wikipedia language code (it, en, es, fr, de...)"),
    _user: dict = Depends(get_current_user),
):
    """Find Wikipedia articles near a geographic point."""
    # lang becomes part of the hostname, so it has to be a bare language code and
    # nothing else — otherwise it is a request-forgery primitive.
    if not re.fullmatch(r"[a-z]{2,3}(-[a-z]{2,8})?", lang or ""):
        raise HTTPException(status_code=400, detail="Codice lingua non valido")
    async with httpx.AsyncClient(timeout=10, headers=HEADERS) as client:
        resp = await client.get(
            f"https://{lang}.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "list": "geosearch",
                "gscoord": f"{lat}|{lng}",
                "gsradius": radius,
                "gslimit": limit,
                "format": "json",
            },
        )
        if resp.status_code != 200:
            raise HTTPException(502, "Wikipedia API error")
        data = resp.json()
        articles = data.get("query", {}).get("geosearch", [])

    # Fetch extracts and thumbnails for found articles
    if articles:
        page_ids = "|".join(str(a["pageid"]) for a in articles)
        async with httpx.AsyncClient(timeout=10, headers=HEADERS) as client:
            detail_resp = await client.get(
                f"https://{lang}.wikipedia.org/w/api.php",
                params={
                    "action": "query",
                    "pageids": page_ids,
                    "prop": "extracts|pageimages|info",
                    "exintro": True,
                    "exsentences": 3,
                    "explaintext": True,
                    "piprop": "thumbnail",
                    "pithumbsize": 300,
                    "inprop": "url",
                    "format": "json",
                },
            )
            if detail_resp.status_code == 200:
                pages = detail_resp.json().get("query", {}).get("pages", {})
            else:
                pages = {}

        results = []
        for a in articles:
            page = pages.get(str(a["pageid"]), {})
            results.append({
                "pageid": a["pageid"],
                "title": a["title"],
                "lat": a["lat"],
                "lng": a["lon"],
                "dist": a.get("dist", 0),
                "extract": page.get("extract", ""),
                "thumbnail": page.get("thumbnail", {}).get("source", ""),
                "url": page.get("fullurl", f"https://{lang}.wikipedia.org/wiki/{a['title'].replace(' ', '_')}"),
            })
        return {"articles": results}

    return {"articles": []}


@router.get("/wikipedia/search")
async def wikipedia_search(
    q: str = Query(..., min_length=2, description="Search text"),
    limit: int = Query(10, ge=1, le=20),
    lang: str = Query("it"),
    _user: dict = Depends(get_current_user),
):
    """Search Wikipedia articles by text with coordinates."""
    async with httpx.AsyncClient(timeout=10, headers=HEADERS) as client:
        resp = await client.get(
            f"https://{lang}.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "generator": "search",
                "gsrsearch": q,
                "gsrlimit": limit,
                "prop": "extracts|pageimages|coordinates|info",
                "exintro": True,
                "exsentences": 2,
                "explaintext": True,
                "piprop": "thumbnail",
                "pithumbsize": 200,
                "inprop": "url",
                "format": "json",
            },
        )
        if resp.status_code != 200:
            raise HTTPException(502, "Wikipedia API error")
        pages = resp.json().get("query", {}).get("pages", {})

    results = []
    for page in sorted(pages.values(), key=lambda p: p.get("index", 999)):
        coords = page.get("coordinates", [{}])
        coord = coords[0] if coords else {}
        results.append({
            "pageid": page.get("pageid"),
            "title": page.get("title", ""),
            "lat": coord.get("lat"),
            "lng": coord.get("lon"),
            "extract": page.get("extract", ""),
            "thumbnail": page.get("thumbnail", {}).get("source", ""),
            "url": page.get("fullurl", ""),
        })
    return {"articles": results}


# ── OSM Overpass API ──────

@router.get("/osm/nearby")
async def osm_nearby(
    lat: float = Query(...),
    lng: float = Query(...),
    radius: int = Query(1000, ge=100, le=10000, description="Radius in meters"),
    category: str = Query("all", description="POI category: all, food, tourism, transport, culture, nature, shop, health"),
    limit: int = Query(50, ge=1, le=200),
    _user: dict = Depends(get_current_user),
):
    """Find OSM points of interest near a location via Overpass API."""
    # Category filters mapped to OSM tags
    category_filters = {
        "all": '["name"]',
        "food": '["amenity"~"restaurant|cafe|bar|fast_food|pub|ice_cream"]',
        "tourism": '["tourism"~"hotel|museum|attraction|viewpoint|artwork|information|gallery"]',
        "transport": '["amenity"~"bus_station|parking|fuel"]["name"]',
        "culture": '["amenity"~"theatre|cinema|library|arts_centre|place_of_worship"]["name"]',
        "nature": '["leisure"~"park|garden|nature_reserve"]["name"]',
        "shop": '["shop"]["name"]',
        "health": '["amenity"~"hospital|clinic|pharmacy|doctors"]["name"]',
        "historic": '["historic"]["name"]',
    }

    tag_filter = category_filters.get(category, category_filters["all"])
    query = f"""
    [out:json][timeout:10];
    (
      node{tag_filter}(around:{radius},{lat},{lng});
      way{tag_filter}(around:{radius},{lat},{lng});
    );
    out center body {limit};
    """

    async with httpx.AsyncClient(timeout=15, headers=HEADERS) as client:
        resp = await client.post(
            "https://overpass-api.de/api/interpreter",
            data={"data": query},
        )
        if resp.status_code != 200:
            raise HTTPException(502, f"Overpass API error: {resp.status_code}")
        data = resp.json()

    features = []
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        # Get coordinates (node directly, way via center)
        if el["type"] == "node":
            elat, elng = el["lat"], el["lon"]
        elif "center" in el:
            elat, elng = el["center"]["lat"], el["center"]["lon"]
        else:
            continue

        name = tags.get("name", "")
        if not name:
            continue

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [elng, elat]},
            "properties": {
                "osm_id": el["id"],
                "osm_type": el["type"],
                "name": name,
                "category": tags.get("amenity") or tags.get("tourism") or tags.get("historic") or tags.get("shop") or tags.get("leisure") or "",
                "address": tags.get("addr:street", ""),
                "housenumber": tags.get("addr:housenumber", ""),
                "phone": tags.get("phone", ""),
                "website": tags.get("website", ""),
                "opening_hours": tags.get("opening_hours", ""),
                "wikipedia": tags.get("wikipedia", ""),
                "wikidata": tags.get("wikidata", ""),
            },
        })

    return {
        "type": "FeatureCollection",
        "features": features,
    }


@router.post("/osm/custom-query")
async def osm_custom_query(
    body: dict,
    _user: dict = Depends(get_current_user),
):
    """Execute a custom Overpass QL query. Body: {"query": "...", "format": "geojson"}"""
    overpass_query = body.get("query", "")
    if not overpass_query:
        raise HTTPException(400, "Query is required")

    # Safety: limit timeout
    if "[timeout:" not in overpass_query:
        overpass_query = "[timeout:15]" + overpass_query

    async with httpx.AsyncClient(timeout=20, headers=HEADERS) as client:
        resp = await client.post(
            "https://overpass-api.de/api/interpreter",
            data={"data": overpass_query},
        )
        if resp.status_code != 200:
            raise HTTPException(502, f"Overpass error: {resp.text[:300]}")
        data = resp.json()

    # Convert to GeoJSON
    features = []
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        if el["type"] == "node":
            geom = {"type": "Point", "coordinates": [el["lon"], el["lat"]]}
        elif el["type"] == "way" and "center" in el:
            geom = {"type": "Point", "coordinates": [el["center"]["lon"], el["center"]["lat"]]}
        else:
            continue

        features.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {**tags, "osm_id": el["id"], "osm_type": el["type"]},
        })

    return {"type": "FeatureCollection", "features": features}


# ── Nominatim Geocoding ──────

@router.get("/geocode")
async def geocode(
    q: str = Query(..., min_length=2, description="Search text"),
    limit: int = Query(5, ge=1, le=10),
    lang: str = Query("it"),
):
    """Geocode an address or place name using Nominatim. No auth required."""
    async with httpx.AsyncClient(timeout=10, headers=HEADERS) as client:
        resp = await client.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": q,
                "format": "json",
                "limit": limit,
                "accept-language": lang,
                "addressdetails": 1,
            },
        )
        if resp.status_code != 200:
            raise HTTPException(502, "Nominatim error")
        return resp.json()


@router.get("/reverse-geocode")
async def reverse_geocode(
    lat: float = Query(...),
    lng: float = Query(...),
    lang: str = Query("it"),
):
    """Reverse geocode a coordinate to an address."""
    async with httpx.AsyncClient(timeout=10, headers=HEADERS) as client:
        resp = await client.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={
                "lat": lat,
                "lon": lng,
                "format": "json",
                "accept-language": lang,
                "addressdetails": 1,
            },
        )
        if resp.status_code != 200:
            raise HTTPException(502, "Nominatim error")
        return resp.json()
