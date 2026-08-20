"""Demo storymaps.

A fresh installation shows an empty dashboard, which says nothing about what the
tool can do. These seeds create a handful of published, public stories that
exercise the features worth showing: cinematic camera moves between stops, the
animated key figures and before/after comparison, and temporal playback of a layer.

The stories live as JSON under ``backend/demo`` so they can be edited without
touching Python, and each carries a ``demo_slug`` that makes seeding idempotent: a
story whose slug is already present is left alone, so a restart never duplicates
it and an administrator who deleted or reworked a demo keeps their decision.

Seeding is opt-in via ``SEED_DEMO_STORIES`` because an organisation deploying
TalkingMaps for its own work does not necessarily want sample content in the
dashboard.
"""

import json
import logging
import os

from sqlalchemy import text

logger = logging.getLogger("talkingmaps.seed")

DEMO_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "demo")


def _demo_files() -> list[str]:
    if not os.path.isdir(DEMO_DIR):
        return []
    return sorted(f for f in os.listdir(DEMO_DIR) if f.endswith(".json"))


def _resolve_layer_refs(value, key_to_id: dict):
    """Swap the ``layer_key`` placeholders in a seed file for real layer ids.

    A seed file cannot know the ids the database will assign, so it refers to its
    own layers by key. This rewrites ``layer_visibility`` keys and the timeline's
    ``layer_key`` once the layers have been inserted.
    """
    if not key_to_id:
        return value
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if k == "layer_key" and isinstance(v, str) and v in key_to_id:
                out["layer_id"] = key_to_id[v]
                continue
            new_key = str(key_to_id[k]) if k in key_to_id else k
            out[new_key] = _resolve_layer_refs(v, key_to_id)
        return out
    if isinstance(value, list):
        return [_resolve_layer_refs(v, key_to_id) for v in value]
    return value


async def _seed_one(conn, data: dict, author_id: int) -> str | None:
    """Insert one demo story. Returns its slug, or None if it was already there."""
    slug = data.get("demo_slug")
    if not slug:
        return None

    existing = await conn.execute(text("SELECT id FROM stories WHERE slug = :s"), {"s": slug})
    if existing.fetchone():
        return None

    # Layers first: the slides refer to them by the ids assigned here
    key_to_id: dict[str, int] = {}
    for layer in data.get("layers", []):
        res = await conn.execute(
            text(
                """INSERT INTO layers (name, description, layer_type, source_config, style_config, owner_id, public)
                   VALUES (:name, :desc, :lt, CAST(:src AS jsonb), CAST(:style AS jsonb), :owner, :public)
                   RETURNING id"""
            ),
            {
                "name": layer["name"],
                "desc": layer.get("description", ""),
                "lt": layer["layer_type"],
                "src": json.dumps(layer.get("source_config", {})),
                "style": json.dumps(layer.get("style_config", {})),
                "owner": author_id,
                "public": bool(layer.get("public", True)),
            },
        )
        key_to_id[layer["key"]] = res.fetchone()[0]

    story = data.get("story", {})
    res = await conn.execute(
        text(
            """INSERT INTO stories (slug, title, description, author_id, status, visibility, theme, settings)
               VALUES (:slug, :title, :desc, :author, 'published', 'public',
                       CAST(:theme AS jsonb), CAST(:settings AS jsonb))
               RETURNING id"""
        ),
        {
            "slug": slug,
            "title": story.get("title", slug),
            "desc": story.get("description", ""),
            "author": author_id,
            "theme": json.dumps(story.get("theme", {})),
            "settings": json.dumps(story.get("settings", {})),
        },
    )
    story_id = res.fetchone()[0]

    for position, layer_id in enumerate(key_to_id.values()):
        await conn.execute(
            text(
                """INSERT INTO story_layers (story_id, layer_id, position, visible, opacity)
                   VALUES (:sid, :lid, :pos, TRUE, 1.0) ON CONFLICT DO NOTHING"""
            ),
            {"sid": story_id, "lid": layer_id, "pos": position},
        )

    for index, slide in enumerate(data.get("slides", [])):
        markers = slide.get("markers", [])
        res = await conn.execute(
            text(
                """INSERT INTO slides (story_id, title, narrative, position, layout, map_center, map_zoom,
                                       map_bearing, map_pitch, map_animation, layer_visibility, map_config,
                                       style_overrides)
                   VALUES (:sid, :title, :narr, :pos, :layout, CAST(:center AS jsonb), :zoom,
                           :bearing, :pitch, :anim, CAST(:lv AS jsonb), CAST(:mc AS jsonb),
                           CAST(:style AS jsonb))
                   RETURNING id"""
            ),
            {
                "sid": story_id,
                "title": slide.get("title", ""),
                "narr": slide.get("narrative", ""),
                "pos": slide.get("position", index),
                "layout": slide.get("layout", "side-left"),
                "center": json.dumps(slide["map_center"]) if slide.get("map_center") else None,
                "zoom": slide.get("map_zoom"),
                "bearing": slide.get("map_bearing", 0),
                "pitch": slide.get("map_pitch", 0),
                "anim": slide.get("map_animation", "flyTo"),
                "lv": json.dumps(_resolve_layer_refs(slide.get("layer_visibility", {}), key_to_id)),
                "mc": json.dumps(_resolve_layer_refs(slide.get("map_config", {}), key_to_id)),
                "style": json.dumps(slide.get("style_overrides", {})),
            },
        )
        slide_id = res.fetchone()[0]

        for marker in markers:
            await conn.execute(
                text(
                    """INSERT INTO markers (slide_id, geom, title, popup_content, icon, color)
                       VALUES (:sid, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), :title, :popup, :icon, :color)"""
                ),
                {
                    "sid": slide_id,
                    "lng": marker["lng"],
                    "lat": marker["lat"],
                    "title": marker.get("title", ""),
                    "popup": marker.get("popup_content", ""),
                    "icon": marker.get("icon", "bi-geo-alt-fill|md|pin"),
                    "color": marker.get("color", "#4f6df5"),
                },
            )

    return slug


async def seed_demo_stories(engine, author_id: int) -> dict:
    """Create any demo story whose slug is not in the database yet."""
    created: list[str] = []
    skipped: list[str] = []
    failed: list[tuple[str, str]] = []

    for filename in _demo_files():
        path = os.path.join(DEMO_DIR, filename)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception as exc:  # noqa: BLE001
            failed.append((filename, f"file non leggibile: {exc}"))
            continue

        try:
            async with engine.begin() as conn:
                slug = await _seed_one(conn, data, author_id)
            if slug:
                created.append(slug)
                logger.info("Demo story created: %s", slug)
            else:
                skipped.append(filename)
        except Exception as exc:  # noqa: BLE001 - reported, never fatal at boot
            failed.append((filename, str(exc)))
            logger.error("Demo seed FAILED: %s — %s", filename, exc)

    return {"created": created, "skipped": skipped, "failed": failed}
