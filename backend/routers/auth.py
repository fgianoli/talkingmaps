import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db, get_system_db
from core.config import settings
from core.security import (
    verify_password, hash_password, create_token, revoke_token, get_current_user,
)

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    display_name: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class ProfileUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    email: Optional[str] = None


class GoogleLoginRequest(BaseModel):
    credential: str


@router.post("/login")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_system_db)):
    result = await db.execute(
        text("SELECT id, username, password_hash, role, display_name, active FROM users WHERE username = :u"),
        {"u": req.username},
    )
    user = result.mappings().fetchone()
    if not user or not user["password_hash"] or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user["active"]:
        raise HTTPException(status_code=403, detail="Account disabled")

    token = create_token(user["id"], user["username"], user["role"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "username": user["username"],
            "display_name": user["display_name"],
            "role": user["role"],
        },
    }


@router.post("/register")
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_system_db)):
    """Self-registration for new users."""
    import re
    # Validate username
    if not re.match(r'^[a-zA-Z0-9_]{3,50}$', req.username):
        raise HTTPException(status_code=400, detail="Username: solo lettere, numeri e underscore (3-50 caratteri)")
    # Validate email
    if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', req.email):
        raise HTTPException(status_code=400, detail="Email non valida")
    # Validate password
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="La password deve avere almeno 6 caratteri")

    # Check uniqueness
    existing = await db.execute(
        text("SELECT id FROM users WHERE username = :u OR email = :e"),
        {"u": req.username, "e": req.email},
    )
    if existing.fetchone():
        raise HTTPException(status_code=409, detail="Username o email già in uso")

    display_name = req.display_name or req.username
    pw_hash = hash_password(req.password)

    result = await db.execute(
        text("""INSERT INTO users (username, password_hash, display_name, email, role)
                VALUES (:u, :p, :d, :e, 'editor') RETURNING id"""),
        {"u": req.username, "p": pw_hash, "d": display_name, "e": req.email},
    )
    user_id = result.fetchone()[0]
    await db.commit()

    token = create_token(user_id, req.username, "editor")
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user_id,
            "username": req.username,
            "display_name": display_name,
            "role": "editor",
        },
    }


@router.post("/google")
async def google_login(req: GoogleLoginRequest, db: AsyncSession = Depends(get_system_db)):
    """Login/register via Google ID token."""
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=501, detail="Google Sign-In not configured")

    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as google_requests

        idinfo = id_token.verify_oauth2_token(
            req.credential,
            google_requests.Request(),
            settings.GOOGLE_CLIENT_ID,
        )
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid Google token: {e}")

    email = idinfo.get("email")
    name = idinfo.get("name", "")
    if not email:
        raise HTTPException(status_code=400, detail="Google account has no email")

    # Check if user exists by email
    result = await db.execute(
        text("SELECT id, username, role, display_name, active FROM users WHERE email = :e"),
        {"e": email},
    )
    user = result.mappings().fetchone()

    if user:
        # Existing user
        if not user["active"]:
            raise HTTPException(status_code=403, detail="Account disabled")
        token = create_token(user["id"], user["username"], user["role"])
        return {
            "access_token": token,
            "token_type": "bearer",
            "user": {
                "id": user["id"],
                "username": user["username"],
                "display_name": user["display_name"],
                "role": user["role"],
            },
        }
    else:
        # Auto-create new user with 'editor' role
        username = email.split("@")[0]
        # Ensure unique username
        existing = await db.execute(text("SELECT id FROM users WHERE username = :u"), {"u": username})
        if existing.fetchone():
            import uuid
            username = f"{username}_{uuid.uuid4().hex[:4]}"

        new_user = await db.execute(
            text("""INSERT INTO users (username, password_hash, display_name, email, role)
                    VALUES (:u, :p, :d, :e, 'editor') RETURNING id"""),
            {"u": username, "p": "", "d": name, "e": email},
        )
        user_id = new_user.fetchone()[0]
        await db.commit()

        token = create_token(user_id, username, "editor")
        return {
            "access_token": token,
            "token_type": "bearer",
            "user": {
                "id": user_id,
                "username": username,
                "display_name": name,
                "role": "editor",
            },
        }


@router.get("/google/url")
async def google_auth_url():
    """Return Google OAuth URL for redirect-based flow."""
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=501, detail="Google Sign-In not configured")
    return {"url": "", "client_id": settings.GOOGLE_CLIENT_ID}


@router.post("/logout")
async def logout(user: dict = Depends(get_current_user)):
    await revoke_token(user["token"])
    return {"detail": "Logged out"}


@router.get("/me")
async def me(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_system_db)):
    result = await db.execute(
        text("SELECT id, username, display_name, email, avatar, role, created_at, storage_used_mb, storage_limit_mb FROM users WHERE id = :id"),
        {"id": user["id"]},
    )
    row = result.mappings().fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return dict(row)


@router.put("/change-password")
async def change_password(req: ChangePasswordRequest, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_system_db)):
    result = await db.execute(text("SELECT password_hash FROM users WHERE id = :id"), {"id": user["id"]})
    row = result.fetchone()
    if not row or not row[0]:
        # Accounts created through OAuth have no password to compare against
        raise HTTPException(
            status_code=400,
            detail="Questo account accede tramite provider esterno e non ha una password",
        )
    if not verify_password(req.current_password, row[0]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    new_hash = hash_password(req.new_password)
    await db.execute(text("UPDATE users SET password_hash = :p, updated_at = NOW() WHERE id = :id"), {"p": new_hash, "id": user["id"]})
    await db.commit()
    return {"detail": "Password updated"}


@router.put("/profile")
async def update_profile(req: ProfileUpdateRequest, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_system_db)):
    updates = []
    params = {"id": user["id"]}
    if req.display_name is not None:
        updates.append("display_name = :display_name")
        params["display_name"] = req.display_name
    if req.email is not None:
        updates.append("email = :email")
        params["email"] = req.email
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updates.append("updated_at = NOW()")
    query = f"UPDATE users SET {', '.join(updates)} WHERE id = :id"
    await db.execute(text(query), params)
    await db.commit()
    return {"detail": "Profile updated"}


@router.post("/avatar")
async def upload_avatar(file: UploadFile = File(...), user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_system_db)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 5MB)")

    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(content))
        img = img.convert("RGB")
        img.thumbnail((200, 200), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        buf.seek(0)
        processed = buf.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    avatar_dir = os.path.join(settings.UPLOAD_DIR, "avatars")
    os.makedirs(avatar_dir, exist_ok=True)
    filename = f"{user['id']}.jpg"
    filepath = os.path.join(avatar_dir, filename)
    with open(filepath, "wb") as f:
        f.write(processed)

    avatar_url = f"/uploads/avatars/{filename}"
    await db.execute(
        text("UPDATE users SET avatar = :avatar, updated_at = NOW() WHERE id = :id"),
        {"avatar": avatar_url, "id": user["id"]},
    )
    await db.commit()
    return {"avatar": avatar_url}
