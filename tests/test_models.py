"""Tests for LapForge.models — dataclass construction, serialization, edge cases."""

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


class TestSessionType:
    def test_values(self):
        assert SessionType.PRACTICE_1.value == "Practice 1"
        assert SessionType.QUALIFYING.value == "Qualifying"
        assert SessionType.RACE_2.value == "Race 2"

    def test_from_string(self):
        assert SessionType("Practice 1") is SessionType.PRACTICE_1
        assert SessionType("Race 1") is SessionType.RACE_1


class TestCarDriver:
    def test_construction(self):
        cd = CarDriver(id="1", car_identifier="911", driver_name="Alice")
        assert cd.id == "1"
        assert cd.car_identifier == "911"
        assert cd.driver_name == "Alice"

    def test_display_name(self):
        cd = CarDriver(id="1", car_identifier="42", driver_name="Bob")
        assert cd.display_name() == "42 / Bob"

    def test_round_trip(self):
        cd = CarDriver(id="x", car_identifier="7", driver_name="Eve")
        d = cd.to_dict()
        cd2 = CarDriver.from_dict(d)
        assert cd2.id == cd.id
        assert cd2.car_identifier == cd.car_identifier
        assert cd2.driver_name == cd.driver_name

    def test_from_dict_missing_fields(self):
        cd = CarDriver.from_dict({"id": "1"})
        assert cd.car_identifier == ""
        assert cd.driver_name == ""


class TestTireSet:
    def test_round_trip(self):
        ts = TireSet(
            id="t1", name="Set A", car_driver_id="cd1",
            morning_pressure_fl=1.8, morning_pressure_fr=1.9,
            morning_pressure_rl=1.7, morning_pressure_rr=1.75,
        )
        d = ts.to_dict()
        ts2 = TireSet.from_dict(d)
        assert ts2.name == "Set A"
        assert ts2.morning_pressure_fl == 1.8
        assert ts2.car_driver_id == "cd1"

    def test_defaults_none(self):
        ts = TireSet(id="t2", name="Bare")
        assert ts.car_driver_id is None
        assert ts.morning_pressure_fl is None


class TestSession:
    def test_round_trip(self):
        s = Session(
            id="s1", car_driver_id="cd1", session_type=SessionType.QUALIFYING,
            track="Laguna Seca", driver="Test", car="911",
            outing_number="1", session_number="3",
            ambient_temp_c=25.0, target_pressure_psi=27.0,
        )
        d = s.to_dict()
        assert d["session_type"] == "Qualifying"
        s2 = Session.from_dict(d)
        assert s2.session_type is SessionType.QUALIFYING
        assert s2.target_pressure_psi == 27.0

    def test_from_dict_defaults(self):
        s = Session.from_dict({
            "id": "s2", "car_driver_id": "cd1",
        })
        assert s.session_type is SessionType.PRACTICE_1
        assert s.track == ""
        assert s.parsed_data is None


class TestWeekend:
    def test_round_trip(self):
        w = Weekend(id="w1", car_driver_id="cd1", name="Spring 2024",
                    session_ids=["s1", "s2"])
        d = w.to_dict()
        w2 = Weekend.from_dict(d)
        assert w2.session_ids == ["s1", "s2"]

    def test_empty_sessions(self):
        w = Weekend.from_dict({"id": "w2", "car_driver_id": "cd1", "name": "Empty"})
        assert w.session_ids == []


class TestTrackSection:
    def test_round_trip(self):
        ts = TrackSection(
            id="sec1", track_name="Laguna Seca", name="Turn 1",
            start_distance=100.0, end_distance=200.0,
            section_type="manual", sort_order=0, corner_group=1,
        )
        d = ts.to_dict()
        assert d["corner_group"] == 1
        ts2 = TrackSection.from_dict(d)
        assert ts2.corner_group == 1

    def test_corner_group_none(self):
        d = {"id": "sec2", "track_name": "t", "name": "S",
             "start_distance": 0, "end_distance": 50}
        ts = TrackSection.from_dict(d)
        assert ts.corner_group is None

    def test_cornerGroup_alias(self):
        d = {"id": "sec3", "track_name": "t", "name": "S",
             "start_distance": 0, "end_distance": 50, "cornerGroup": 3}
        ts = TrackSection.from_dict(d)
        assert ts.corner_group == 3


class TestTrackLayout:
    def test_round_trip(self):
        tl = TrackLayout(
            id="tl1", name="Main", track_name="Laguna Seca",
            source_session_id="s1", source_lap_index=2,
            reference_lap_json='{"lat":[1]}', created_at="2024-01-01",
        )
        d = tl.to_dict()
        assert "reference_lap_json" not in d
        tl2 = TrackLayout.from_dict(d)
        assert tl2.source_lap_index == 2


class TestSavedComparison:
    def test_round_trip(self):
        sc = SavedComparison(id="c1", name="Compare A", session_ids=["s1", "s2"])
        d = sc.to_dict()
        sc2 = SavedComparison.from_dict(d)
        assert sc2.name == "Compare A"
        assert sc2.session_ids == ["s1", "s2"]
