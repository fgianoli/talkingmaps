from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_system_db
from core.security import get_current_user

router = APIRouter()

@router.get("/")
async def list_settings(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_system_db)):
    if user["role"] != "admin":
        raise HTTPException(403, "Solo admin")
    result = await db.execute(text("SELECT key, value, description FROM system_settings ORDER BY key"))
    return [dict(r) for r in result.mappings().all()]

@router.put("/{key}")
async def update_setting(key: str, body: dict, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_system_db)):
    if user["role"] != "admin":
        raise HTTPException(403, "Solo admin")
    await db.execute(text("UPDATE system_settings SET value = :val, updated_at = NOW() WHERE key = :key"), {"key": key, "val": body.get("value", "")})
    await db.commit()
    return {"detail": "Impostazione aggiornata"}
