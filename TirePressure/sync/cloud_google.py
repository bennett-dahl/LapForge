"""Google Drive client for incremental content-addressed backup sync."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

_ROOT_FOLDER_NAME = "TirePressureBackup"


class DriveClient:
    """Wraps the Google Drive API for backup operations.

    Remote layout under a dedicated folder::

        TirePressureBackup/
          latest.json
          manifests/<manifest_id>.json
          db/<sha256>.db
          uploads/<sha256>.txt
          preferences/<sha256>.json
    """

    def __init__(self, credentials: Any):
        from googleapiclient.discovery import build

        self._service = build("drive", "v3", credentials=credentials)
        self._folder_cache: dict[str, str] = {}

    # ---- Folder helpers ----

    def _find_or_create_folder(self, name: str, parent_id: str | None = None) -> str:
        cache_key = f"{parent_id}:{name}"
        if cache_key in self._folder_cache:
            return self._folder_cache[cache_key]

        q = f"name='{name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
        if parent_id:
            q += f" and '{parent_id}' in parents"
        results = self._service.files().list(q=q, spaces="drive", fields="files(id,name)").execute()
        files = results.get("files", [])
        if files:
            fid = files[0]["id"]
        else:
            meta: dict[str, Any] = {"name": name, "mimeType": "application/vnd.google-apps.folder"}
            if parent_id:
                meta["parents"] = [parent_id]
            created = self._service.files().create(body=meta, fields="id").execute()
            fid = created["id"]

        self._folder_cache[cache_key] = fid
        return fid

    def _root_folder_id(self) -> str:
        return self._find_or_create_folder(_ROOT_FOLDER_NAME)

    def _sub_folder_id(self, name: str) -> str:
        return self._find_or_create_folder(name, self._root_folder_id())

    # ---- Low-level file ops ----

    def _find_file(self, name: str, folder_id: str) -> str | None:
        q = f"name='{name}' and '{folder_id}' in parents and trashed=false"
        results = self._service.files().list(q=q, spaces="drive", fields="files(id)").execute()
        files = results.get("files", [])
        return files[0]["id"] if files else None

    def _upload_bytes(self, data: bytes, name: str, folder_id: str, mime: str = "application/octet-stream") -> str:
        from googleapiclient.http import MediaInMemoryUpload

        existing_id = self._find_file(name, folder_id)
        media = MediaInMemoryUpload(data, mimetype=mime)
        if existing_id:
            updated = self._service.files().update(fileId=existing_id, media_body=media).execute()
            return updated["id"]
        meta = {"name": name, "parents": [folder_id]}
        created = self._service.files().create(body=meta, media_body=media, fields="id").execute()
        return created["id"]

    def _upload_file(self, local_path: Path, name: str, folder_id: str, mime: str = "application/octet-stream") -> str:
        from googleapiclient.http import MediaFileUpload

        existing_id = self._find_file(name, folder_id)
        media = MediaFileUpload(str(local_path), mimetype=mime, resumable=True)
        if existing_id:
            req = self._service.files().update(fileId=existing_id, media_body=media)
        else:
            meta = {"name": name, "parents": [folder_id]}
            req = self._service.files().create(body=meta, media_body=media, fields="id")
        response = None
        while response is None:
            _, response = req.next_chunk()
        return response["id"]

    def _download_bytes(self, file_id: str) -> bytes:
        return self._service.files().get_media(fileId=file_id).execute()

    def _download_to_file(self, file_id: str, dest: Path) -> None:
        from googleapiclient.http import MediaIoBaseDownload

        request = self._service.files().get_media(fileId=file_id)
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "wb") as f:
            downloader = MediaIoBaseDownload(f, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()

    def _list_files(self, folder_id: str) -> list[dict[str, str]]:
        items: list[dict[str, str]] = []
        page_token = None
        while True:
            q = f"'{folder_id}' in parents and trashed=false"
            resp = self._service.files().list(
                q=q, spaces="drive", fields="nextPageToken, files(id,name)",
                pageToken=page_token,
            ).execute()
            items.extend(resp.get("files", []))
            page_token = resp.get("nextPageToken")
            if not page_token:
                break
        return items

    # ---- High-level sync ops ----

    def get_remote_manifest(self) -> dict[str, Any] | None:
        """Fetch latest.json → resolve manifest → return it, or None."""
        root = self._root_folder_id()
        latest_id = self._find_file("latest.json", root)
        if not latest_id:
            return None
        try:
            latest = json.loads(self._download_bytes(latest_id))
        except Exception:
            return None
        manifest_name = latest.get("manifest_name")
        if not manifest_name:
            return None
        manifests_folder = self._sub_folder_id("manifests")
        manifest_id = self._find_file(manifest_name, manifests_folder)
        if not manifest_id:
            return None
        try:
            return json.loads(self._download_bytes(manifest_id))
        except Exception:
            return None

    def get_remote_upload_hashes(self) -> set[str]:
        """Return the set of sha256 hashes already present in remote uploads/ folder."""
        try:
            uploads_folder = self._sub_folder_id("uploads")
            files = self._list_files(uploads_folder)
            return {f["name"].rsplit(".", 1)[0] for f in files}
        except Exception:
            return set()

    def push_iter(
        self,
        manifest: dict[str, Any],
        data_root: Path,
    ) -> Any:
        """Push a snapshot to Drive, yielding per-file progress events.

        Yields dicts: file_start, file_done, file_skip, then returns silently.
        """
        remote_hashes = self.get_remote_upload_hashes()

        uploads_folder = self._sub_folder_id("uploads")
        db_folder = self._sub_folder_id("db")
        prefs_folder = self._sub_folder_id("preferences")
        manifests_folder = self._sub_folder_id("manifests")

        local_uploads = manifest.get("uploads", {})

        for rel, info in local_uploads.items():
            size = info.get("size_bytes", 0)
            if info["sha256"] in remote_hashes:
                yield {"event": "file_skip", "path": rel, "size": size}
                continue
            local_path = data_root / rel
            if local_path.exists():
                yield {"event": "file_start", "path": rel, "size": size}
                remote_name = f"{info['sha256']}.txt"
                self._upload_file(local_path, remote_name, uploads_folder)
                yield {"event": "file_done", "path": rel}

        db_info = manifest.get("db")
        if db_info:
            db_path = data_root / "race_data.db"
            db_size = db_path.stat().st_size if db_path.exists() else 0
            remote_db_name = f"{db_info['sha256']}.db"
            if self._find_file(remote_db_name, db_folder):
                yield {"event": "file_skip", "path": "race_data.db", "size": db_size}
            elif db_path.exists():
                yield {"event": "file_start", "path": "race_data.db", "size": db_size}
                from TirePressure.sync.bundle import _sqlite_backup
                import tempfile
                with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
                    tmp_db = Path(tf.name)
                _sqlite_backup(db_path, tmp_db)
                self._upload_file(tmp_db, remote_db_name, db_folder)
                tmp_db.unlink(missing_ok=True)
                yield {"event": "file_done", "path": "race_data.db"}

        prefs_info = manifest.get("preferences")
        if prefs_info:
            prefs_path = data_root / "preferences.json"
            prefs_size = prefs_path.stat().st_size if prefs_path.exists() else 0
            remote_prefs_name = f"{prefs_info['sha256']}.json"
            if self._find_file(remote_prefs_name, prefs_folder):
                yield {"event": "file_skip", "path": "preferences.json", "size": prefs_size}
            elif prefs_path.exists():
                yield {"event": "file_start", "path": "preferences.json", "size": prefs_size}
                self._upload_bytes(prefs_path.read_bytes(), remote_prefs_name, prefs_folder)
                yield {"event": "file_done", "path": "preferences.json"}

        yield {"event": "file_start", "path": "_sync/manifest.json", "size": 0}
        import uuid
        manifest_name = f"{uuid.uuid4().hex}.json"
        manifest_data = json.dumps(manifest, indent=2).encode()
        self._upload_bytes(manifest_data, manifest_name, manifests_folder, "application/json")

        root = self._root_folder_id()
        latest = json.dumps({
            "manifest_name": manifest_name,
            "timestamp": manifest["created_at"],
            "device_id": manifest["device_id"],
        }).encode()
        self._upload_bytes(latest, "latest.json", root, "application/json")
        yield {"event": "file_done", "path": "_sync/manifest.json"}

    def pull_iter(
        self,
        data_root: Path,
    ) -> Any:
        """Pull latest remote snapshot, yielding per-file progress events.

        Yields dicts: file_start, file_done, file_skip.
        The final yield is {"event": "manifest", "manifest": <dict>} or None is returned
        if no remote backup exists.
        """
        from TirePressure.sync.bundle import _sha256

        manifest = self.get_remote_manifest()
        if not manifest:
            return

        uploads_folder = self._sub_folder_id("uploads")
        db_folder = self._sub_folder_id("db")
        prefs_folder = self._sub_folder_id("preferences")

        remote_uploads = manifest.get("uploads", {})

        for rel, info in remote_uploads.items():
            size = info.get("size_bytes", 0)
            local_path = data_root / rel
            local_path.parent.mkdir(parents=True, exist_ok=True)
            if local_path.exists() and _sha256(local_path) == info["sha256"]:
                yield {"event": "file_skip", "path": rel, "size": size}
                continue
            yield {"event": "file_start", "path": rel, "size": size}
            remote_name = f"{info['sha256']}.txt"
            remote_id = self._find_file(remote_name, uploads_folder)
            if remote_id:
                self._download_to_file(remote_id, local_path)
            yield {"event": "file_done", "path": rel}

        db_info = manifest.get("db")
        if db_info:
            db_path = data_root / "race_data.db"
            db_size = db_path.stat().st_size if db_path.exists() else 0
            yield {"event": "file_start", "path": "race_data.db", "size": db_size}
            remote_name = f"{db_info['sha256']}.db"
            remote_id = self._find_file(remote_name, db_folder)
            if remote_id:
                import tempfile
                with tempfile.NamedTemporaryFile(suffix=".db", delete=False, dir=str(data_root)) as tf:
                    tmp_path = Path(tf.name)
                self._download_to_file(remote_id, tmp_path)
                from TirePressure.sync.bundle import _sqlite_backup
                _sqlite_backup(tmp_path, data_root / "race_data.db")
                tmp_path.unlink(missing_ok=True)
            yield {"event": "file_done", "path": "race_data.db"}

        prefs_info = manifest.get("preferences")
        if prefs_info:
            prefs_path = data_root / "preferences.json"
            prefs_size = prefs_path.stat().st_size if prefs_path.exists() else 0
            yield {"event": "file_start", "path": "preferences.json", "size": prefs_size}
            remote_name = f"{prefs_info['sha256']}.json"
            remote_id = self._find_file(remote_name, prefs_folder)
            if remote_id:
                prefs_data = self._download_bytes(remote_id)
                (data_root / "preferences.json").write_bytes(prefs_data)
            yield {"event": "file_done", "path": "preferences.json"}

        yield {"event": "manifest", "manifest": manifest}
