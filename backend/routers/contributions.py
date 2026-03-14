import os
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db, get_system_db
from core.security import get_current_user, require_admin
from core.config import settings

router = APIRouter()

# Optional auth scheme — allows public endpoints to optionally read user info
optional_security = HTTPBearer(auto_error=False)

ALLOWED_MEDIA_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "video/mp4", "video/webm",
    "audio/mpeg", "audio/ogg", "audio/wav",
}


class ContributionCreate(BaseModel):
    title: str
    description: Optional[str] = None
    category: Optional[str] = None
    lng: float
    lat: float


class ContributionModerate(BaseModel):
    status: str  # 'approved' or 'rejected'
    admin_note: Optional[str] = None


async def _get_upload_limit_mb(system_db: AsyncSession) -> int:
    """Get participatory upload limit from system settings, default 10MB."""
    result = await system_db.execute(
        text("SELECT value FROM system_settings WHERE key = 'participatory_upload_limit_mb'")
    )
    row = result.fetchone()
    if row:
        try:
            return int(row[0])
        except (ValueError, TypeError):
            pass
    return 10


async def _check_story_owner_or_admin(db: AsyncSession, story_id: int, user: dict) -> bool:
    """Check if user is the story owner or an admin."""
    if user["role"] == "admin":
        return True
    result = await db.execute(
        text("SELECT author_id FROM stories WHERE id = :sid"),
        {"sid": story_id},
    )
    row = result.fetchone()
    if not row:
        return False
    return row[0] == user["id"]


async def _enrich_author_names(contributions: list[dict], system_db: AsyncSession) -> list[dict]:
    """Enrich contributions with author display_name from system DB."""
    author_ids = list({c["author_id"] for c in contributions if c.get("author_id")})
    if not author_ids:
        return contributions
    result = await system_db.execute(
        text("SELECT id, display_name FROM users WHERE id = ANY(:ids)"),
        {"ids": author_ids},
    )
    names_map = {r["id"]: r["display_name"] for r in result.mappings().all()}
    for c in contributions:
        if c.get("author_id") and c["author_id"] in names_map:
            c["author_display_name"] = names_map[c["author_id"]]
        else:
            c["author_display_name"] = c.get("author_name") or None
    return contributions


# ── 1. GET /story/{story_id} — Public: list approved contributions ──

@router.get("/story/{story_id}")
async def list_approved_contributions(
    story_id: int,
    db: AsyncSession = Depends(get_db),
    system_db: AsyncSession = Depends(get_system_db),
):
    """List approved contributions for a story (public, no auth needed)."""
    # Verify story exists
    story_check = await db.execute(
        text("SELECT id FROM stories WHERE id = :sid"), {"sid": story_id}
    )
    if not story_check.fetchone():
        raise HTTPException(status_code=404, detail="Storia non trovata")

    result = await db.execute(text(
        """SELECT id, story_id, author_id, author_name, title, description,
                  category, media_url, media_type, thumbnail_url, status,
                  ST_X(geom) as lng, ST_Y(geom) as lat, created_at
           FROM contributions
           WHERE story_id = :sid AND status = 'approved'
           ORDER BY created_at DESC"""
    ), {"sid": story_id})
    contributions = [dict(r) for r in result.mappings().all()]

    contributions = await _enrich_author_names(contributions, system_db)
    return contributions


# ── 2. POST /story/{story_id} — Add a contribution (requires login) ──

