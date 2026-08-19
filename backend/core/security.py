import jwt
import bcrypt
import redis.asyncio as aioredis
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from core.config import settings

security_scheme = HTTPBearer()
security_scheme_optional = HTTPBearer(auto_error=False)

_redis: aioredis.Redis | None = None
_revoked_tokens: set[str] = set()


async def get_redis() -> aioredis.Redis | None:
    global _redis
    if _redis is None:
        try:
            _redis = aioredis.from_url(settings.REDIS_URL)
            await _redis.ping()
        except Exception:
            _redis = None
    return _redis


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_token(user_id: int, username: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "jti": str(uuid4()),
        "iat": now,
        "exp": now + timedelta(minutes=settings.JWT_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


async def revoke_token(token: str):
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        jti = payload.get("jti", "")
        ttl = int(payload.get("exp", 0) - datetime.now(timezone.utc).timestamp())
        r = await get_redis()
        if r and ttl > 0:
            await r.setex(f"revoked:{jti}", ttl, "1")
        _revoked_tokens.add(jti)
    except Exception:
        pass


async def is_token_revoked(jti: str) -> bool:
    if jti in _revoked_tokens:
        return True
    r = await get_redis()
    if r:
        return await r.exists(f"revoked:{jti}") > 0
    return False


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security_scheme),
) -> dict:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token scaduto")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token non valido")

    jti = payload.get("jti", "")
    if await is_token_revoked(jti):
        raise HTTPException(status_code=401, detail="Token revocato")

    return {
        "id": int(payload["sub"]),
        "username": payload["username"],
        "role": payload["role"],
        "token": token,
    }


async def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(security_scheme_optional),
) -> dict | None:
    """Like get_current_user, but anonymous callers get None instead of a 401.

    For endpoints that serve public content yet must widen access for the owner:
    the endpoint decides what an anonymous caller may see.
    """
    if credentials is None:
        return None
    try:
        return await get_current_user(credentials)
    except HTTPException:
        return None


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Solo gli admin possono eseguire questa operazione")
    return user


async def require_editor(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] not in ("admin", "editor"):
        raise HTTPException(status_code=403, detail="Permessi insufficienti")
    return user
