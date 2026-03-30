"""Tests for LapForge.config — AppConfig persistence, properties, build defaults."""

import json
from pathlib import Path

import pytest

from LapForge.config import AppConfig


class TestAppConfig:
    def test_device_id_generated_once(self, tmp_path: Path):
        cfg = AppConfig(path=tmp_path / "config.json")
        did = cfg.device_id
        assert isinstance(did, str) and len(did) == 36  # UUID format
        assert cfg.device_id == did  # same on second call

    def test_device_id_persisted(self, tmp_path: Path):
        p = tmp_path / "config.json"
        cfg1 = AppConfig(path=p)
        did = cfg1.device_id

        cfg2 = AppConfig(path=p)
        assert cfg2.device_id == did

    def test_flask_secret_key(self, tmp_path: Path):
        cfg = AppConfig(path=tmp_path / "config.json")
        key = cfg.flask_secret_key
        assert len(key) == 64  # two uuid4 hex values concatenated
        assert cfg.flask_secret_key == key

    def test_data_root_default_none(self, tmp_path: Path):
        cfg = AppConfig(path=tmp_path / "config.json")
        assert cfg.data_root is None

    def test_data_root_set_and_get(self, tmp_path: Path):
        cfg = AppConfig(path=tmp_path / "config.json")
        cfg.data_root = tmp_path / "custom"
        assert cfg.data_root == tmp_path / "custom"

    def test_data_root_clear(self, tmp_path: Path):
        cfg = AppConfig(path=tmp_path / "config.json")
        cfg.data_root = tmp_path / "x"
        cfg.data_root = None
        assert cfg.data_root is None

    def test_profiles(self, tmp_path: Path):
        cfg = AppConfig(path=tmp_path / "config.json")
        assert cfg.get_profiles() == {}
        cfg.set_profile("u1", {"email": "a@b.com", "name": "A"})
        assert cfg.get_profile("u1")["email"] == "a@b.com"
        assert cfg.get_profile("u2") is None

    def test_google_credentials_from_env(self, tmp_path: Path, monkeypatch):
        monkeypatch.setenv("GOOGLE_CLIENT_ID", "env-id")
        monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "env-secret")
        cfg = AppConfig(path=tmp_path / "config.json")
        assert cfg.google_client_id == "env-id"
        assert cfg.google_client_secret == "env-secret"

    def test_google_credentials_from_config(self, tmp_path: Path, monkeypatch):
        monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
        monkeypatch.delenv("GOOGLE_CLIENT_SECRET", raising=False)
        p = tmp_path / "config.json"
        p.write_text(json.dumps({
            "google_client_id": "cfg-id",
            "google_client_secret": "cfg-secret",
        }))
        cfg = AppConfig(path=p)
        assert cfg.google_client_id == "cfg-id"
        assert cfg.google_client_secret == "cfg-secret"

    def test_google_credentials_from_build_defaults(self, tmp_path: Path, monkeypatch):
        monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
        monkeypatch.delenv("GOOGLE_CLIENT_SECRET", raising=False)

        import LapForge.config as config_mod
        defaults_path = Path(config_mod.__file__).with_name("_build_defaults.json")
        wrote = False
        try:
            defaults_path.write_text(json.dumps({
                "GOOGLE_CLIENT_ID": "build-id",
                "GOOGLE_CLIENT_SECRET": "build-secret",
            }))
            wrote = True
            cfg = AppConfig(path=tmp_path / "config.json")
            assert cfg.google_client_id == "build-id"
            assert cfg.google_client_secret == "build-secret"
        finally:
            if wrote:
                defaults_path.unlink(missing_ok=True)

    def test_google_credentials_none(self, tmp_path: Path, monkeypatch):
        monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
        monkeypatch.delenv("GOOGLE_CLIENT_SECRET", raising=False)
        cfg = AppConfig(path=tmp_path / "config.json")
        assert cfg.google_client_id is None
        assert cfg.google_client_secret is None

    def test_corrupt_config_file(self, tmp_path: Path):
        p = tmp_path / "config.json"
        p.write_text("not json!!!")
        cfg = AppConfig(path=p)
        assert cfg.data_root is None
        _ = cfg.device_id  # should still work, generating a new one
