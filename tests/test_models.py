"""Tests for LapForge.models — dataclass construction, serialization, edge cases."""

from LapForge.models import (
    CarDriver,
    Plan,
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
            weather_condition="Light Rain",
        )
        d = s.to_dict()
        assert d["session_type"] == "Qualifying"
        assert d["weather_condition"] == "Light Rain"
        s2 = Session.from_dict(d)
        assert s2.session_type is SessionType.QUALIFYING
        assert s2.target_pressure_psi == 27.0
        assert s2.weather_condition == "Light Rain"

    def test_from_dict_defaults(self):
        s = Session.from_dict({
            "id": "s2", "car_driver_id": "cd1",
        })
        assert s.session_type is SessionType.PRACTICE_1
        assert s.track == ""
        assert s.parsed_data is None
        assert s.planning_tag is None
        assert s.bleed_events == []
        assert s.weather_condition is None

    def test_bleed_events_round_trip(self):
        s = Session(
            id="s3", car_driver_id="cd1", session_type=SessionType.PRACTICE_1,
            track="T", driver="D", car="C", outing_number="1", session_number="1",
            bleed_events=[{"corner": "fl", "psi_removed": 0.5, "bleed_type": "hot"}],
            planning_tag="stabilization",
        )
        d = s.to_dict()
        assert d["planning_tag"] == "stabilization"
        assert len(d["bleed_events"]) == 1
        s2 = Session.from_dict(d)
        assert s2.planning_tag == "stabilization"
        assert s2.bleed_events[0]["corner"] == "fl"


class TestWeekend:
    def test_round_trip(self):
        w = Weekend(id="w1", name="Spring 2024", track="Laguna Seca",
                    date_start="2024-03-15", date_end="2024-03-17")
        d = w.to_dict()
        w2 = Weekend.from_dict(d)
        assert w2.name == "Spring 2024"
        assert w2.track == "Laguna Seca"
        assert w2.date_start == "2024-03-15"

    def test_defaults(self):
        w = Weekend.from_dict({"id": "w2", "name": "Empty"})
        assert w.track == ""
        assert w.date_start == ""


class TestPlan:
    def test_round_trip(self):
        p = Plan(id="p1", car_driver_id="cd1", weekend_id="w1",
                 session_ids=["s1", "s2"], planning_mode="qual",
                 qual_plan={"fl": 24.5, "fr": 24.5, "rl": 22.0, "rr": 22.0, "target": 30},
                 pressure_band_psi=0.3, notes="Bring rain tires",
                 current_weather_condition="Overcast")
        d = p.to_dict()
        assert d["current_weather_condition"] == "Overcast"
        p2 = Plan.from_dict(d)
        assert p2.session_ids == ["s1", "s2"]
        assert p2.planning_mode == "qual"
        assert p2.qual_plan["fl"] == 24.5
        assert p2.pressure_band_psi == 0.3
        assert p2.qual_lap_range == [2, 3]
        assert p2.notes == "Bring rain tires"
        assert p2.current_weather_condition == "Overcast"

    def test_defaults(self):
        p = Plan.from_dict({"id": "p2", "car_driver_id": "cd1", "weekend_id": "w1"})
        assert p.planning_mode == "both"
        assert p.session_ids == []
        assert p.checklist == []
        assert p.pressure_band_psi == 0.5
        assert p.current_ambient_temp_c is None
        assert p.current_weather_condition is None
        assert p.notes == ""

    def test_json_string_parsing(self):
        import json
        p = Plan.from_dict({
            "id": "p3", "car_driver_id": "cd1", "weekend_id": "w1",
            "session_ids": json.dumps(["s1"]),
            "qual_plan": json.dumps({"fl": 20}),
        })
        assert p.session_ids == ["s1"]
        assert p.qual_plan["fl"] == 20


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
