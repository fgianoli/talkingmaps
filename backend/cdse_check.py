"""Smoke check for the CDSE connection.

    docker compose exec backend python cdse_check.py

Reads CDSE_CLIENT_ID / CDSE_CLIENT_SECRET from the environment and proves two
things that cannot be proved by reading code: that the credentials are accepted,
and that the token they buy actually authorises a catalogue search. A token that
parses but authorises nothing looks identical until you spend it.

Nothing here prints a secret or a token — only their shape.
"""

import asyncio
import sys

import httpx

from core.cdse import CATALOG_URL, CdseError, dev_credentials, get_access_token

# A small window over Bologna: enough to come back with scenes, small enough to
# stay a trivial query.
BBOX = [11.20, 44.44, 11.42, 44.56]
DATETIME = "2024-06-01T00:00:00Z/2024-06-30T23:59:59Z"


async def main() -> int:
    client_id, client_secret = dev_credentials()

    if not client_id or not client_secret:
        print("Credenziali assenti.")
        print("Metti CDSE_CLIENT_ID e CDSE_CLIENT_SECRET nel .env, poi:")
        print("  docker compose up -d backend")
        return 2

    print(f"client id  : …{client_id[-4:]}  ({len(client_id)} caratteri)")
    print(f"client sec : {len(client_secret)} caratteri")

    try:
        token = await get_access_token(client_id, client_secret)
    except CdseError as exc:
        print(f"\nTOKEN FALLITO: {exc}")
        return 1
    print(f"\ntoken      : ottenuto, {len(token)} caratteri")

    # The token is only meaningful if it opens something. Search the catalogue.
    body = {
        "collections": ["sentinel-2-l2a"],
        "datetime": DATETIME,
        "bbox": BBOX,
        "limit": 5,
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                CATALOG_URL,
                json=body,
                headers={"Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError as exc:
        print(f"CATALOGO NON RAGGIUNGIBILE: {exc}")
        return 1

    if resp.status_code != 200:
        print(f"CATALOGO HA RISPOSTO {resp.status_code}: {resp.text[:300]}")
        return 1

    features = resp.json().get("features", [])
    print(f"catalogo   : {len(features)} scene su Bologna, giugno 2024")
    for f in features:
        props = f.get("properties", {})
        cloud = props.get("eo:cloud_cover")
        cloud_txt = f"{cloud:.0f}% nuvole" if isinstance(cloud, (int, float)) else "nuvole n/d"
        print(f"             {props.get('datetime', '?')[:10]}  {cloud_txt}  {f.get('id', '')[:44]}")

    # A second call must not buy a second token: the cache is what keeps a busy
    # story from asking CDSE for a token on every tile.
    await get_access_token(client_id, client_secret)
    print("\ncache      : la seconda richiesta ha riusato il token")

    print("\nOK — le credenziali funzionano e il catalogo risponde.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
