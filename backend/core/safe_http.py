"""Redirect-aware fetching for the service proxies.

httpx's ``follow_redirects=True`` re-issues the request against the new target
without asking anyone whether *that* target is allowed. An allow-listed host can
therefore answer ``302 Location: http://169.254.169.254/...`` and walk the proxy
straight past the SSRF guard that was checked once, up front.

``fetch_validated`` follows redirects itself and re-runs the caller's validator
on every hop, so the guard applies to the URL actually requested.
"""

import httpx
from fastapi import HTTPException

MAX_REDIRECTS = 3
_REDIRECT_STATUSES = (301, 302, 303, 307, 308)


async def fetch_validated(client: httpx.AsyncClient, url: str, validator, **kwargs):
    """GET ``url``, following redirects only to targets ``validator`` accepts.

    The client must be built with ``follow_redirects=False``; this walks the chain.
    ``validator`` takes a URL and returns a bool, or an awaitable of one.
    """
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        allowed = validator(current)
        if hasattr(allowed, "__await__"):
            allowed = await allowed
        if not allowed:
            raise HTTPException(status_code=403, detail="Host non consentito")

        resp = await client.get(current, **kwargs)
        if resp.status_code not in _REDIRECT_STATUSES:
            return resp

        location = resp.headers.get("location")
        if not location:
            return resp
        # Resolve relative redirects against the URL we actually requested
        current = str(httpx.URL(current).join(location))

    raise HTTPException(status_code=502, detail="Troppi redirect dal servizio remoto")
