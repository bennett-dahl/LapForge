"""E2E test fixtures — starts a real Flask server for Playwright."""

from __future__ import annotations

import json
import shutil
import socket
import threading
import time
from pathlib import Path

import pytest

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def e2e_data_root(tmp_path_factory):
    d = tmp_path_factory.mktemp("e2e_data")
    return d


@pytest.fixture(scope="session")
def e2e_server(e2e_data_root, tmp_path_factory):
    """Start a Flask server in a background thread and return the base URL."""
    import os

    appdata_dir = tmp_path_factory.mktemp("e2e_appdata")
    os.environ["APPDATA"] = str(appdata_dir)

    lapforge_dir = appdata_dir / "LapForge"
    lapforge_dir.mkdir()
    config_path = lapforge_dir / "config.json"
    config_path.write_text(
        json.dumps({"data_root": str(e2e_data_root)}), encoding="utf-8",
    )

    from LapForge.app import create_app
    app = create_app()
    app.config["TESTING"] = False

    spa_index = Path(app.static_folder) / "spa" / "index.html"
    if not spa_index.exists():
        pytest.skip(
            "SPA not built — run 'cd frontend && npm run build:spa' first",
            allow_module_level=True,
        )

    port = _find_free_port()
    base_url = f"http://127.0.0.1:{port}"

    server_thread = threading.Thread(
        target=lambda: app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False),
        daemon=True,
    )
    server_thread.start()

    for _ in range(50):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                break
        except (ConnectionRefusedError, OSError):
            time.sleep(0.1)
    else:
        raise RuntimeError("Flask server did not start")

    yield base_url, app


@pytest.fixture(scope="session")
def browser_context(e2e_server):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        yield context
        context.close()
        browser.close()


@pytest.fixture
def page(browser_context):
    pg = browser_context.new_page()
    yield pg
    pg.close()


@pytest.fixture(scope="session")
def base_url(e2e_server):
    return e2e_server[0]


@pytest.fixture(scope="session")
def e2e_app(e2e_server):
    return e2e_server[1]


@pytest.fixture(scope="session", autouse=True)
def seed_data(e2e_server, e2e_data_root):
    """Seed the e2e database with a car-driver, upload, and session."""
    _, app = e2e_server
    store = app.store

    cd = store.add_car_driver("911", "E2E Driver")

    upload_src = FIXTURES / "sample_export.txt"
    dest = store.uploads_dir / "e2e-session.txt"
    shutil.copy2(upload_src, dest)

    from LapForge.parsers.pi_toolbox_export import load_pi_toolbox_export
    from LapForge.processing import process_session, sanitize_for_json
    from LapForge.models import Session, SessionType

    parsed = load_pi_toolbox_export(dest)
    processed = sanitize_for_json(process_session(parsed))

    session = Session(
        id="e2e-session-1",
        car_driver_id=cd.id,
        session_type=SessionType.PRACTICE_1,
        track="Test Track",
        driver="E2E Driver",
        car="911",
        outing_number="1",
        session_number="1",
        target_pressure_psi=27.0,
        file_path="uploads/e2e-session.txt",
        parsed_data=processed,
        created_at="2025-01-15T10:00:00Z",
    )
    store.add_session(session)
    return cd, session