@router.post("/story/{story_id}")
async def create_contribution(
    story_id: int,
    title: str = Form(...),
    lng: float = Form(...),
    lat: float = Form(...),
    description: Optional[str] = Form(None),
    category: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    system_db: AsyncSession = Depends(get_system_db),
):
    """Add a geolocated contribution to a participatory story. Requires login."""
    # Check story exists and has participatory mode enabled
    story_check = await db.execute(text(
        "SELECT id, settings FROM stories WHERE id = :sid"
    ), {"sid": story_id})
    story_row = story_check.mappings().fetchone()
    if not story_row:
        raise HTTPException(status_code=404, detail="Storia non trovata")

    story_settings = story_row["settings"] or {}
    if isinstance(story_settings, str):
        import json
        story_settings = json.loads(story_settings)
    if story_settings.get("participatory_enabled") != True and str(story_settings.get("participatory_enabled", "")).lower() != "true":
        raise HTTPException(status_code=403, detail="La modalità partecipativa non è attiva per questa storia")

    # Handle optional file upload
    media_url = None
    media_type = None
    thumbnail_url = None

    if file and file.filename:
        if file.content_type not in ALLOWED_MEDIA_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"Tipo file non supportato: {file.content_type}. Tipi consentiti: immagini, video, audio",
            )

        content = await file.read()

        # Check size against system setting
        upload_limit_mb = await _get_upload_limit_mb(system_db)
        if len(content) > upload_limit_mb * 1024 * 1024:
            raise HTTPException(
                status_code=400,
                detail=f"File troppo grande (max {upload_limit_mb}MB)",
            )

        ext = os.path.splitext(file.filename)[1].lower() if file.filename else ""
        filename = f"{uuid.uuid4().hex}{ext}"

        # Determine subdirectory based on content type
        if file.content_type.startswith("image"):
            subdir = "media/images"
            media_type = "image"
        elif file.content_type.startswith("video"):
            subdir = "media/videos"
            media_type = "video"
        elif file.content_type.startswith("audio"):
            subdir = "media/audio"
            media_type = "audio"
        else:
            subdir = "media/docs"

        dirpath = os.path.join(settings.UPLOAD_DIR, subdir)
        os.makedirs(dirpath, exist_ok=True)
        filepath = os.path.join(dirpath, filename)

        with open(filepath, "wb") as f:
            f.write(content)

        media_url = f"/uploads/{subdir}/{filename}"

        # Generate thumbnail for images
        if file.content_type.startswith("image"):
            try:
                from PIL import Image
                from io import BytesIO

                img = Image.open(BytesIO(content))
                thumb_size = (400, 400)
                img.thumbnail(thumb_size, Image.LANCZOS)
                thumb_filename = f"thumb_{filename}"
                thumb_dir = os.path.join(settings.UPLOAD_DIR, "media/thumbnails")
                os.makedirs(thumb_dir, exist_ok=True)
                thumb_path = os.path.join(thumb_dir, thumb_filename)
                img.save(thumb_path, quality=85)
                thumbnail_url = f"/uploads/media/thumbnails/{thumb_filename}"
            except Exception:
                pass

    # Get author display name from system DB
    author_name = user.get("username", "")
    try:
        name_result = await system_db.execute(
            text("SELECT display_name FROM users WHERE id = :uid"),
            {"uid": user["id"]},
        )
        name_row = name_result.fetchone()
        if name_row and name_row[0]:
            author_name = name_row[0]
    except Exception:
        pass

    # Insert contribution
    result = await db.execute(text(
        """INSERT INTO contributions
           (story_id, author_id, author_name, geom, title, description, category,
            media_url, media_type, thumbnail_url, status)
           VALUES (:sid, :author_id, :author_name,
                   ST_SetSRID(ST_MakePoint(:lng, :lat), 4326),
                   :title, :description, :category,
                   :media_url, :media_type, :thumbnail_url, 'pending')
           RETURNING id, created_at"""
    ), {
        "sid": story_id,
        "author_id": user["id"],
        "author_name": author_name,
        "lng": lng,
        "lat": lat,
        "title": title,
        "description": description,
        "category": category,
        "media_url": media_url,
        "media_type": media_type,
        "thumbnail_url": thumbnail_url,
    })
    row = result.mappings().fetchone()
    await db.commit()

    return {
        "id": row["id"],
        "story_id": story_id,
        "title": title,
        "description": description,
        "category": category,
        "lng": lng,
        "lat": lat,
        "media_url": media_url,
        "media_type": media_type,
        "thumbnail_url": thumbnail_url,
        "status": "pending",
        "author_name": author_name,
        "created_at": row["created_at"],
    }


# ── 3. GET /story/{story_id}/all — All contributions for moderation ──

