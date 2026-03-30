"""Build and restore local backup bundles (zip archives with manifest)."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

BUNDLE_VERSION = 1


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def _sqlite_backup(src_db: Path, dst: Path) -> None:
    """Use SQLite online backup API for a consistent copy."""
    src_conn = sqlite3.connect(str(src_db))
    dst_conn = sqlite3.connect(str(dst))
    try:
        src_conn.backup(dst_conn)
    finally:
        dst_conn.close()
        src_conn.close()


def build_manifest(
    data_root: Path,
    device_id: str,
    user_key: str | None = None,
) -> dict[str, Any]:
    """Walk data_root and build a manifest dict (not yet zipped)."""
    db_path = data_root / "race_data.db"
    prefs_path = data_root / "preferences.json"
    uploads_dir = data_root / "uploads"

    manifest: dict[str, Any] = {
        "bundle_version": BUNDLE_VERSION,
        "schema_version": "auto",
        "user_key": user_key or "",
        "device_id": device_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "db": None,
        "preferences": None,
        "uploads": {},
    }

    if db_path.exists():
        manifest["db"] = {
            "filename": "race_data.db",
            "sha256": _sha256(db_path),
        }

    if prefs_path.exists():
        manifest["preferences"] = {
            "filename": "preferences.json",
            "sha256": _sha256(prefs_path),
        }

    if uploads_dir.is_dir():
        for fp in sorted(uploads_dir.rglob("*")):
            if fp.is_file():
                rel = fp.relative_to(data_root).as_posix()
                manifest["uploads"][rel] = {
                    "sha256": _sha256(fp),
                    "size_bytes": fp.stat().st_size,
                }

    return manifest


def build_bundle(
    data_root: Path,
    device_id: str,
    user_key: str | None = None,
    dest: Path | None = None,
    progress_cb: Any | None = None,
) -> Path:
    """Create a zip bundle from data_root.

    Returns the path to the created zip file.
    ``progress_cb(pct: int, label: str)`` is called with progress updates.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)

        db_src = data_root / "race_data.db"
        db_copy = tmp / "race_data.db"
        if db_src.exists():
            if progress_cb:
                progress_cb(5, "Backing up database")
            _sqlite_backup(db_src, db_copy)
        else:
            db_copy = None

        manifest = build_manifest(data_root, device_id, user_key)
        if db_copy:
            manifest["db"]["sha256"] = _sha256(db_copy)

        if dest is None:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            dest = data_root / f"backup_{ts}.zip"

        uploads_dir = data_root / "uploads"
        upload_files = list(uploads_dir.rglob("*")) if uploads_dir.is_dir() else []
        total_files = len(upload_files) + 2  # db + prefs + uploads
        done = 0

        with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
            if db_copy:
                zf.write(db_copy, "race_data.db")
                done += 1
                if progress_cb:
                    progress_cb(10 + int(done / total_files * 80), "Packing database")

            prefs = data_root / "preferences.json"
            if prefs.exists():
                zf.write(prefs, "preferences.json")
            done += 1

            for fp in upload_files:
                if fp.is_file():
                    rel = fp.relative_to(data_root).as_posix()
                    zf.write(fp, rel)
                done += 1
                if progress_cb and done % 5 == 0:
                    progress_cb(
                        10 + int(done / total_files * 80),
                        f"Packing files ({done}/{total_files})",
                    )

            zf.writestr("manifest.json", json.dumps(manifest, indent=2))

        if progress_cb:
            progress_cb(100, "Bundle complete")

        return dest


def read_bundle_manifest(bundle_path: Path) -> dict[str, Any]:
    """Read and return the manifest from a zip bundle."""
    with zipfile.ZipFile(bundle_path, "r") as zf:
        return json.loads(zf.read("manifest.json"))


def restore_bundle(
    bundle_path: Path,
    data_root: Path,
    progress_cb: Any | None = None,
) -> dict[str, Any]:
    """Restore a zip bundle into data_root.

    Returns the manifest dict. Existing files with matching hashes are skipped.
    """
    with zipfile.ZipFile(bundle_path, "r") as zf:
        manifest = json.loads(zf.read("manifest.json"))

        names = zf.namelist()
        total = len(names) - 1  # exclude manifest.json
        done = 0

        for name in names:
            if name == "manifest.json":
                continue

            dest_file = data_root / name
            dest_file.parent.mkdir(parents=True, exist_ok=True)

            should_write = True
            if dest_file.exists():
                entry = manifest.get("uploads", {}).get(name)
                if not entry and name == "race_data.db":
                    entry = manifest.get("db")
                if not entry and name == "preferences.json":
                    entry = manifest.get("preferences")
                if entry and entry.get("sha256"):
                    if _sha256(dest_file) == entry["sha256"]:
                        should_write = False

            if should_write:
                if name == "race_data.db":
                    with tempfile.NamedTemporaryFile(
                        suffix=".db", delete=False, dir=str(data_root)
                    ) as tf:
                        tf.write(zf.read(name))
                        temp_db = Path(tf.name)
                    _sqlite_backup(temp_db, dest_file)
                    temp_db.unlink(missing_ok=True)
                else:
                    with open(dest_file, "wb") as f:
                        f.write(zf.read(name))

            done += 1
            if progress_cb and (done % 5 == 0 or done == total):
                progress_cb(
                    10 + int(done / max(total, 1) * 85),
                    f"Restoring ({done}/{total})",
                )

    if progress_cb:
        progress_cb(100, "Restore complete")

    return manifest
