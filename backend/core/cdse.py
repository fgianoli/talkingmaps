"""Access to the Copernicus Data Space Ecosystem (CDSE).

CDSE speaks OAuth2 client credentials: an application exchanges a client id and
secret for an access token that lives only a few minutes, then repeats. Nothing
else in TalkingMaps talks to an upstream that expires, so the token cache lives
here rather than in the proxy that will use it.

Credentials belong to a person, not to the server. Each user registers their own
OAuth client in the CDSE dashboard and TalkingMaps stores the secret encrypted,
the same way it already stores AI keys. The environment variables read here are a
development fallback so the flow can be exercised without the per-user UI in
place; a deployment is expected to leave them empty.
"""

import logging
import time

import httpx

from core.config import settings

logger = logging.getLogger(__name__)

TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"

# Sentinel Hub services hosted inside CDSE: rendering and the STAC catalogue.
SENTINEL_HUB_BASE = "https://sh.dataspace.copernicus.eu"
CATALOG_URL = f"{SENTINEL_HUB_BASE}/api/v1/catalog/1.0.0/search"
PROCESS_URL = f"{SENTINEL_HUB_BASE}/api/v1/process"

# Ask for a new token slightly before the current one lapses, so a request never
# leaves with a token that expires while it is in flight.
_EXPIRY_MARGIN_SECONDS = 60

# Keyed by client id. Values are (token, expires_at). The secret is never stored.
_token_cache: dict[str, tuple[str, float]] = {}


class CdseError(RuntimeError):
    """Raised when CDSE refuses a request. The message is safe to show a user."""


def _cache_get(client_id: str) -> str | None:
    entry = _token_cache.get(client_id)
    if not entry:
        return None
    token, expires_at = entry
    if time.monotonic() >= expires_at - _EXPIRY_MARGIN_SECONDS:
        _token_cache.pop(client_id, None)
        return None
    return token


async def get_access_token(client_id: str, client_secret: str) -> str:
    """Exchange client credentials for an access token, reusing a live one.

    Raises CdseError with a message meant for the user — never one containing the
    secret, which would otherwise reach a log or an API response.
    """
    if not client_id or not client_secret:
        raise CdseError("Credenziali CDSE mancanti. Impostale nel tuo profilo.")

    cached = _cache_get(client_id)
    if cached:
        return cached

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                TOKEN_URL,
                data={
                    "grant_type": "client_credentials",
                    "client_id": client_id,
                    "client_secret": client_secret,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
    except httpx.TimeoutException as exc:
        raise CdseError("CDSE non ha risposto entro il tempo limite.") from exc
    except httpx.HTTPError as exc:
        # str(exc) on a request error carries the URL, never the form body
        raise CdseError(f"Impossibile contattare CDSE: {exc}") from exc

    if resp.status_code == 401:
        raise CdseError("Credenziali CDSE rifiutate. Controlla client id e secret.")
    if resp.status_code != 200:
        # The body of a failed token request echoes the grant type and error code,
        # not the secret, but it is still upstream text: log it, do not return it.
        logger.warning("CDSE token request failed: %s %s", resp.status_code, resp.text[:200])
        raise CdseError(f"CDSE ha risposto {resp.status_code} alla richiesta di token.")

    payload = resp.json()
    token = payload.get("access_token")
    if not token:
        raise CdseError("CDSE ha risposto senza access token.")

    expires_in = payload.get("expires_in")
    try:
        lifetime = float(expires_in)
    except (TypeError, ValueError):
        lifetime = 600.0
    _token_cache[client_id] = (token, time.monotonic() + lifetime)

    return token


def forget_token(client_id: str) -> None:
    """Drop a cached token — call when a user changes or removes their credentials."""
    _token_cache.pop(client_id, None)


def dev_credentials() -> tuple[str, str]:
    """The development fallback pair, empty unless set in the environment."""
    return (
        getattr(settings, "CDSE_CLIENT_ID", "") or "",
        getattr(settings, "CDSE_CLIENT_SECRET", "") or "",
    )