@router.get("/story/{story_id}/all")
async def list_all_contributions(
    story_id: int,
    status: Optional[str] = None,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    system_db: AsyncSession = Depends(get_system_db),
):
    """List ALL contributions for a story (for moderation). Requires story owner or admin."""
    is_authorized = await _check_story_owner_or_admin(db, story_id, user)
    if not is_authorized:
        raise HTTPException(status_code=403, detail="Non autorizzato. Solo il proprietario della storia o un admin può moderare.")

    q = """SELECT id, story_id, author_id, author_name, title, description,
                  category, media_url, media_type, thumbnail_url, status, admin_note,
                  ST_X(geom) as lng, ST_Y(geom) as lat, created_at
           FROM contributions
           WHERE story_id = :sid"""
    params: dict = {"sid": story_id}

    if status:
        q += " AND status = :status"
        params["status"] = status

    q += " ORDER BY created_at DESC"

    result = await db.execute(text(q), params)
    contributions = [dict(r) for r in result.mappings().all()]

    contributions = await _enrich_author_names(contributions, system_db)
    return contributions


# ── 4. PUT /{contribution_id}/status — Moderate a contribution ──

@router.put("/{contribution_id}/status")
async def moderate_contribution(
    contribution_id: int,
    req: ContributionModerate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Approve or reject a contribution. Requires story owner or admin."""
    if req.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Stato non valido. Usa 'approved' o 'rejected'.")

    # Get contribution and check story ownership
    contrib_result = await db.execute(
        text("SELECT story_id FROM contributions WHERE id = :cid"),
        {"cid": contribution_id},
    )
    contrib_row = contrib_result.fetchone()
    if not contrib_row:
        raise HTTPException(status_code=404, detail="Contributo non trovato")

    story_id = contrib_row[0]
    is_authorized = await _check_story_owner_or_admin(db, story_id, user)
    if not is_authorized:
        raise HTTPException(status_code=403, detail="Non autorizzato a moderare questo contributo")

    await db.execute(text(
        "UPDATE contributions SET status = :status, admin_note = :note WHERE id = :cid"
    ), {"status": req.status, "note": req.admin_note, "cid": contribution_id})
    await db.commit()

    return {"detail": f"Contributo {req.status}", "id": contribution_id, "status": req.status}


# ── 5. DELETE /{contribution_id} — Delete a contribution ──

@router.delete("/{contribution_id}")
async def delete_contribution(
    contribution_id: int,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a contribution. Allowed for admin, story owner, or contribution author."""
    # Get contribution details
    contrib_result = await db.execute(text(
        "SELECT id, story_id, author_id, media_url, thumbnail_url FROM contributions WHERE id = :cid"
    ), {"cid": contribution_id})
    contrib = contrib_result.mappings().fetchone()
    if not contrib:
        raise HTTPException(status_code=404, detail="Contributo non trovato")

    # Authorization: admin, story owner, or contribution author
    is_admin = user["role"] == "admin"
    is_author = contrib["author_id"] == user["id"]
    is_story_owner = False
    if not is_admin and not is_author:
        owner_result = await db.execute(
            text("SELECT author_id FROM stories WHERE id = :sid"),
            {"sid": contrib["story_id"]},
        )
        owner_row = owner_result.fetchone()
        if owner_row and owner_row[0] == user["id"]:
            is_story_owner = True

    if not (is_admin or is_author or is_story_owner):
        raise HTTPException(status_code=403, detail="Non autorizzato a eliminare questo contributo")

    # Delete media files from disk if present
    upload_root = os.path.normpath(settings.UPLOAD_DIR)
    for path in [contrib["media_url"], contrib["thumbnail_url"]]:
        if path:
            relative = path.replace("/uploads/", "", 1) if path.startswith("/uploads/") else path.lstrip("/")
            full = os.path.normpath(os.path.join(upload_root, relative))
            if not full.startswith(upload_root):
                continue  # path traversal attempt — skip
            if os.path.exists(full):
                os.remove(full)

    await db.execute(
        text("DELETE FROM contributions WHERE id = :cid"),
        {"cid": contribution_id},
    )
    await db.commit()

    return {"detail": "Contributo eliminato", "id": contribution_id}
