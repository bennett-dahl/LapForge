"""Sync engine — dirty detection, conflict resolution, orchestration."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Iterator

from TirePressure.sync.bundle import build_manifest

log = logging.getLogger(__name__)


class SyncStatus(str, Enum):
    IN_SYNC = "in_sync"
    LOCAL_DIRTY = "local_dirty"
    REMOTE_CHANGED = "remote_changed"
    CONFLICT = "conflict"
    NEVER_SYNCED = "never_synced"
    NO_REMOTE = "no_remote"
    ERROR = "error"


def _sync_state_path(data_root: Path) -> Path:
    return data_root / "sync_state.json"


def load_sync_state(data_root: Path) -> dict[str, Any]:
    p = _sync_state_path(data_root)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_sync_state(data_root: Path, state: dict[str, Any]) -> None:
    p = _sync_state_path(data_root)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(state, indent=2), encoding="utf-8")


def is_dirty(data_root: Path, device_id: str, user_key: str | None = None) -> bool:
    """Check if local data has changed since the last sync."""
    state = load_sync_state(data_root)
    if not state.get("last_synced_manifest_id"):
        return True

    current = build_manifest(data_root, device_id, user_key)
    if (current.get("db") or {}).get("sha256") != state.get("last_synced_db_hash"):
        return True

    current_upload_hashes = {
        rel: info["sha256"] for rel, info in current.get("uploads", {}).items()
    }
    if current_upload_hashes != state.get("last_synced_upload_hashes", {}):
        return True

    return False


def detect_status(
    data_root: Path,
    device_id: str,
    user_key: str | None,
    remote_manifest: dict[str, Any] | None,
) -> SyncStatus:
    """Compare local state against remote to determine sync status."""
    state = load_sync_state(data_root)
    has_synced = bool(state.get("last_synced_manifest_id"))
    local_dirty = is_dirty(data_root, device_id, user_key)

    if remote_manifest is None:
        if not has_synced:
            return SyncStatus.NEVER_SYNCED
        return SyncStatus.NO_REMOTE

    remote_manifest_id = remote_manifest.get("created_at", "")
    last_known = state.get("last_synced_manifest_id", "")
    remote_changed = remote_manifest_id != last_known

    if not local_dirty and not remote_changed:
        return SyncStatus.IN_SYNC
    if local_dirty and not remote_changed:
        return SyncStatus.LOCAL_DIRTY
    if not local_dirty and remote_changed:
        return SyncStatus.REMOTE_CHANGED
    return SyncStatus.CONFLICT


def mark_synced(
    data_root: Path,
    manifest: dict[str, Any],
) -> None:
    """Record that a sync completed successfully."""
    upload_hashes = {
        rel: info["sha256"] for rel, info in manifest.get("uploads", {}).items()
    }
    state = {
        "last_synced_manifest_id": manifest.get("created_at", ""),
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
        "last_synced_db_hash": (manifest.get("db") or {}).get("sha256", ""),
        "last_synced_prefs_hash": (manifest.get("preferences") or {}).get("sha256", ""),
        "last_synced_upload_hashes": upload_hashes,
        "device_id": manifest.get("device_id", ""),
    }
    save_sync_state(data_root, state)


def build_file_list(
    data_root: Path,
    device_id: str,
    user_key: str | None = None,
) -> dict[str, Any]:
    """Return per-file sync inventory comparing local state against last sync.

    Returns ``{"files": [...], "summary": {...}}``.
    Each file entry has keys: path, type, size, status.
    """
    manifest = build_manifest(data_root, device_id, user_key)
    state = load_sync_state(data_root)
    has_synced = bool(state.get("last_synced_manifest_id"))

    synced_db_hash = state.get("last_synced_db_hash", "")
    synced_upload_hashes: dict[str, str] = state.get("last_synced_upload_hashes", {})

    files: list[dict[str, Any]] = []

    db_info = manifest.get("db")
    if db_info:
        db_path = data_root / "race_data.db"
        size = db_path.stat().st_size if db_path.exists() else 0
        if not has_synced:
            st = "new"
        elif db_info["sha256"] == synced_db_hash:
            st = "synced"
        else:
            st = "modified"
        files.append({"path": "race_data.db", "type": "database", "size": size, "status": st})

    prefs_info = manifest.get("preferences")
    if prefs_info:
        prefs_path = data_root / "preferences.json"
        size = prefs_path.stat().st_size if prefs_path.exists() else 0
        synced_prefs_hash = state.get("last_synced_prefs_hash", "")
        if not has_synced:
            st = "new"
        elif prefs_info["sha256"] == synced_prefs_hash:
            st = "synced"
        else:
            st = "modified"
        files.append({"path": "preferences.json", "type": "preferences", "size": size, "status": st})

    for rel, info in manifest.get("uploads", {}).items():
        local_path = data_root / rel
        size = info.get("size_bytes", 0)
        if not has_synced:
            st = "new"
        elif rel in synced_upload_hashes and info["sha256"] == synced_upload_hashes[rel]:
            st = "synced"
        elif rel in synced_upload_hashes:
            st = "modified"
        else:
            st = "new"
        files.append({"path": rel, "type": "upload", "size": size, "status": st})

    synced_count = sum(1 for f in files if f["status"] == "synced")
    pending = [f for f in files if f["status"] != "synced"]
    return {
        "files": files,
        "summary": {
            "total": len(files),
            "synced": synced_count,
            "pending": len(pending),
            "pending_size": sum(f["size"] for f in pending),
        },
    }


def do_push(
    data_root: Path,
    device_id: str,
    user_key: str | None,
    credentials: Any,
) -> Iterator[dict[str, Any]]:
    """Build manifest, push to Drive, mark synced. Yields per-file progress events."""
    from TirePressure.sync.cloud_google import DriveClient

    manifest = build_manifest(data_root, device_id, user_key)
    client = DriveClient(credentials)
    yield from client.push_iter(manifest, data_root)
    log.info("Push upload phase complete, writing sync state to %s", data_root)
    try:
        mark_synced(data_root, manifest)
        log.info("sync_state.json written successfully")
    except Exception:
        log.exception("Failed to write sync_state.json")
        raise
    yield {"event": "complete", "manifest_timestamp": manifest.get("created_at")}


def do_pull(
    data_root: Path,
    credentials: Any,
) -> Iterator[dict[str, Any]]:
    """Pull latest from Drive, restore locally, mark synced. Yields per-file progress events."""
    from TirePressure.sync.cloud_google import DriveClient

    client = DriveClient(credentials)
    manifest = None
    for evt in client.pull_iter(data_root):
        if evt.get("event") == "manifest":
            manifest = evt["manifest"]
        else:
            yield evt
    if manifest:
        mark_synced(data_root, manifest)
        yield {"event": "complete", "manifest_timestamp": manifest.get("created_at")}
    else:
        yield {"event": "error", "message": "No remote backup found"}
