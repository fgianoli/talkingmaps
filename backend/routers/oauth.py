"""
TalkingMaps – OAuth Providers (Microsoft, GitHub)
Google OAuth is handled in auth.py; this module adds Microsoft and GitHub.
All providers share the same user lookup/creation logic via _find_or_create_user.
"""
import uuid
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_system_db
from core.config import settings
from core.security import create_token

router = APIRouter()


class OAuthCodeRequest(BaseModel):
    code: str
    redirect_uri: str = ""


def _validate_redirect_uri(uri: str):
    """Validate redirect_uri against ALLOWED_ORIGINS to prevent open redirect."""
    if not uri:
        return
    from urllib.parse import urlparse
    parsed = urlparse(uri)
    allowed = [o.strip() for o in (settings.ALLOWED_ORIGINS or "").split(",") if o.strip()]
    origin = f"{parsed.scheme}://{parsed.netloc}"
    if origin not in allowed:
        raise HTTPException(status_code=400, detail=f"redirect_uri non consentito: {origin}")


async def _find_or_create_user(db: AsyncSession, email: str, display_name: str, provider: str) -> dict:
    """Find existing user by email or create a new one. Returns user dict for token creation."""
    result = await db.execute(
        text("SELECT id, username, role, display_name, active FROM users WHERE email = :e"),
        {"e": email},
    )
    user = result.mappings().fetchone()

    if user:
        if not user["active"]:
            raise HTTPException(status_code=403, detail="Account disabled")
        # Update auth_provider if needed
        await db.execute(
            text("UPDATE users SET auth_provider = :p, updated_at = NOW() WHERE id = :id"),
            {"p": provider, "id": user["id"]},
        )
        await db.commit()
        return dict(user)

    # Create new user
    username = email.split("@")[0]
    existing = await db.execute(text("SELECT id FROM users WHERE username = :u"), {"u": username})
    if existing.fetchone():
        username = f"{username}_{uuid.uuid4().hex[:4]}"

    new_user = await db.execute(
        text("""INSERT INTO users (username, password_hash, display_name, email, role, auth_provider)
                VALUES (:u, '', :d, :e, 'editor', :p) RETURNING id"""),
        {"u": username, "d": display_name, "e": email, "p": provider},
    )
    user_id = new_user.fetchone()[0]
    await db.commit()

    return {"id": user_id, "username": username, "role": "editor", "display_name": display_name}


def _make_login_response(user: dict) -> dict:
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


# ── Microsoft OAuth2 ──────

@router.get("/microsoft/url")
async def microsoft_auth_url():
    """Return Microsoft OAuth authorization URL."""
    if not settings.MICROSOFT_CLIENT_ID:
        raise HTTPException(status_code=501, detail="Microsoft OAuth not configured")
    tenant = settings.MICROSOFT_TENANT_ID or "common"
    return {
        "client_id": settings.MICROSOFT_CLIENT_ID,
        "tenant": tenant,
        "url": f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
    }


@router.post("/microsoft")
async def microsoft_login(req: OAuthCodeRequest, db: AsyncSession = Depends(get_system_db)):
    """Exchange Microsoft authorization code for user info and login/register."""
    _validate_redirect_uri(req.redirect_uri)
    if not settings.MICROSOFT_CLIENT_ID or not settings.MICROSOFT_CLIENT_SECRET:
        raise HTTPException(status_code=501, detail="Microsoft OAuth not configured")

    tenant = settings.MICROSOFT_TENANT_ID or "common"

    # Exchange code for token
    async with httpx.AsyncClient(timeout=15) as client:
        token_resp = await client.post(
            f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
            data={
                "client_id": settings.MICROSOFT_CLIENT_ID,
                "client_secret": settings.MICROSOFT_CLIENT_SECRET,
                "code": req.code,
                "grant_type": "authorization_code",
                "redirect_uri": req.redirect_uri,
                "scope": "openid email profile",
            },
        )
        if token_resp.status_code != 200:
            print(f"[OAUTH] Microsoft token error: {token_resp.text[:300]}")
            raise HTTPException(401, "Autenticazione Microsoft fallita. Riprova.")
        tokens = token_resp.json()

        # Get user info from Microsoft Graph
        user_resp = await client.get(
            "https://graph.microsoft.com/v1.0/me",
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        if user_resp.status_code != 200:
            raise HTTPException(401, "Failed to fetch Microsoft user info")
        ms_user = user_resp.json()

    email = ms_user.get("mail") or ms_user.get("userPrincipalName")
    if not email:
        raise HTTPException(400, "Microsoft account has no email")

    display_name = ms_user.get("displayName", email.split("@")[0])
    user = await _find_or_create_user(db, email, display_name, "microsoft")
    return _make_login_response(user)


# ── GitHub OAuth2 ──────

@router.get("/github/url")
async def github_auth_url():
    """Return GitHub OAuth authorization URL."""
    if not settings.GITHUB_CLIENT_ID:
        raise HTTPException(status_code=501, detail="GitHub OAuth not configured")
    return {
        "client_id": settings.GITHUB_CLIENT_ID,
        "url": "https://github.com/login/oauth/authorize",
    }


@router.post("/github")
async def github_login(req: OAuthCodeRequest, db: AsyncSession = Depends(get_system_db)):
    _validate_redirect_uri(req.redirect_uri)
    """Exchange GitHub authorization code for user info and login/register."""
    if not settings.GITHUB_CLIENT_ID or not settings.GITHUB_CLIENT_SECRET:
        raise HTTPException(status_code=501, detail="GitHub OAuth not configured")

    async with httpx.AsyncClient(timeout=15) as client:
        # Exchange code for token
        token_resp = await client.post(
            "https://github.com/login/oauth/access_token",
            headers={"Accept": "application/json"},
            json={
                "client_id": settings.GITHUB_CLIENT_ID,
                "client_secret": settings.GITHUB_CLIENT_SECRET,
                "code": req.code,
                "redirect_uri": req.redirect_uri,
            },
        )
        if token_resp.status_code != 200:
            print(f"[OAUTH] GitHub token error: {token_resp.text[:300]}")
            raise HTTPException(401, "Autenticazione GitHub fallita. Riprova.")
        tokens = token_resp.json()
        access_token = tokens.get("access_token")
        if not access_token:
            print(f"[OAUTH] GitHub no access_token: {tokens.get('error_description', 'unknown')}")
            raise HTTPException(401, "Autenticazione GitHub fallita. Riprova.")

        # Get user info
        user_resp = await client.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
        if user_resp.status_code != 200:
            raise HTTPException(401, "Failed to fetch GitHub user info")
        gh_user = user_resp.json()

        # GitHub may not expose email publicly, fetch from /user/emails
        email = gh_user.get("email")
        if not email:
            emails_resp = await client.get(
                "https://api.github.com/user/emails",
                headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
            )
            if emails_resp.status_code == 200:
                for e in emails_resp.json():
                    if e.get("primary") and e.get("verified"):
                        email = e["email"]
                        break

    if not email:
        raise HTTPException(400, "GitHub account has no verified email. Please make your email public on GitHub or add a verified email.")

    display_name = gh_user.get("name") or gh_user.get("login", "")
    user = await _find_or_create_user(db, email, display_name, "github")
    return _make_login_response(user)


# ── Available providers (for frontend to know which buttons to show) ──────

@router.get("/providers")
async def list_oauth_providers():
    """List which OAuth providers are configured."""
    return {
        "google": bool(settings.GOOGLE_CLIENT_ID),
        "microsoft": bool(settings.MICROSOFT_CLIENT_ID),
        "github": bool(settings.GITHUB_CLIENT_ID),
    }
