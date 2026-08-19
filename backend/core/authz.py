"""Story-scoped authorization.

Holding the `editor` role only means a user may edit *their own* stories. Every
endpoint that touches a specific story has to check that story too, which is what
these helpers are for. They live here rather than in a router so that slides,
layers, symbology and media all enforce the same rule.
"""

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def story_access(
    db: AsyncSession, story_id: int, user: dict, require_role: str = "viewer"
) -> str | None:
    """Return the caller's effective role on a story, or None if they have none.

    Effective roles are "owner" (author or admin) and the collaborator roles
    "editor" and "viewer". Pass require_role="editor" to reject viewers.
    """
    if user is None:
        return None
    if user.get("role") == "admin":
        return "owner"

    owner = await db.execute(text("SELECT author_id FROM stories WHERE id = :id"), {"id": story_id})
    owner_row = owner.fetchone()
    if not owner_row:
        return None
    if owner_row[0] == user["id"]:
        return "owner"

    collab = await db.execute(
        text("SELECT role FROM story_collaborators WHERE story_id = :sid AND user_id = :uid"),
        {"sid": story_id, "uid": user["id"]},
    )
    collab_row = collab.fetchone()
    if not collab_row:
        return None
    collab_role = collab_row[0]
    if require_role == "editor" and collab_role == "viewer":
        return None
    return collab_role


async def require_story_access(
    db: AsyncSession, story_id: int, user: dict, require_role: str = "viewer"
) -> str:
    """story_access(), but raises instead of returning None.

    Answers with 404 rather than 403 so the endpoint does not confirm to an
    unauthorized caller that the story exists.
    """
    role = await story_access(db, story_id, user, require_role)
    if not role:
        raise HTTPException(status_code=404, detail="Storia non trovata")
    return role


async def require_slide_access(
    db: AsyncSession, slide_id: int, user: dict, require_role: str = "editor"
) -> int:
    """Resolve a slide to its story, check access, and return the story id."""
    row = await db.execute(text("SELECT story_id FROM slides WHERE id = :id"), {"id": slide_id})
    slide_row = row.fetchone()
    if not slide_row:
        raise HTTPException(status_code=404, detail="Slide non trovata")
    await require_story_access(db, slide_row[0], user, require_role)
    return slide_row[0]


async def require_marker_access(
    db: AsyncSession, marker_id: int, user: dict, require_role: str = "editor"
) -> int:
    """Resolve a marker to its slide, check access, and return the slide id."""
    row = await db.execute(
        text("SELECT slide_id FROM markers WHERE id = :id"), {"id": marker_id}
    )
    marker_row = row.fetchone()
    if not marker_row:
        raise HTTPException(status_code=404, detail="Marker non trovato")
    await require_slide_access(db, marker_row[0], user, require_role)
    return marker_row[0]
