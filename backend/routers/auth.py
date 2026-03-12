from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db
from core.security import (
    verify_password, hash_password, create_token, revoke_token, get_current_user,
)

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/login")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("SELECT id, username, password_hash, role, display_name, active FROM users WHERE username = :u"),
        {"u": req.username},
    )
    user = result.mappings().fetchone()
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenziali non valide")
    if not user["active"]:
        raise HTTPException(status_code=403, detail="Account disabilitato")

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


@router.post("/logout")
async def logout(user: dict = Depends(get_current_user)):
    await revoke_token(user["token"])
    return {"detail": "Logout effettuato"}


@router.get("/me")
async def me(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("SELECT id, username, display_name, email, role, created_at FROM users WHERE id = :id"),
        {"id": user["id"]},
    )
    row = result.mappings().fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    return dict(row)


@router.put("/change-password")
async def change_password(req: ChangePasswordRequest, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("SELECT password_hash FROM users WHERE id = :id"), {"id": user["id"]})
    row = result.fetchone()
    if not row or not verify_password(req.current_password, row[0]):
        raise HTTPException(status_code=400, detail="Password attuale non corretta")
    new_hash = hash_password(req.new_password)
    await db.execute(text("UPDATE users SET password_hash = :p, updated_at = NOW() WHERE id = :id"), {"p": new_hash, "id": user["id"]})
    await db.commit()
    return {"detail": "Password aggiornata"}
