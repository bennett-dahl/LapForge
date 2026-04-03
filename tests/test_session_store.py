"""Tests for LapForge.session_store — CRUD for all entities, schema migration."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from LapForge.models import (
    CarDriver,
    SavedComparison,
    Session,
    SessionType,
    TireSet,
    TrackLayout,
    TrackSection,
    Weekend,
)
from LapForge.session_store import SessionStore


class TestSessionStoreInit:
    def test_creates_db_and_uploads(self, tmp_data_root):
        store = SessionStore(data_root=tmp_data_root)
        assert store.db_path.exists()
        assert store.uploads_dir.exists()

    def test_from_db_path(self, tmp_path):
        db = tmp_path / "custom.db"
        store = SessionStore(db_path=db)
        assert store.db_path == db
        assert store.data_root == tmp_path


class TestCarDriverCRUD:
    def test_add_and_get(self, store):
        cd = store.add_car_driver("911", "Alice")
        assert cd.car_identifier == "911"
        assert cd.driver_name == "Alice"
        assert len(cd.id) == 36  # UUID

        got = store.get_car_driver(cd.id)
        assert got is not None
        assert got.car_identifier == "911"

    def test_list(self, store):
        store.add_car_driver("911", "Alice")
        store.add_car_driver("718", "Bob")
        cds = store.list_car_drivers()
        assert len(cds) == 2
        assert cds[0].driver_name == "Alice"  # sorted by name

    def test_update(self, store):
        cd = store.add_car_driver("911", "Alice")
        cd.driver_name = "Updated"
        store.update_car_driver(cd)
        got = store.get_car_driver(cd.id)
        assert got.driver_name == "Updated"

    def test_delete(self, store):
        cd = store.add_car_driver("911", "Alice")
        store.delete_car_driver(cd.id)
        assert store.get_car_driver(cd.id) is None

    def test_get_nonexistent(self, store):
        assert store.get_car_driver("nonexistent") is None


class TestTireSetCRUD:
    def test_add_and_get(self, store):
        cd = store.add_car_driver("911", "Alice")
        ts = store.add_tire_set("Set A", car_driver_id=cd.id,
                                morning_pressures=(1.8, 1.9, 1.7, 1.75))
        assert ts.name == "Set A"
        assert ts.morning_pressure_fl == 1.8

        got = store.get_tire_set(ts.id)
        assert got.name == "Set A"
        assert got.morning_pressure_rr == 1.75

    def test_list_filtered(self, store):
        cd1 = store.add_car_driver("911", "Alice")
        cd2 = store.add_car_driver("718", "Bob")
        store.add_tire_set("Set A", car_driver_id=cd1.id)
        store.add_tire_set("Set B", car_driver_id=cd2.id)
        assert len(store.list_tire_sets(car_driver_id=cd1.id)) == 1
        assert len(store.list_tire_sets()) == 2

    def test_update(self, store):
        ts = store.add_tire_set("Old Name")
        ts.name = "New Name"
        ts.morning_pressure_fl = 2.0
        store.update_tire_set(ts)
        got = store.get_tire_set(ts.id)
        assert got.name == "New Name"
        assert got.morning_pressure_fl == 2.0

    def test_delete(self, store):
        ts = store.add_tire_set("Doomed")
        store.delete_tire_set(ts.id)
        assert store.get_tire_set(ts.id) is None


class TestSessionCRUD:
    def _make_session(self, store, car_driver_id: str, **kwargs) -> Session:
        defaults = {
            "id": None,
            "session_type": SessionType.PRACTICE_1,
            "track": "Test Track",
            "driver": "Test",
            "car": "911",
            "outing_number": "1",
            "session_number": "1",
        }
        defaults.update(kwargs)
        import uuid
        sid = defaults.pop("id") or str(uuid.uuid4())
        s = Session(id=sid, car_driver_id=car_driver_id, **defaults)
        return store.add_session(s)

    def test_add_and_get(self, store):
        cd = store.add_car_driver("911", "Alice")
        s = self._make_session(store, cd.id, track="Laguna Seca")
        got = store.get_session(s.id)
        assert got is not None
        assert got.track == "Laguna Seca"
        assert got.session_type is SessionType.PRACTICE_1

    def test_with_parsed_data(self, store, sample_parsed):
        from LapForge.processing import process_session, sanitize_for_json
        cd = store.add_car_driver("911", "Alice")
        processed = sanitize_for_json(process_session(sample_parsed))
        s = self._make_session(store, cd.id, parsed_data=processed)
        got = store.get_session(s.id)
        assert isinstance(got.parsed_data, dict)
        assert got.parsed_data.get("version") == 2

    def test_list(self, store):
        cd = store.add_car_driver("911", "Alice")
        self._make_session(store, cd.id, track="A")
        self._make_session(store, cd.id, track="B")
        sessions = store.list_sessions(car_driver_id=cd.id)
        assert len(sessions) == 2

    def test_update(self, store):
        cd = store.add_car_driver("911", "Alice")
        s = self._make_session(store, cd.id, track="Old")
        s.track = "New"
        s.target_pressure_psi = 26.0
        store.update_session(s)
        got = store.get_session(s.id)
        assert got.track == "New"
        assert got.target_pressure_psi == 26.0

    def test_delete(self, store):
        cd = store.add_car_driver("911", "Alice")
        s = self._make_session(store, cd.id)
        store.delete_session(s.id)
        assert store.get_session(s.id) is None


class TestWeekendCRUD:
    def test_add_and_get(self, store):
        cd = store.add_car_driver("911", "Alice")
        w = store.add_weekend(cd.id, "Spring 2024", session_ids=["s1", "s2"])
        got = store.get_weekend(w.id)
        assert got.name == "Spring 2024"
        assert got.session_ids == ["s1", "s2"]

    def test_list(self, store):
        cd = store.add_car_driver("911", "Alice")
        store.add_weekend(cd.id, "A")
        store.add_weekend(cd.id, "B")
        weekends = store.list_weekends(car_driver_id=cd.id)
        assert len(weekends) == 2


class TestSavedComparisonCRUD:
    def test_add_and_get(self, store):
        sc = store.add_saved_comparison("Comp 1", ["s1", "s2"])
        got = store.get_saved_comparison(sc.id)
        assert got.name == "Comp 1"
        assert got.session_ids == ["s1", "s2"]

    def test_update(self, store):
        sc = store.add_saved_comparison("Old", ["s1"])
        store.update_saved_comparison(sc.id, name="New", session_ids=["s1", "s2"])
        got = store.get_saved_comparison(sc.id)
        assert got.name == "New"
        assert got.session_ids == ["s1", "s2"]

    def test_delete(self, store):
        sc = store.add_saved_comparison("X", ["s1"])
        store.delete_saved_comparison(sc.id)
        assert store.get_saved_comparison(sc.id) is None

    def test_list(self, store):
        store.add_saved_comparison("A", ["s1"])
        store.add_saved_comparison("B", ["s2"])
        assert len(store.list_saved_comparisons()) == 2


class TestTrackSectionCRUD:
    def test_add_and_list(self, store):
        sec = TrackSection(id="s1", track_name="Test Track", name="Turn 1",
                           start_distance=100.0, end_distance=200.0)
        store.add_track_section(sec)
        sections = store.list_track_sections("Test Track")
        assert len(sections) == 1
        assert sections[0].name == "Turn 1"

    def test_normalize_track_key(self, store):
        sec = TrackSection(id="s1", track_name="  Test Track  ", name="T1",
                           start_distance=0, end_distance=50)
        store.add_track_section(sec)
        sections = store.list_track_sections("test track")
        assert len(sections) == 1

    def test_delete_sections(self, store):
        sec = TrackSection(id="s1", track_name="T", name="T1",
                           start_distance=0, end_distance=50, section_type="manual")
        store.add_track_section(sec)
        store.delete_track_sections("T", section_type="manual")
        assert len(store.list_track_sections("T")) == 0


class TestTrackLayoutCRUD:
    def test_add_and_get(self, store):
        ref = {"lat": [36.25], "lon": [-115.15], "distance": [0.0]}
        layout = store.add_track_layout("Main Layout", "Test Track", ref,
                                        source_session_id="s1", source_lap_index=2)
        got = store.get_track_layout_by_id(layout.id)
        assert got.name == "Main Layout"
        assert got.source_lap_index == 2

    def test_get_ref_dict(self, store):
        ref = {"lat": [36.25], "lon": [-115.15]}
        layout = store.add_track_layout("L", "T", ref)
        ref_got = store.get_track_layout_ref(layout.id)
        assert ref_got["lat"] == [36.25]

    def test_legacy_get_track_layout(self, store):
        ref = {"lat": [1.0]}
        store.add_track_layout("L", "test track", ref)
        got = store.get_track_layout("Test Track")
        assert got["lat"] == [1.0]

    def test_list(self, store):
        store.add_track_layout("A", "Track A", {"lat": []})
        store.add_track_layout("B", "Track B", {"lat": []})
        assert len(store.list_track_layouts()) == 2
        assert len(store.list_track_layouts("Track A")) == 1

    def test_upsert_updates_source_metadata(self, store):
        ref1 = {"lat": [1.0, 2.0], "lon": [1.0, 2.0], "lap_index": 0}
        layout = store.add_track_layout("L", "T", ref1, source_session_id="old-s", source_lap_index=0)
        ref2 = {"lat": [3.0, 4.0], "lon": [3.0, 4.0], "lap_index": 2}
        store.upsert_track_layout("T", ref2, source_session_id="new-s", source_lap_index=2)
        got = store.get_track_layout_by_id(layout.id)
        assert got.source_lap_index == 2
        assert got.source_session_id == "new-s"

    def test_delete_clears_session_reference(self, store):
        import uuid
        cd = store.add_car_driver("911", "Alice")
        layout = store.add_track_layout("L", "T", {"lat": []})
        s = Session(
            id=str(uuid.uuid4()), car_driver_id=cd.id,
            session_type=SessionType.PRACTICE_1,
            track="T", driver="A", car="911",
            outing_number="1", session_number="1",
            track_layout_id=layout.id,
        )
        store.add_session(s)
        store.delete_track_layout(layout.id)

        got = store.get_session(s.id)
        assert got.track_layout_id is None


class TestDashboardTemplates:
    def test_crud(self, store):
        tpl = store.add_dashboard_template("Default", [{"type": "chart", "w": 6}])
        assert tpl["name"] == "Default"
        assert len(store.list_dashboard_templates()) == 1

        store.update_dashboard_template(tpl["id"], name="Updated")
        got = store.get_dashboard_template(tpl["id"])
        assert got["name"] == "Updated"

        store.delete_dashboard_template(tpl["id"])
        assert store.get_dashboard_template(tpl["id"]) is None


class TestDashboardLayouts:
    def test_session_layout(self, store, sample_session):
        assert store.get_dashboard_layout(sample_session.id) is None
        layout = [{"type": "chart", "w": 12}]
        store.save_dashboard_layout(sample_session.id, layout)
        got = store.get_dashboard_layout(sample_session.id)
        assert got == layout

    def test_compare_layout(self, store):
        sc = store.add_saved_comparison("C", ["s1"])
        assert store.get_compare_dashboard_layout(sc.id) is None
        layout = [{"type": "overlay", "w": 12}]
        store.save_compare_dashboard_layout(sc.id, layout)
        got = store.get_compare_dashboard_layout(sc.id)
        assert got == layout


class TestResolveFilePath:
    def test_relative(self, store, tmp_data_root):
        path = store.resolve_file_path("uploads/test.txt")
        assert path == tmp_data_root / "uploads" / "test.txt"

    def test_absolute(self, store):
        import sys
        if sys.platform == "win32":
            abs_path = "C:\\some\\absolute\\path.txt"
        else:
            abs_path = "/some/absolute/path.txt"
        assert store.resolve_file_path(abs_path) == Path(abs_path)

    def test_none(self, store):
        assert store.resolve_file_path(None) is None

    def test_empty(self, store):
        assert store.resolve_file_path("") is None
