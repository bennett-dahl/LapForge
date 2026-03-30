"""App-level configuration stored in OS appdata (%APPDATA%/LapForge/)."""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any


def _appdata_dir() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    d = base / "LapForge"
    # One-time migration from old name
    old = base / "RaceDataAnalysis"
    if old.exists() and not d.exists():
        old.rename(d)
    d.mkdir(parents=True, exist_ok=True)
    return d


class AppConfig:
    """Singleton-style config persisted in appdata, not inside the data_root."""

    def __init__(self, path: Path | None = None):
        self._path = path or (_appdata_dir() / "config.json")
        self._data: dict[str, Any] = self._load()

    def _load(self) -> dict[str, Any]:
        if self._path.exists():
            try:
                return json.loads(self._path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pass
        return {}

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps(self._data, indent=2), encoding="utf-8")

    # ---- device_id (generated once per install) ----

    @property
    def device_id(self) -> str:
        if "device_id" not in self._data:
            self._data["device_id"] = str(uuid.uuid4())
            self._save()
        return self._data["device_id"]

    # ---- Flask secret key (generated once per install) ----

    @property
    def flask_secret_key(self) -> str:
        if "flask_secret_key" not in self._data:
            self._data["flask_secret_key"] = uuid.uuid4().hex + uuid.uuid4().hex
            self._save()
        return self._data["flask_secret_key"]

    # ---- data_root (user-configurable, None = use legacy default) ----

    @property
    def data_root(self) -> Path | None:
        raw = self._data.get("data_root")
        return Path(raw) if raw else None

    @data_root.setter
    def data_root(self, value: Path | None) -> None:
        self._data["data_root"] = str(value) if value else None
        self._save()

    # ---- Profile registry (user_key -> profile metadata) ----

    def get_profiles(self) -> dict[str, dict[str, Any]]:
        return self._data.get("profiles", {})

    def get_profile(self, user_key: str) -> dict[str, Any] | None:
        return self._data.get("profiles", {}).get(user_key)

    def set_profile(self, user_key: str, profile: dict[str, Any]) -> None:
        if "profiles" not in self._data:
            self._data["profiles"] = {}
        self._data["profiles"][user_key] = profile
        self._save()

    # ---- Google OAuth client config ----
    # Default credentials for the shipped desktop app (public-client pattern).
    # Override via env vars or config.json for development / custom deployments.
    _DEFAULT_GOOGLE_CLIENT_ID = "362442052123-j4kq8tmvhmh0dc61va5inlrusbo3scfe.apps.googleusercontent.com"
    _DEFAULT_GOOGLE_CLIENT_SECRET = "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"

    @property
    def google_client_id(self) -> str | None:
        return (
            os.environ.get("GOOGLE_CLIENT_ID")
            or self._data.get("google_client_id")
            or self._DEFAULT_GOOGLE_CLIENT_ID
            or None
        )

    @property
    def google_client_secret(self) -> str | None:
        return (
            os.environ.get("GOOGLE_CLIENT_SECRET")
            or self._data.get("google_client_secret")
            or self._DEFAULT_GOOGLE_CLIENT_SECRET
            or None
        )
