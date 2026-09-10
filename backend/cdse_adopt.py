"""Move the CDSE credentials out of the environment and onto a user account.

    docker compose exec backend python cdse_adopt.py <username>

The environment pair was only ever a development fallback: it belongs to the
server rather than to a person, and CDSE bills whoever makes the request. This
takes what is in CDSE_CLIENT_ID / CDSE_CLIENT_SECRET, checks it still works,
stores it encrypted against one user, and then tells you to delete it from .env.

Prints no secret and no token — only what it did.
"""

import asyncio
import json
import sys

from sqlalchemy import text

from core.cdse import CdseError, dev_credentials, get_access_token
from core.database import engine_system
from core.encryption import encrypt_api_key


async def main(username: str) -> int:
    client_id, client_secret = dev_credentials()
    if not client_id or not client_secret:
        print("Nessuna credenziale nell'ambiente: CDSE_CLIENT_ID e CDSE_CLIENT_SECRET sono vuote.")
        print("Non c'è niente da spostare.")
        return 2

    print(f"trovate nell'ambiente: client id …{client_id[-4:]}")

    # Storing a pair that no longer works would leave the user with credentials that
    # fail later, at a point where the cause is much harder to see.
    try:
        await get_access_token(client_id, client_secret)
    except CdseError as exc:
        print(f"\nLe credenziali nell'ambiente non funzionano: {exc}")
        print("Non le associo a nessun utente.")
        return 1
    print("verificate: CDSE le accetta")

    async with engine_system.begin() as conn:
        result = await conn.execute(
            text("SELECT id, display_name, cdse_settings FROM users WHERE username = :u"),
            {"u": username},
        )
        row = result.mappings().fetchone()
        if not row:
            print(f"\nUtente '{username}' non trovato.")
            return 1

        existing = row["cdse_settings"] or {}
        if existing.get("client_secret"):
            print(f"\n'{username}' ha già credenziali Copernicus salvate.")
            print("Le sovrascrivo con quelle dell'ambiente.")

        await conn.execute(
            text("UPDATE users SET cdse_settings = CAST(:s AS jsonb), updated_at = NOW() WHERE id = :id"),
            {
                "id": row["id"],
                "s": json.dumps(
                    {"client_id": client_id, "client_secret": encrypt_api_key(client_secret)}
                ),
            },
        )

    print(f"\nassociate a '{username}' ({row['display_name'] or 'senza nome'}), secret cifrato.")
    print("\nOra togli CDSE_CLIENT_ID e CDSE_CLIENT_SECRET dal .env e riavvia il backend:")
    print("  docker compose up -d backend")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(asyncio.run(main(sys.argv[1])))
