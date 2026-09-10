"""Per-user Copernicus (CDSE) credentials.

CDSE meters usage against whoever makes the request, so credentials belong to a
person: each user registers their own OAuth client and TalkingMaps stores the
secret encrypted, the way AI provider keys are already stored.

There is deliberately no server-wide fallback. A shared pair would bill one
account for everyone's work, and one person exhausting the quota would stop the
service for the rest. A user without credentials simply has no Copernicus.
"""

import json

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.cdse import CATALOG_URL, CdseError, get_access_token
from core.database import get_system_db
from core.encryption import decrypt_api_key, encrypt_api_key
from core.security import get_current_user

router = APIRouter()

# Sent when the user wants the stored secret removed rather than replaced. Matches
# the convention already used by the AI settings endpoint.
CLEAR = "__CLEAR__"

# What a masked secret looks like coming back. A value starting with this is the
# placeholder being echoed back unchanged, not a new secret.
MASK = "••••"


class CdseSettingsUpdate(BaseModel):
    client_id: str = ""
    client_secret: str = ""


async def _load(db: AsyncSession, user_id: int) -> dict:
    result = await db.execute(
        text("SELECT cdse_settings FROM users WHERE id = :id"), {"id": user_id}
    )
    row = result.fetchone()
    return (row[0] if row and row[0] else {}) if row else {}


async def get_user_credentials(db: AsyncSession, user_id: int) -> tuple[str, str]:
    """The stored pair for one user, decrypted. Raises if they have none.

    Every CDSE request in the app goes through here, so that the account being
    charged is always the account of the person asking.
    """
    stored = await _load(db, user_id)
    client_id = stored.get("client_id", "")
    client_secret = decrypt_api_key(stored.get("client_secret", ""))
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=400,
            detail="Nessuna credenziale Copernicus configurata. Impostala nel tuo profilo.",
        )
    return client_id, client_secret


@router.get("/settings")
async def get_cdse_settings(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_system_db),
):
    """The user's own CDSE settings. The secret comes back masked, never in full."""
    stored = await _load(db, user["id"])
    client_id = stored.get("client_id", "")
    secret = decrypt_api_key(stored.get("client_secret", ""))

    return {
        # The client id identifies the OAuth client rather than authorising anything,
        # and seeing it in full is how a user tells which client is configured.
        "client_id": client_id,
        "client_id_set": bool(client_id),
        "client_secret": (MASK + secret[-4:]) if len(secret) > 4 else (MASK if secret else ""),
        "client_secret_set": bool(secret),
    }


@router.put("/settings")
async def update_cdse_settings(
    body: CdseSettingsUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_system_db),
):
    """Store the user's credentials. The secret is encrypted before it is written."""
    current = await _load(db, user["id"])
    new_settings = dict(current)

    client_id = (body.client_id or "").strip()
    if client_id == CLEAR:
        new_settings["client_id"] = ""
    elif client_id:
        new_settings["client_id"] = client_id

    secret = (body.client_secret or "").strip()
    if secret == CLEAR:
        new_settings["client_secret"] = ""
    elif secret and not secret.startswith(MASK):
        # A value that still starts with the mask is the placeholder coming back
        # unchanged from the form, which must not overwrite the real secret.
        new_settings["client_secret"] = encrypt_api_key(secret)

    await db.execute(
        text("UPDATE users SET cdse_settings = CAST(:s AS jsonb), updated_at = NOW() WHERE id = :id"),
        {"id": user["id"], "s": json.dumps(new_settings)},
    )
    await db.commit()
    return {"detail": "Credenziali Copernicus aggiornate"}


@router.post("/test")
async def test_cdse_credentials(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_system_db),
):
    """Spend a token on a real catalogue search.

    Getting a token proves the credentials parse; it does not prove they authorise
    anything. The two failures look identical until something is actually asked for,
    so this asks.
    """
    client_id, client_secret = await get_user_credentials(db, user["id"])

    try:
        token = await get_access_token(client_id, client_secret)
    except CdseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    body = {
        "collections": ["sentinel-2-l2a"],
        "datetime": "2024-06-01T00:00:00Z/2024-06-30T23:59:59Z",
        "bbox": [11.20, 44.44, 11.42, 44.56],
        "limit": 1,
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                CATALOG_URL, json=body, headers={"Authorization": f"Bearer {token}"}
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Catalogo CDSE non raggiungibile: {exc}") from exc

    if resp.status_code != 200:
        raise HTTPException(
            status_code=400,
            detail=f"Il catalogo CDSE ha risposto {resp.status_code}. Le credenziali non autorizzano la ricerca.",
        )

    found = len(resp.json().get("features", []))
    return {"detail": "Credenziali valide: il catalogo ha risposto.", "scenes_found": found}
