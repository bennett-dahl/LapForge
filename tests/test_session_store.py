"""Tests for LapForge.session_store — CRUD for all entities, schema migration."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from LapForge.models import (
    CarDriver,
    Plan,
    SavedComparison,
    Session,
    SessionType,
    Setup,
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
        s = self._make_session(store, cd.id, track="Laguna Seca",
                               weather_condition="Overcast")
        got = store.get_session(s.id)
        assert got is not None
        assert got.track == "Laguna Seca"
        assert got.session_type is SessionType.PRACTICE_1
        assert got.weather_condition == "Overcast"

    def test_created_at_auto_set(self, store):
        cd = store.add_car_driver("911", "Alice")
        s = self._make_session(store, cd.id)
        got = store.get_session(s.id)
        assert got.created_at, "created_at should be set automatically"
        assert "T" in got.created_at, "created_at should be ISO format"

    def test_created_at_in_list(self, store):
        cd = store.add_car_driver("911", "Alice")
        s = self._make_session(store, cd.id)
        sessions = store.list_sessions()
        assert sessions[0].created_at == store.get_session(s.id).created_at

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
        s.weather_condition = "Heavy Rain"
        store.update_session(s)
        got = store.get_session(s.id)
        assert got.track == "New"
        assert got.target_pressure_psi == 26.0
        assert got.weather_condition == "Heavy Rain"

    def test_planning_tag_and_bleed_events(self, store):
        cd = store.add_car_driver("911", "Alice")
        s = self._make_session(store, cd.id,
                               planning_tag="stabilization",
                               bleed_events=[{"corner": "fl", "psi_removed": 0.5}])
        got = store.get_session(s.id)
        assert got.planning_tag == "stabilization"
        assert len(got.bleed_events) == 1
        assert got.bleed_events[0]["corner"] == "fl"

    def test_delete(self, store):
        cd = store.add_car_driver("911", "Alice")
        s = self._make_session(store, cd.id)
        store.delete_session(s.id)
        assert store.get_session(s.id) is None

    def test_cleanup_orphan_uploads(self, store):
        cd = store.add_car_driver("911", "Alice")
        s = self._make_session(store, cd.id, file_path="uploads/keep.txt")
        # Create referenced and orphaned files
        (store.uploads_dir / "keep.txt").write_text("data")
        (store.uploads_dir / "orphan.txt").write_text("stale")
        removed = store.cleanup_orphan_uploads()
        assert "orphan.txt" in removed
        assert (store.uploads_dir / "keep.txt").exists()
        assert not (store.uploads_dir / "orphan.txt").exists()

    def test_cleanup_no_orphans(self, store):
        cd = store.add_car_driver("911", "Alice")
        s = self._make_session(store, cd.id, file_path="uploads/valid.txt")
        (store.uploads_dir / "valid.txt").write_text("data")
        removed = store.cleanup_orphan_uploads()
        assert removed == []
        assert (store.uploads_dir / "valid.txt").exists()

    def test_delete_cleans_plan_refs(self, store):
        cd = store.add_car_driver("911", "Alice")
        w = store.add_weekend("Spring")
        s = self._make_session(store, cd.id)
        p = store.add_plan(cd.id, w.id)
        store.update_plan(p.id, session_ids=[s.id],
                          checklist=[{"key": "stabilization", "session_ids": [s.id]}])
        affected = store.delete_session(s.id)
        assert len(affected) == 1
        got = store.get_plan(p.id)
        assert s.id not in got.session_ids
        assert s.id not in got.checklist[0]["session_ids"]


class TestWeekendCRUD:
    def test_add_and_get(self, store):
        w = store.add_weekend("Spring 2024", track="Laguna Seca",
                              date_start="2024-03-15", date_end="2024-03-17")
        got = store.get_weekend(w.id)
        assert got.name == "Spring 2024"
        assert got.track == "Laguna Seca"
        assert got.date_start == "2024-03-15"

    def test_list(self, store):
        store.add_weekend("A", date_start="2024-03-15")
        store.add_weekend("B", date_start="2024-04-15")
        weekends = store.list_weekends()
        assert len(weekends) == 2

    def test_update(self, store):
        w = store.add_weekend("Old", track="T1")
        updated = store.update_weekend(w.id, name="New", track="T2")
        assert updated.name == "New"
        assert updated.track == "T2"

    def test_delete_cascades_plans(self, store):
        cd = store.add_car_driver("911", "Alice")
        w = store.add_weekend("Spring")
        store.add_plan(cd.id, w.id)
        affected = store.delete_weekend(w.id)
        assert len(affected) == 1
        assert store.get_weekend(w.id) is None
        assert len(store.list_plans(weekend_id=w.id)) == 0


class TestPlanCRUD:
    def test_add_and_get(self, store):
        cd = store.add_car_driver("911", "Alice")
        w = store.add_weekend("Spring")
        p = store.add_plan(cd.id, w.id)
        got = store.get_plan(p.id)
        assert got is not None
        assert got.car_driver_id == cd.id
        assert got.weekend_id == w.id
        assert got.planning_mode == "both"
        assert len(got.checklist) == 7  # default checklist steps
        assert got.notes == ""

    def test_get_for_car_weekend(self, store):
        cd = store.add_car_driver("911", "Alice")
        w = store.add_weekend("Spring")
        p = store.add_plan(cd.id, w.id)
        got = store.get_plan_for_car_weekend(cd.id, w.id)
        assert got is not None
        assert got.id == p.id

    def test_list_by_weekend(self, store):
        cd1 = store.add_car_driver("911", "Alice")
        cd2 = store.add_car_driver("718", "Bob")
        w = store.add_weekend("Spring")
        store.add_plan(cd1.id, w.id)
        store.add_plan(cd2.id, w.id)
        plans = store.list_plans(weekend_id=w.id)
        assert len(plans) == 2

    def test_update(self, store):
        cd = store.add_car_driver("911", "Alice")
        w = store.add_weekend("Spring")
        p = store.add_plan(cd.id, w.id)
        updated = store.update_plan(p.id,
                                    planning_mode="qual",
                                    session_ids=["s1", "s2"],
                                    qual_plan={"fl": 24.5},
                                    pressure_band_psi=0.3,
                                    current_weather_condition="Med Rain")
        assert updated.planning_mode == "qual"
        assert updated.session_ids == ["s1", "s2"]
        assert updated.qual_plan["fl"] == 24.5
        assert updated.pressure_band_psi == 0.3
        assert updated.current_weather_condition == "Med Rain"

    def test_plan_notes_persist(self, store):
        cd = store.add_car_driver("911", "Alice")
        w = store.add_weekend("Spring")
        p = store.add_plan(cd.id, w.id)
        text = "Stint 3: watch rears"
        updated = store.update_plan(p.id, notes=text)
        assert updated is not None
        assert updated.notes == text
        again = store.get_plan(p.id)
        assert again is not None
        assert again.notes == text

    def test_delete(self, store):
        cd = store.add_car_driver("911", "Alice")
        w = store.add_weekend("Spring")
        p = store.add_plan(cd.id, w.id)
        store.delete_plan(p.id)
        assert store.get_plan(p.id) is None

    def test_unique_constraint(self, store):
        cd = store.add_car_driver("911", "Alice")
        w = store.add_weekend("Spring")
        store.add_plan(cd.id, w.id)
        import sqlite3
        with pytest.raises(sqlite3.IntegrityError):
            store.add_plan(cd.id, w.id)


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


class TestSetupCRUD:
    def test_setup_crud(self, store):
        cd = store.add_car_driver("911", "Alice")
        w = store.add_weekend("Spring")
        s = store.add_setup(
            car_driver_id=cd.id,
            name="Race setup",
            data={"before": {"fl": {"camber": -3.2}}},
            weekend_id=w.id,
            session_id=None,
        )
        assert len(s.id) == 36
        assert s.name == "Race setup"
        assert s.car_driver_id == cd.id
        assert s.weekend_id == w.id
        assert s.data["before"]["fl"]["camber"] == -3.2
        assert s.created_at
        assert s.updated_at

        got = store.get_setup(s.id)
        assert got is not None
        assert got.name == "Race setup"
        assert got.data["before"]["fl"]["camber"] == -3.2

        all_setups = store.list_setups()
        assert len(all_setups) == 1

        updated = store.update_setup(s.id, name="Updated", data={"after": {"fl": {"camber": -3.0}}}, session_id="fake-sid")
        assert updated.name == "Updated"
        assert updated.data["after"]["fl"]["camber"] == -3.0
        assert updated.session_id == "fake-sid"
        assert updated.updated_at > s.updated_at

        store.delete_setup(s.id)
        assert store.get_setup(s.id) is None

    def test_list_setups_filtered(self, store):
        cd1 = store.add_car_driver("911", "Alice")
        cd2 = store.add_car_driver("718", "Bob")
        w = store.add_weekend("Spring")
        import time
        store.add_setup(car_driver_id=cd1.id, name="A", weekend_id=w.id)
        time.sleep(0.01)
        store.add_setup(car_driver_id=cd1.id, name="B")
        store.add_setup(car_driver_id=cd2.id, name="C")

        by_cd1 = store.list_setups(car_driver_id=cd1.id)
        assert len(by_cd1) == 2
        assert by_cd1[0].name == "B"  # created_at DESC

        by_weekend = store.list_setups(weekend_id=w.id)
        assert len(by_weekend) == 1
        assert by_weekend[0].name == "A"

    def test_delete_setup_scrubs_checklist(self, store):
        cd = store.add_car_driver("911", "Alice")
        w = store.add_weekend("Spring")
        s = store.add_setup(car_driver_id=cd.id)
        p = store.add_plan(cd.id, w.id)
        checklist = p.checklist
        checklist[0]["setup_ids"] = [s.id]
        store.update_plan(p.id, checklist=checklist)

        store.delete_setup(s.id)
        got = store.get_plan(p.id)
        assert s.id not in got.checklist[0].get("setup_ids", [])

    def test_checklist_normalization_adds_setup_ids(self, store):
        cd = store.add_car_driver("911", "Alice")
        w = store.add_weekend("Spring")
        p = store.add_plan(cd.id, w.id)
        with store._conn() as c:
            old_checklist = [{"key": "baseline", "label": "Baseline", "required": True, "status": "not_started", "session_ids": [], "notes": ""}]
            c.execute("UPDATE plans SET checklist_json = ? WHERE id = ?",
                      (json.dumps(old_checklist), p.id))
        got = store.get_plan(p.id)
        for step in got.checklist:
            assert "setup_ids" in step
            assert step["setup_ids"] == []

    def test_fork_setup_uses_after(self, store):
        cd = store.add_car_driver("911", "Alice")
        source = store.add_setup(
            car_driver_id=cd.id,
            name="Original",
            data={"before": {"fl": {"camber": -3.0}}, "after": {"fl": {"camber": -2.8}}},
        )
        fork = store.fork_setup(source.id)
        assert fork is not None
        assert fork.parent_id == source.id
        assert fork.car_driver_id == cd.id
        assert fork.data.get("before") == {"fl": {"camber": -2.8}}
        assert "after" not in fork.data
        assert fork.name == "Original"

    def test_fork_setup_falls_back_to_before(self, store):
        cd = store.add_car_driver("911", "Alice")
        source = store.add_setup(
            car_driver_id=cd.id,
            data={"before": {"fl": {"camber": -3.0}}},
        )
        fork = store.fork_setup(source.id)
        assert fork.data.get("before") == {"fl": {"camber": -3.0}}

    def test_fork_setup_empty_source(self, store):
        cd = store.add_car_driver("911", "Alice")
        source = store.add_setup(car_driver_id=cd.id, data={})
        fork = store.fork_setup(source.id)
        assert fork.data.get("before") == {}

    def test_fork_setup_source_not_found(self, store):
        result = store.fork_setup("nonexistent-id")
        assert result is None

    def test_fork_setup_inherits_name(self, store):
        cd = store.add_car_driver("911", "Alice")
        source = store.add_setup(car_driver_id=cd.id, name="My Setup")
        fork = store.fork_setup(source.id)
        assert fork.name == "My Setup"

    def test_delete_weekend_nullifies_setup_weekend_id(self, store):
        cd = store.add_car_driver("911", "Alice")
        w = store.add_weekend("Spring")
        s = store.add_setup(car_driver_id=cd.id, weekend_id=w.id)
        store.delete_weekend(w.id)
        got = store.get_setup(s.id)
        assert got is not None
        assert got.weekend_id is None

    def test_delete_session_nullifies_setup_session_id(self, store):
        import uuid
        cd = store.add_car_driver("911", "Alice")
        sess = Session(
            id=str(uuid.uuid4()), car_driver_id=cd.id,
            session_type=SessionType.PRACTICE_1,
            track="T", driver="A", car="911",
            outing_number="1", session_number="1",
        )
        store.add_session(sess)
        s = store.add_setup(car_driver_id=cd.id, session_id=sess.id)
        store.delete_session(sess.id)
        got = store.get_setup(s.id)
        assert got is not None
        assert got.session_id is None


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
