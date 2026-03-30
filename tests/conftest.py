"""Shared fixtures for LapForge test suite."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures"

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from LapForge.config import AppConfig
from LapForge.session_store import SessionStore
from LapForge.models import CarDriver, Session, SessionType


@pytest.fixture
def tmp_data_root(tmp_path: Path) -> Path:
    d = tmp_path / "data"
    d.mkdir()
    return d


@pytest.fixture
def store(tmp_data_root: Path) -> SessionStore:
    return SessionStore(data_root=tmp_data_root)


@pytest.fixture
def app_config(tmp_path: Path):
    return AppConfig(path=tmp_path / "config.json")


@pytest.fixture
def sample_export_path() -> Path:
    return FIXTURES / "sample_export.txt"


@pytest.fixture
def sample_parsed(sample_export_path: Path) -> dict[str, Any]:
    from LapForge.parsers.pi_toolbox_export import load_pi_toolbox_export
    return load_pi_toolbox_export(sample_export_path)


@pytest.fixture
def sample_car_driver(store: SessionStore) -> CarDriver:
    return store.add_car_driver(car_identifier="911", driver_name="Test Driver")


@pytest.fixture
def sample_session(store: SessionStore, sample_car_driver: CarDriver, sample_parsed: dict) -> Session:
    from LapForge.processing import process_session, sanitize_for_json
    processed = process_session(sample_parsed)
    session = Session(
        id="test-session-1",
        car_driver_id=sample_car_driver.id,
        session_type=SessionType.PRACTICE_1,
        track="Test Track",
        driver="Test Driver",
        car="911",
        outing_number="1",
        session_number="2",
        target_pressure_psi=27.0,
        parsed_data=sanitize_for_json(processed),
    )
    store.add_session(session)
    return session


@pytest.fixture
def flask_app(tmp_data_root: Path, tmp_path: Path, monkeypatch):
    """Create a Flask test app with isolated data and config directories."""
    appdata_dir = tmp_path / "appdata"
    appdata_dir.mkdir()
    monkeypatch.setenv("APPDATA", str(appdata_dir))

    lapforge_dir = appdata_dir / "LapForge"
    lapforge_dir.mkdir()
    config_path = lapforge_dir / "config.json"
    config_path.write_text(
        json.dumps({"data_root": str(tmp_data_root)}), encoding="utf-8",
    )

    from LapForge.app import create_app
    app = create_app()
    app.config["TESTING"] = True

    spa_dir = Path(app.static_folder) / "spa"
    spa_dir.mkdir(parents=True, exist_ok=True)
    spa_index = spa_dir / "index.html"
    if not spa_index.exists():
        spa_index.write_text("<html><body>SPA</body></html>", encoding="utf-8")

    return app


@pytest.fixture
def client(flask_app):
    return flask_app.test_client()
