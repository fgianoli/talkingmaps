from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db, get_system_db
from core.security import hash_password, require_admin, get_current_user

router = APIRouter()


class UserCreate(BaseModel):
    username: str
    password: str
    display_name: str | None = None
    email: str | None = None
    role: str = "editor"


@router.get("/search")
async def search_users(
    q: str = Query(..., min_length=2, max_length=100),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_system_db),
):
    """Search users by username, display_name or email. For sharing features."""
    result = await db.execute(text(
        "SELECT id, username, display_name, email, avatar FROM users "
        "WHERE active = TRUE AND id != :me AND "
        "(username ILIKE :q OR display_name ILIKE :q OR email ILIKE :q) "
        "ORDER BY username LIMIT 10"
    ), {"q": f"%{q}%", "me": user["id"]})
    return [dict(r) for r in result.mappings().all()]


@router.get("/")
async def list_users(user: dict = Depends(require_admin), db: AsyncSession = Depends(get_system_db)):
    result = await db.execute(text(
        "SELECT id, username, display_name, email, role, active, created_at FROM users ORDER BY id"
    ))
    return [dict(r) for r in result.mappings().all()]


@router.post("/")
async def create_user(req: UserCreate, user: dict = Depends(require_admin), db: AsyncSession = Depends(get_system_db)):
    if req.role not in ("admin", "editor", "viewer"):
        raise HTTPException(status_code=400, detail="Ruolo non valido")
    existing = await db.execute(text("SELECT id FROM users WHERE username = :u"), {"u": req.username})
    if existing.fetchone():
        raise HTTPException(status_code=409, detail="Username già in uso")
    pw = hash_password(req.password)
    result = await db.execute(
        text("INSERT INTO users (username, password_hash, display_name, email, role) VALUES (:u, :p, :d, :e, :r) RETURNING id"),
        {"u": req.username, "p": pw, "d": req.display_name, "e": req.email, "r": req.role},
    )
    await db.commit()
    new_id = result.fetchone()[0]
    return {"id": new_id, "username": req.username, "role": req.role}


@router.put("/{user_id}/toggle")
async def toggle_user(user_id: int, user: dict = Depends(require_admin), db: AsyncSession = Depends(get_system_db)):
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Non puoi disabilitare te stesso")
    result = await db.execute(text("UPDATE users SET active = NOT active, updated_at = NOW() WHERE id = :id RETURNING active"), {"id": user_id})
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    await db.commit()
    return {"id": user_id, "active": row[0]}


@router.put("/{user_id}/reset-password")
async def admin_reset_password(user_id: int, body: dict, user: dict = Depends(require_admin), db: AsyncSession = Depends(get_system_db)):
    new_password = body.get("password", "")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password troppo corta (min 6 caratteri)")
    pw = hash_password(new_password)
    result = await db.execute(text("UPDATE users SET password_hash = :p, updated_at = NOW() WHERE id = :id RETURNING id"), {"p": pw, "id": user_id})
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Utente non trovato")
    await db.commit()
    return {"detail": "Password resettata"}
