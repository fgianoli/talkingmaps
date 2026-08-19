"""Helpers for handling filenames and archives that came from a user.

Two things go wrong when upload paths are built naively:

* ``os.path.join(dest, filename)`` returns ``filename`` outright when it is
  absolute, and happily walks upwards when it contains ``..`` — so a crafted
  name writes wherever the process can write.
* ``ZipFile.extractall`` honours the paths stored *inside* the archive, so a
  member named ``../../etc/thing`` escapes the destination ("zip slip").

Both are closed here so every upload path in the app behaves the same way.
"""

import os
import zipfile

from fastapi import HTTPException

# Anything outside this set is replaced, so a name can never carry a path
# separator, a drive letter, or a leading dot-dot.
_SAFE_CHARS = set(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._- ()[]"
)


def safe_filename(filename: str | None, fallback: str = "upload") -> str:
    """Reduce a user-supplied filename to a single harmless path segment."""
    name = os.path.basename((filename or "").replace("\\", "/").strip())
    name = "".join(ch if ch in _SAFE_CHARS else "_" for ch in name)
    name = name.lstrip(".").strip()
    if not name or name in {".", ".."}:
        return fallback
    return name[:200]


def safe_extension(filename: str | None, allowed: set[str] | None = None) -> str:
    """Return a lowercase, sanitised extension (with its dot), or "".

    Pass ``allowed`` to reject anything not on the list — the safest option when
    the value ends up in a URL or an HTML attribute.
    """
    ext = os.path.splitext(safe_filename(filename, ""))[1].lower()
    if not ext:
        return ""
    if not all(ch.isalnum() for ch in ext[1:]):
        return ""
    if allowed is not None and ext not in allowed:
        return ""
    return ext[:12]


def safe_extract(zf: zipfile.ZipFile, dest_dir: str) -> None:
    """extractall() that refuses members escaping dest_dir.

    Also skips symlinks, which would otherwise let a later write follow the link
    out of the destination.
    """
    dest_root = os.path.realpath(dest_dir)
    for member in zf.infolist():
        # Reject absolute paths, drive letters and any upward traversal
        member_path = os.path.realpath(os.path.join(dest_root, member.filename))
        if member_path != dest_root and not member_path.startswith(dest_root + os.sep):
            raise HTTPException(
                status_code=400,
                detail=f"Archivio non sicuro: il file '{member.filename}' esce dalla cartella di destinazione",
            )
        # 0xA000 is the symlink bit in the external attributes' Unix mode
        if (member.external_attr >> 16) & 0xF000 == 0xA000:
            raise HTTPException(
                status_code=400,
                detail=f"Archivio non sicuro: '{member.filename}' è un link simbolico",
            )
    zf.extractall(dest_dir)
