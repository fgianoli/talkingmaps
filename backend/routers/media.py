import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db
from core.security import get_current_user, require_editor
from core.config import settings

router = APIRouter()

ALLOWED_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
    "video/mp4", "video/webm",
    "audio/mpeg", "audio/ogg", "audio/wav",
    "application/pdf",
}


@router.get("/")
async def list_media(
    story_id: int | None = None,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = "SELECT id, filename, original_name, mime_type, file_size, file_path, thumbnail_path, width, height, story_id, created_at FROM media"
    params = {}
    if story_id is not None:
        q += " WHERE story_id = :sid"
        params["sid"] = story_id
    elif user["role"] != "admin":
        q += " WHERE owner_id = :uid"
        params["uid"] = user["id"]
    q += " ORDER BY created_at DESC"
    result = await db.execute(text(q), params)
    return [dict(r) for r in result.mappings().all()]


@router.post("/upload")
async def upload_media(
    file: UploadFile = File(...),
    story_id: int | None = Form(None),
    user: dict = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail=f"Tipo file non supportato: {file.content_type}")

    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File troppo grande (max {settings.MAX_UPLOAD_SIZE_MB}MB)")

    ext = os.path.splitext(file.filename)[1].lower() if file.filename else ""
    filename = f"{uuid.uuid4().hex}{ext}"

    # Determine subdirectory based on type
    if file.content_type.startswith("image"):
        subdir = "media/images"
    elif file.content_type.startswith("video"):
        subdir = "media/videos"
    elif file.content_type.startswith("audio"):
        subdir = "media/audio"
    else:
        subdir = "media/docs"

    dirpath = os.path.join(settings.UPLOAD_DIR, subdir)
    os.makedirs(dirpath, exist_ok=True)
    filepath = os.path.join(dirpath, filename)

    with open(filepath, "wb") as f:
        f.write(content)

    # Get image dimensions if applicable
    width, height = None, None
    thumbnail_path = None
    if file.content_type.startswith("image") and file.content_type != "image/svg+xml":
        try:
            from PIL import Image
            from io import BytesIO
            img = Image.open(BytesIO(content))
            width, height = img.size

            # Create thumbnail (max 400px)
            thumb_size = (400, 400)
            img.thumbnail(thumb_size, Image.LANCZOS)
            thumb_filename = f"thumb_{filename}"
            thumb_dir = os.path.join(settings.UPLOAD_DIR, "media/thumbnails")
            os.makedirs(thumb_dir, exist_ok=True)
            thumb_path = os.path.join(thumb_dir, thumb_filename)
            img.save(thumb_path, quality=85)
            thumbnail_path = f"/uploads/media/thumbnails/{thumb_filename}"
        except Exception:
            pass

    file_url = f"/uploads/{subdir}/{filename}"
    result = await db.execute(text(
        """INSERT INTO media (filename, original_name, mime_type, file_size, file_path, thumbnail_path, width, height, owner_id, story_id)
           VALUES (:fn, :orig, :mime, :size, :path, :thumb, :w, :h, :owner, :sid)
           RETURNING id"""
    ), {
        "fn": filename, "orig": file.filename, "mime": file.content_type,
        "size": len(content), "path": file_url, "thumb": thumbnail_path,
        "w": width, "h": height, "owner": user["id"], "sid": story_id,
    })
    media_id = result.fetchone()[0]
    await db.commit()

    return {
        "id": media_id,
        "url": file_url,
        "thumbnail": thumbnail_path,
        "filename": file.filename,
        "mime_type": file.content_type,
        "size": len(content),
        "width": width,
        "height": height,
    }


@router.delete("/{media_id}")
async def delete_media(media_id: int, user: dict = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("SELECT file_path, thumbnail_path FROM media WHERE id = :id"), {"id": media_id})
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Media non trovato")

    # Delete files from disk
    for path in [row[0], row[1]]:
        if path:
            full = os.path.join(settings.UPLOAD_DIR, path.lstrip("/uploads/"))
            if os.path.exists(full):
                os.remove(full)

    await db.execute(text("DELETE FROM media WHERE id = :id"), {"id": media_id})
    await db.commit()
    return {"detail": "Media eliminato"}
