"""API / integration tests — Flask test client against all route groups."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

FIXTURES = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture
def loaded_client(flask_app, tmp_data_root):
    """Client with a pre-loaded car-driver, session, and sample data."""
    import uuid as _uuid
    store = flask_app.store
    cd = store.add_car_driver("911", "Test Driver")

    session_id = str(_uuid.uuid4())
    upload_file = FIXTURES / "sample_export.txt"
    dest = store.uploads_dir / f"{session_id}.txt"
    shutil.copy2(upload_file, dest)

    from LapForge.parsers.pi_toolbox_export import load_pi_toolbox_export
    from LapForge.processing import process_session, sanitize_for_json
    from LapForge.models import Session, SessionType

    parsed = load_pi_toolbox_export(dest)
    processed = sanitize_for_json(process_session(parsed))
    session = Session(
        id=session_id,
        car_driver_id=cd.id,
        session_type=SessionType.PRACTICE_1,
        track="Test Track",
        driver="Test Driver",
        car="911",
        outing_number="1",
        session_number="2",
        target_pressure_psi=27.0,
        file_path=f"uploads/{session_id}.txt",
        parsed_data=processed,
    )
    store.add_session(session)
    return flask_app.test_client(), store, cd, session


# ---------------------------------------------------------------------------
# Page routes — SPA serves index.html for all page paths
# ---------------------------------------------------------------------------

class TestPageRoutes:
    """All page routes now return the SPA shell (200) or 404 if SPA not built."""

    @pytest.fixture(autouse=True)
    def _ensure_spa_index(self, flask_app):
        spa_dir = Path(flask_app.static_folder) / "spa"
        spa_dir.mkdir(parents=True, exist_ok=True)
        index = spa_dir / "index.html"
        if not index.exists():
            index.write_text("<html><body>SPA</body></html>", encoding="utf-8")

    def test_index(self, client):
        assert client.get("/").status_code == 200

    def test_settings(self, client):
        assert client.get("/settings").status_code == 200

    def test_car_drivers(self, client):
        assert client.get("/car-drivers").status_code == 200

    def test_car_drivers_legacy_url(self, client):
        assert client.get("/car_drivers").status_code == 200

    def test_tire_sets(self, client):
        assert client.get("/tire-sets").status_code == 200

    def test_sessions(self, client):
        assert client.get("/sessions").status_code == 200

    def test_session_detail(self, loaded_client):
        client, _, _, session = loaded_client
        assert client.get(f"/sessions/{session.id}").status_code == 200

    def test_upload(self, client):
        assert client.get("/upload").status_code == 200

    def test_compare(self, client):
        assert client.get("/compare").status_code == 200

    def test_compare_detail(self, loaded_client):
        client, store, _, session = loaded_client
        sc = store.add_saved_comparison("C", [session.id])
        assert client.get(f"/compare/{sc.id}").status_code == 200

    def test_track_layouts(self, client):
        assert client.get("/track-layouts").status_code == 200


# ---------------------------------------------------------------------------
# Car/Driver JSON API
# ---------------------------------------------------------------------------

class TestCarDriverAPI:
    def test_list(self, client, flask_app):
        flask_app.store.add_car_driver("911", "Alice")
        resp = client.get("/api/car-drivers")
        assert resp.status_code == 200
        data = resp.get_json()
        assert any(cd["driver_name"] == "Alice" for cd in data)

    def test_create(self, client):
        resp = client.post(
            "/api/car-drivers",
            data=json.dumps({"car_identifier": "718", "driver_name": "Bob"}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["car_driver"]["driver_name"] == "Bob"

    def test_create_validation(self, client):
        resp = client.post(
            "/api/car-drivers",
            data=json.dumps({"car_identifier": "", "driver_name": ""}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_update(self, client, flask_app):
        cd = flask_app.store.add_car_driver("911", "Alice")
        resp = client.patch(
            f"/api/car-drivers/{cd.id}",
            data=json.dumps({"driver_name": "Updated"}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        got = flask_app.store.get_car_driver(cd.id)
        assert got.driver_name == "Updated"

    def test_update_not_found(self, client):
        resp = client.patch(
            "/api/car-drivers/nonexistent",
            data=json.dumps({"driver_name": "X"}),
            content_type="application/json",
        )
        assert resp.status_code == 404

    def test_delete(self, client, flask_app):
        cd = flask_app.store.add_car_driver("911", "Alice")
        resp = client.delete(f"/api/car-drivers/{cd.id}")
        assert resp.status_code == 200
        assert flask_app.store.get_car_driver(cd.id) is None


# ---------------------------------------------------------------------------
# Tire Set JSON API
# ---------------------------------------------------------------------------

class TestTireSetAPI:
    def test_list(self, client, flask_app):
        flask_app.store.add_tire_set("Set A")
        resp = client.get("/api/tire-sets")
        assert resp.status_code == 200
        data = resp.get_json()
        assert any(ts["name"] == "Set A" for ts in data)

    def test_list_filtered(self, client, flask_app):
        cd = flask_app.store.add_car_driver("911", "Alice")
        flask_app.store.add_tire_set("Scoped", car_driver_id=cd.id)
        flask_app.store.add_tire_set("Global")
        resp = client.get(f"/api/tire-sets?car_driver_id={cd.id}")
        data = resp.get_json()
        assert len(data) >= 1

    def test_create(self, client, flask_app):
        cd = flask_app.store.add_car_driver("911", "Alice")
        resp = client.post(
            "/api/tire-sets",
            data=json.dumps({"name": "New Set", "car_driver_id": cd.id}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["tire_set"]["name"] == "New Set"

    def test_create_validation(self, client):
        resp = client.post(
            "/api/tire-sets",
            data=json.dumps({"name": ""}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_update(self, client, flask_app):
        ts = flask_app.store.add_tire_set("Old")
        resp = client.patch(
            f"/api/tire-sets/{ts.id}",
            data=json.dumps({"name": "Renamed"}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        got = flask_app.store.get_tire_set(ts.id)
        assert got.name == "Renamed"

    def test_delete(self, client, flask_app):
        ts = flask_app.store.add_tire_set("Del")
        resp = client.delete(f"/api/tire-sets/{ts.id}")
        assert resp.status_code == 200
        assert flask_app.store.get_tire_set(ts.id) is None


# ---------------------------------------------------------------------------
# Session JSON APIs
# ---------------------------------------------------------------------------

class TestSessionAPI:
    def test_sessions_full(self, loaded_client):
        client, *_ = loaded_client
        resp = client.get("/api/sessions-full")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "sessions" in data
        assert "car_drivers" in data
        assert len(data["sessions"]) >= 1

    def test_session_detail(self, loaded_client):
        client, _, _, session = loaded_client
        resp = client.get(f"/api/sessions/{session.id}/detail")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["session"]["track"] == "Test Track"
        assert "dashboard_data" in data
        assert "car_driver" in data
        assert data["is_v2"] is True

    def test_session_detail_not_found(self, client):
        resp = client.get("/api/sessions/nonexistent/detail")
        assert resp.status_code == 404

    def test_session_update(self, loaded_client):
        client, store, _, session = loaded_client
        resp = client.patch(
            f"/api/sessions/{session.id}",
            data=json.dumps({"ambient_temp_c": 25.0, "lap_count_notes": "Good grip"}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        got = store.get_session(session.id)
        assert got.ambient_temp_c == 25.0
        assert got.lap_count_notes == "Good grip"

    def test_session_patch_excluded_laps_on_main_route(self, loaded_client):
        client, store, _, session = loaded_client
        resp = client.patch(
            f"/api/sessions/{session.id}",
            data=json.dumps({"excluded_laps": [0, 2]}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get("ok") is True
        assert data.get("excluded_laps") == [0, 2]
        pd = store.get_session(session.id).parsed_data
        assert isinstance(pd, dict)
        assert pd.get("excluded_laps") == [0, 2]

    def test_session_patch_apply_reference_lap_index(self, loaded_client):
        client, store, _, session = loaded_client
        pd = session.parsed_data
        if not isinstance(pd, dict) or not pd.get("lap_splits"):
            pytest.skip("fixture session missing lap_splits")
        resp = client.patch(
            f"/api/sessions/{session.id}",
            data=json.dumps({"apply_reference_lap_index": 0}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get("ok") is True
        assert data.get("reference_lap_index") == 0
        assert data.get("reference_lap") is not None
        updated = store.get_session(session.id)
        assert isinstance(updated.parsed_data, dict)
        assert updated.parsed_data.get("map_lap_segment_index") == 0
        assert updated.track_layout_id
        layouts = store.list_track_layouts(session.track)
        assert any(l.id == updated.track_layout_id for l in layouts)

    def test_session_detail_dashboard_merges_track_layout_reference(self, loaded_client):
        """When session blob has no usable reference_lap, use track layout geometry."""
        from pathlib import Path

        from LapForge.models import Session, SessionType
        from LapForge.parsers.pi_toolbox_export import load_pi_toolbox_export
        from LapForge.processing import process_session, sanitize_for_json

        client, store, cd, _session = loaded_client
        fixtures = Path(__file__).resolve().parent / "fixtures"
        parsed = load_pi_toolbox_export(fixtures / "sample_export.txt")
        proc = sanitize_for_json(process_session(parsed))
        proc["reference_lap"] = {}
        sid = "sess-merge-ref-layout"
        s2 = Session(
            id=sid,
            car_driver_id=cd.id,
            session_type=SessionType.PRACTICE_1,
            track="MergeTrack",
            driver="Test Driver",
            car="911",
            outing_number="1",
            session_number="9",
            target_pressure_psi=27.0,
            parsed_data=proc,
        )
        store.add_session(s2)
        ref = {
            "lat": [36.0, 36.1],
            "lon": [-115.0, -115.1],
            "distance": [0.0, 50.0],
            "lap_index": 0,
        }
        store.add_track_layout("L", "MergeTrack", ref)
        resp = client.get(f"/api/sessions/{sid}/detail")
        assert resp.status_code == 200
        dd = resp.get_json().get("dashboard_data") or {}
        assert len(dd.get("points") or []) >= 2

    def test_session_delete(self, loaded_client):
        client, store, _, session = loaded_client
        resp = client.delete(f"/api/sessions/{session.id}")
        assert resp.status_code == 200
        assert store.get_session(session.id) is None

    def test_session_delete_not_found(self, client):
        resp = client.delete("/api/sessions/nonexistent")
        assert resp.status_code == 404

    def test_legacy_edit_route(self, loaded_client):
        client, store, _, session = loaded_client
        resp = client.post(f"/sessions/{session.id}/edit", data={
            "track": "Updated Track",
            "unit": "psi",
            "tool": "dashboard",
        }, follow_redirects=True)
        assert resp.status_code == 200

    def test_legacy_delete_route(self, loaded_client):
        client, store, _, session = loaded_client
        resp = client.post(f"/sessions/{session.id}/delete", follow_redirects=True)
        assert resp.status_code == 200
        assert store.get_session(session.id) is None


# ---------------------------------------------------------------------------
# Settings JSON API
# ---------------------------------------------------------------------------

class TestSettingsAPI:
    def test_get(self, client):
        resp = client.get("/api/settings")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "preferences" in data
        assert "data_root" in data
        assert "oauth_enabled" in data

    def test_update(self, client):
        resp = client.patch(
            "/api/settings",
            data=json.dumps({
                "default_target_pressure_psi": 26.5,
                "default_temp_unit": "F",
                "default_pressure_unit": "bar",
            }),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True

        resp = client.get("/api/settings")
        prefs = resp.get_json()["preferences"]
        assert prefs["default_target_pressure_psi"] == 26.5


# ---------------------------------------------------------------------------
# Auth API
# ---------------------------------------------------------------------------

class TestAuthAPI:
    def test_auth_user(self, client):
        resp = client.get("/api/auth/user")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "user" in data
        assert "oauth_enabled" in data


# ---------------------------------------------------------------------------
# Upload (JSON responses)
# ---------------------------------------------------------------------------

class TestUploadAPI:
    def test_upload_file(self, client, flask_app):
        flask_app.store.add_car_driver("911", "Alice")
        sample = FIXTURES / "sample_export.txt"
        with open(sample, "rb") as f:
            resp = client.post("/upload", data={
                "file": (f, "sample_export.txt"),
            }, content_type="multipart/form-data")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["parsed"] is True
        assert "metadata" in data
        assert "upload_path" in data

    def test_upload_wrong_extension(self, client, flask_app):
        flask_app.store.add_car_driver("911", "Alice")
        import io
        resp = client.post("/upload", data={
            "file": (io.BytesIO(b"data"), "bad.csv"),
        }, content_type="multipart/form-data")
        assert resp.status_code == 400
        data = resp.get_json()
        assert "must be .txt" in data["error"]

    def test_upload_no_file(self, client):
        resp = client.post("/upload", data={}, content_type="multipart/form-data")
        assert resp.status_code == 400
        data = resp.get_json()
        assert "error" in data


# ---------------------------------------------------------------------------
# Track Layout JSON API
# ---------------------------------------------------------------------------

class TestTrackLayoutAPI:
    def test_list(self, client):
        resp = client.get("/api/track-layouts")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "layouts" in data
        assert "session_map" in data

    def test_create(self, loaded_client):
        client, store, cd, session = loaded_client
        resp = client.post(
            "/api/track-layouts",
            data=json.dumps({
                "name": "Main Layout",
                "source_session_id": session.id,
            }),
            content_type="application/json",
        )
        assert resp.status_code == 200

    def test_delete(self, loaded_client):
        client, store, cd, session = loaded_client
        layout = store.add_track_layout("L", "T", {"lat": []})
        resp = client.delete(f"/api/track-layouts/{layout.id}")
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Section API
# ---------------------------------------------------------------------------

class TestSectionAPI:
    def test_list_empty(self, loaded_client):
        client, *_ = loaded_client
        resp = client.get("/api/sections/Test%20Track")
        assert resp.status_code == 200
        assert resp.get_json() == []

    def test_save_and_list(self, loaded_client):
        client, store, cd, session = loaded_client
        payload = {
            "sections": [
                {"name": "Turn 1", "start_distance": 100, "end_distance": 200,
                 "section_type": "manual"},
            ],
        }
        resp = client.post(
            "/api/sections/Test%20Track",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert len(data["sections"]) == 1

        sections = client.get("/api/sections/Test%20Track").get_json()
        assert len(sections) == 1


# ---------------------------------------------------------------------------
# Compare API
# ---------------------------------------------------------------------------

class TestCompareAPI:
    def test_list(self, client):
        resp = client.get("/api/comparisons")
        assert resp.status_code == 200
        assert isinstance(resp.get_json(), list)

    def test_create(self, loaded_client):
        client, store, cd, session = loaded_client
        resp = client.post(
            "/api/comparisons",
            data=json.dumps({"name": "Test Comp", "session_ids": [session.id]}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert "id" in data

    def test_update(self, loaded_client):
        client, store, cd, session = loaded_client
        sc = store.add_saved_comparison("Old", [session.id])
        resp = client.patch(
            f"/api/comparisons/{sc.id}",
            data=json.dumps({"name": "New"}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        got = store.get_saved_comparison(sc.id)
        assert got.name == "New"

    def test_delete(self, loaded_client):
        client, store, cd, session = loaded_client
        sc = store.add_saved_comparison("X", [session.id])
        resp = client.delete(f"/api/comparisons/{sc.id}")
        assert resp.status_code == 200

    def test_dashboard_data(self, loaded_client):
        client, store, _, session = loaded_client
        sc = store.add_saved_comparison("Comp", [session.id])
        resp = client.get(f"/api/comparisons/{sc.id}/dashboard-data")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "comparison_id" in data
        assert "sessions" in data


# ---------------------------------------------------------------------------
# Dashboard Template API
# ---------------------------------------------------------------------------

class TestDashboardTemplateAPI:
    def test_crud(self, client, flask_app):
        resp = client.get("/api/dashboard-templates")
        assert resp.status_code == 200
        before_count = len(resp.get_json())

        resp = client.post(
            "/api/dashboard-templates",
            data=json.dumps({"name": "TestTemplate", "layout": [{"type": "chart"}]}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        tid = resp.get_json()["id"]

        resp = client.get("/api/dashboard-templates")
        assert resp.status_code == 200
        assert len(resp.get_json()) == before_count + 1

        resp = client.patch(
            f"/api/dashboard-templates/{tid}",
            data=json.dumps({"name": "Updated"}),
            content_type="application/json",
        )
        assert resp.status_code == 200

        resp = client.delete(f"/api/dashboard-templates/{tid}")
        assert resp.status_code == 200

        resp = client.get("/api/dashboard-templates")
        assert len(resp.get_json()) == before_count


# ---------------------------------------------------------------------------
# Dashboard Layout API
# ---------------------------------------------------------------------------

class TestDashboardLayoutAPI:
    def test_session_layout_save_and_get(self, loaded_client):
        client, store, cd, session = loaded_client
        resp = client.get(f"/api/sessions/{session.id}/dashboard-layout")
        assert resp.status_code == 200
        assert resp.get_json()["layout"] is None

        layout = [{"type": "chart", "w": 12}]
        resp = client.put(
            f"/api/sessions/{session.id}/dashboard-layout",
            data=json.dumps({"layout": layout}),
            content_type="application/json",
        )
        assert resp.status_code == 200

        resp = client.get(f"/api/sessions/{session.id}/dashboard-layout")
        assert resp.get_json()["layout"] == layout

    def test_compare_layout(self, loaded_client):
        client, store, cd, session = loaded_client
        sc = store.add_saved_comparison("C", [session.id])

        layout = [{"type": "overlay"}]
        resp = client.put(
            f"/api/comparisons/{sc.id}/dashboard-layout",
            data=json.dumps({"layout": layout}),
            content_type="application/json",
        )
        assert resp.status_code == 200

        resp = client.get(f"/api/comparisons/{sc.id}/dashboard-layout")
        assert resp.get_json()["layout"] == layout


# ---------------------------------------------------------------------------
# Session List API (lightweight)
# ---------------------------------------------------------------------------

class TestSessionListAPI:
    def test_list(self, loaded_client):
        client, *_ = loaded_client
        resp = client.get("/api/sessions/list")
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data) >= 1
        assert "label" in data[0]


# ---------------------------------------------------------------------------
# Sync Status API
# ---------------------------------------------------------------------------

class TestSyncStatusAPI:
    def test_not_logged_in(self, client):
        resp = client.get("/api/sync/status")
        assert resp.status_code == 200
        assert resp.get_json()["status"] in ("not_logged_in", "oauth_not_configured")
