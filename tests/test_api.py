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


class TestIndexRoute:
    def test_index_returns_200(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        assert b"LapForge" in resp.data or resp.status_code == 200


class TestCarDriverRoutes:
    def test_list(self, client, flask_app):
        flask_app.store.add_car_driver("911", "Alice")
        resp = client.get("/car_drivers")
        assert resp.status_code == 200
        assert b"Alice" in resp.data

    def test_add_get(self, client):
        resp = client.get("/car_drivers/add")
        assert resp.status_code == 200

    def test_add_post(self, client, flask_app):
        resp = client.post("/car_drivers/add", data={
            "car_identifier": "718",
            "driver_name": "Bob",
        }, follow_redirects=True)
        assert resp.status_code == 200
        cds = flask_app.store.list_car_drivers()
        assert any(cd.driver_name == "Bob" for cd in cds)

    def test_edit(self, client, flask_app):
        cd = flask_app.store.add_car_driver("911", "Alice")
        resp = client.post(f"/car_drivers/{cd.id}/edit", data={
            "car_identifier": "911",
            "driver_name": "Updated",
        }, follow_redirects=True)
        assert resp.status_code == 200
        got = flask_app.store.get_car_driver(cd.id)
        assert got.driver_name == "Updated"

    def test_delete(self, client, flask_app):
        cd = flask_app.store.add_car_driver("911", "Alice")
        resp = client.post(f"/car_drivers/{cd.id}/delete", follow_redirects=True)
        assert resp.status_code == 200
        assert flask_app.store.get_car_driver(cd.id) is None


class TestTireSetRoutes:
    def test_list(self, client, flask_app):
        flask_app.store.add_tire_set("Set A")
        resp = client.get("/tire_sets")
        assert resp.status_code == 200

    def test_add_post(self, client, flask_app):
        cd = flask_app.store.add_car_driver("911", "Alice")
        resp = client.post("/tire_sets/add", data={
            "name": "New Set",
            "car_driver_id": cd.id,
            "pressure_unit": "bar",
        }, follow_redirects=True)
        assert resp.status_code == 200


class TestSessionRoutes:
    def test_list(self, loaded_client):
        client, store, cd, session = loaded_client
        resp = client.get("/sessions")
        assert resp.status_code == 200

    def test_detail(self, loaded_client):
        client, store, cd, session = loaded_client
        resp = client.get(f"/sessions/{session.id}")
        assert resp.status_code == 200
        assert b"Test Track" in resp.data

    def test_detail_unit_toggle(self, loaded_client):
        client, store, cd, session = loaded_client
        resp_psi = client.get(f"/sessions/{session.id}?unit=psi")
        assert resp_psi.status_code == 200
        resp_bar = client.get(f"/sessions/{session.id}?unit=bar")
        assert resp_bar.status_code == 200

    def test_edit(self, loaded_client):
        client, store, cd, session = loaded_client
        resp = client.post(f"/sessions/{session.id}/edit", data={
            "track": "Updated Track",
            "unit": "psi",
            "tool": "dashboard",
        }, follow_redirects=True)
        assert resp.status_code == 200
        got = store.get_session(session.id)
        assert got.track == "Updated Track"

    def test_delete(self, loaded_client):
        client, store, cd, session = loaded_client
        resp = client.post(f"/sessions/{session.id}/delete", follow_redirects=True)
        assert resp.status_code == 200
        assert store.get_session(session.id) is None

    def test_nonexistent_session_redirects(self, client):
        resp = client.get("/sessions/nonexistent", follow_redirects=False)
        assert resp.status_code == 302


class TestSettingsRoute:
    def test_get(self, client):
        resp = client.get("/settings")
        assert resp.status_code == 200

    def test_post(self, client):
        resp = client.post("/settings", data={
            "default_target_pressure_psi": "26.5",
            "default_temp_unit": "f",
            "default_pressure_unit": "bar",
            "default_distance_unit": "mi",
        }, follow_redirects=True)
        assert resp.status_code == 200


class TestUploadRoute:
    def test_get(self, client, flask_app):
        flask_app.store.add_car_driver("911", "Alice")
        resp = client.get("/upload")
        assert resp.status_code == 200

    def test_upload_file(self, client, flask_app):
        flask_app.store.add_car_driver("911", "Alice")
        sample = FIXTURES / "sample_export.txt"
        with open(sample, "rb") as f:
            resp = client.post("/upload", data={
                "file": (f, "sample_export.txt"),
            }, content_type="multipart/form-data")
        assert resp.status_code == 200
        assert b"Test Track" in resp.data or b"Test Driver" in resp.data

    def test_upload_wrong_extension(self, client, flask_app):
        flask_app.store.add_car_driver("911", "Alice")
        import io
        resp = client.post("/upload", data={
            "file": (io.BytesIO(b"data"), "bad.csv"),
        }, content_type="multipart/form-data")
        assert resp.status_code == 200
        assert b"must be .txt" in resp.data


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


class TestTrackLayoutAPI:
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


class TestCompareRoutes:
    def test_list(self, client):
        resp = client.get("/compare")
        assert resp.status_code == 200

    def test_create_via_api(self, loaded_client):
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

    def test_update_via_api(self, loaded_client):
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

    def test_delete_via_api(self, loaded_client):
        client, store, cd, session = loaded_client
        sc = store.add_saved_comparison("X", [session.id])
        resp = client.delete(f"/api/comparisons/{sc.id}")
        assert resp.status_code == 200

    def test_dashboard_view(self, loaded_client):
        client, store, cd, session = loaded_client
        sc = store.add_saved_comparison("Comp", [session.id])
        resp = client.get(f"/compare/{sc.id}")
        assert resp.status_code == 200


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


class TestSessionListAPI:
    def test_list(self, loaded_client):
        client, *_ = loaded_client
        resp = client.get("/api/sessions/list")
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data) >= 1
        assert "label" in data[0]


class TestSyncStatusAPI:
    def test_not_logged_in(self, client):
        resp = client.get("/api/sync/status")
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "not_logged_in"


class TestTrackLayoutPage:
    def test_list_page(self, client):
        resp = client.get("/track-layouts")
        assert resp.status_code == 200
