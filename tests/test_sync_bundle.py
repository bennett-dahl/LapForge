"""Tests for LapForge.sync.bundle — manifest, build, restore round-trip."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from LapForge.sync.bundle import (
    BUNDLE_VERSION,
    _sha256,
    build_bundle,
    build_manifest,
    read_bundle_manifest,
    restore_bundle,
)


@pytest.fixture
def populated_data_root(tmp_data_root: Path, store) -> Path:
    """Data root with a DB, preferences, and a couple of upload files."""
    store.add_car_driver("911", "Alice")
    store.add_car_driver("718", "Bob")

    prefs = tmp_data_root / "preferences.json"
    prefs.write_text(json.dumps({"target_psi": 27.0}), encoding="utf-8")

    uploads = tmp_data_root / "uploads"
    (uploads / "file1.txt").write_text("data1")
    (uploads / "file2.txt").write_text("data2")

    return tmp_data_root


class TestSha256:
    def test_deterministic(self, tmp_path):
        f = tmp_path / "test.bin"
        f.write_bytes(b"hello world")
        h1 = _sha256(f)
        h2 = _sha256(f)
        assert h1 == h2
        assert len(h1) == 64


class TestBuildManifest:
    def test_includes_db(self, populated_data_root):
        manifest = build_manifest(populated_data_root, "device-1")
        assert manifest["bundle_version"] == BUNDLE_VERSION
        assert manifest["device_id"] == "device-1"
        assert manifest["db"] is not None
        assert manifest["db"]["filename"] == "race_data.db"
        assert len(manifest["db"]["sha256"]) == 64

    def test_includes_preferences(self, populated_data_root):
        manifest = build_manifest(populated_data_root, "device-1")
        assert manifest["preferences"] is not None

    def test_includes_uploads(self, populated_data_root):
        manifest = build_manifest(populated_data_root, "device-1")
        assert len(manifest["uploads"]) == 2
        assert "uploads/file1.txt" in manifest["uploads"]

    def test_no_db(self, tmp_path):
        empty_root = tmp_path / "empty"
        empty_root.mkdir()
        manifest = build_manifest(empty_root, "device-1")
        assert manifest["db"] is None


class TestBuildAndRestoreBundle:
    def test_round_trip(self, populated_data_root, tmp_path):
        bundle_path = tmp_path / "backup.zip"
        result = build_bundle(populated_data_root, "device-1", dest=bundle_path)
        assert result == bundle_path
        assert bundle_path.exists()
        assert bundle_path.stat().st_size > 0

        manifest = read_bundle_manifest(bundle_path)
        assert manifest["bundle_version"] == BUNDLE_VERSION
        assert manifest["db"] is not None

        restore_root = tmp_path / "restored"
        restore_root.mkdir()
        restored = restore_bundle(bundle_path, restore_root)
        assert (restore_root / "race_data.db").exists()
        assert (restore_root / "preferences.json").exists()
        assert (restore_root / "uploads" / "file1.txt").exists()
        assert (restore_root / "uploads" / "file1.txt").read_text() == "data1"

    def test_restore_skips_matching_hashes(self, populated_data_root, tmp_path):
        bundle_path = tmp_path / "backup.zip"
        build_bundle(populated_data_root, "device-1", dest=bundle_path)

        restore_root = tmp_path / "restored"
        restore_root.mkdir()
        restore_bundle(bundle_path, restore_root)

        f1 = restore_root / "uploads" / "file1.txt"
        mtime_before = f1.stat().st_mtime

        import time
        time.sleep(0.05)
        restore_bundle(bundle_path, restore_root)
        mtime_after = f1.stat().st_mtime
        assert mtime_before == mtime_after  # file not rewritten

    def test_progress_callback(self, populated_data_root, tmp_path):
        progress = []
        bundle_path = tmp_path / "backup.zip"
        build_bundle(
            populated_data_root, "device-1", dest=bundle_path,
            progress_cb=lambda pct, label: progress.append((pct, label)),
        )
        assert len(progress) > 0
        assert progress[-1][0] == 100

    def test_round_trip_after_orphan_cleanup(self, tmp_data_root, store, tmp_path):
        """Backup/restore works when uploads only contains referenced files (post-cleanup)."""
        from LapForge.models import Session, SessionType
        import uuid as _uuid
        cd = store.add_car_driver("911", "Alice")
        sid = str(_uuid.uuid4())
        (store.uploads_dir / f"{sid}.txt").write_text("export data")
        s = Session(id=sid, car_driver_id=cd.id, session_type=SessionType.PRACTICE_1,
                    track="T", driver="D", car="C", outing_number="1", session_number="1",
                    file_path=f"uploads/{sid}.txt")
        store.add_session(s)
        # Orphan that would have been cleaned up
        (store.uploads_dir / "orphan.txt").write_text("stale")
        store.cleanup_orphan_uploads()
        assert not (store.uploads_dir / "orphan.txt").exists()

        bundle_path = tmp_path / "backup.zip"
        build_bundle(tmp_data_root, "device-1", dest=bundle_path)
        manifest = read_bundle_manifest(bundle_path)
        assert f"uploads/{sid}.txt" in manifest["uploads"]
        assert "uploads/orphan.txt" not in manifest["uploads"]

        restore_root = tmp_path / "restored"
        restore_root.mkdir()
        restore_bundle(bundle_path, restore_root)
        assert (restore_root / "uploads" / f"{sid}.txt").exists()
        assert not (restore_root / "uploads" / "orphan.txt").exists()

    def test_restore_progress(self, populated_data_root, tmp_path):
        bundle_path = tmp_path / "backup.zip"
        build_bundle(populated_data_root, "device-1", dest=bundle_path)

        restore_root = tmp_path / "restored"
        restore_root.mkdir()
        progress = []
        restore_bundle(
            bundle_path, restore_root,
            progress_cb=lambda pct, label: progress.append((pct, label)),
        )
        assert len(progress) > 0
        assert progress[-1][0] == 100
