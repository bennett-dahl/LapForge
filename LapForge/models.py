"""Data models for 992 Cup Tire Pressure tool: Car-Driver, Session, Weekend, Plan, TireSet."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

DEFAULT_CHECKLIST_STEPS: list[dict[str, Any]] = [
    {"key": "baseline", "label": "Baseline", "required": True, "status": "not_started", "session_ids": [], "notes": ""},
    {"key": "stabilization", "label": "Stabilization reference", "required": True, "status": "not_started", "session_ids": [], "notes": ""},
    {"key": "stagger", "label": "Second set / stagger", "required": False, "status": "not_started", "session_ids": [], "notes": ""},
    {"key": "qual_validation", "label": "Qual validation", "required": False, "status": "not_started", "session_ids": [], "notes": ""},
    {"key": "race_validation", "label": "Race validation", "required": False, "status": "not_started", "session_ids": [], "notes": ""},
    {"key": "qual_plan", "label": "Qual plan", "required": True, "status": "not_started", "session_ids": [], "notes": ""},
    {"key": "race_plan", "label": "Race plan", "required": True, "status": "not_started", "session_ids": [], "notes": ""},
]


class SessionType(str, Enum):
    PRACTICE_1 = "Practice 1"
    PRACTICE_2 = "Practice 2"
    PRACTICE_3 = "Practice 3"
    QUALIFYING = "Qualifying"
    RACE_1 = "Race 1"
    RACE_2 = "Race 2"


@dataclass
class CarDriver:
    id: str
    car_identifier: str  # name or number
    driver_name: str

    def display_name(self) -> str:
        return f"{self.car_identifier} / {self.driver_name}"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "car_identifier": self.car_identifier,
            "driver_name": self.driver_name,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> CarDriver:
        return cls(
            id=str(d["id"]),
            car_identifier=str(d.get("car_identifier", "")),
            driver_name=str(d.get("driver_name", "")),
        )


@dataclass
class TireSet:
    id: str
    name: str
    car_driver_id: str | None = None  # scope to car-driver if set
    morning_pressure_fl: float | None = None  # bar
    morning_pressure_fr: float | None = None
    morning_pressure_rl: float | None = None
    morning_pressure_rr: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "car_driver_id": self.car_driver_id,
            "morning_pressure_fl": self.morning_pressure_fl,
            "morning_pressure_fr": self.morning_pressure_fr,
            "morning_pressure_rl": self.morning_pressure_rl,
            "morning_pressure_rr": self.morning_pressure_rr,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> TireSet:
        return cls(
            id=str(d["id"]),
            name=str(d.get("name", "")),
            car_driver_id=d.get("car_driver_id"),
            morning_pressure_fl=d.get("morning_pressure_fl"),
            morning_pressure_fr=d.get("morning_pressure_fr"),
            morning_pressure_rl=d.get("morning_pressure_rl"),
            morning_pressure_rr=d.get("morning_pressure_rr"),
        )


@dataclass
class Session:
    id: str
    car_driver_id: str
    session_type: SessionType
    track: str
    driver: str  # display
    car: str  # display
    outing_number: str
    session_number: str
    ambient_temp_c: float | None = None
    track_temp_c: float | None = None
    tire_set_id: str | None = None
    roll_out_pressure_fl: float | None = None  # bar
    roll_out_pressure_fr: float | None = None
    roll_out_pressure_rl: float | None = None
    roll_out_pressure_rr: float | None = None
    target_pressure_psi: float | None = None
    track_layout_id: str | None = None
    lap_count_notes: str | None = None
    planning_tag: str | None = None
    bleed_events: list[dict[str, Any]] = field(default_factory=list)
    file_path: str | None = None
    parsed_data: dict[str, Any] | None = None
    created_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "car_driver_id": self.car_driver_id,
            "session_type": self.session_type.value,
            "track": self.track,
            "driver": self.driver,
            "car": self.car,
            "outing_number": self.outing_number,
            "session_number": self.session_number,
            "ambient_temp_c": self.ambient_temp_c,
            "track_temp_c": self.track_temp_c,
            "tire_set_id": self.tire_set_id,
            "roll_out_pressure_fl": self.roll_out_pressure_fl,
            "roll_out_pressure_fr": self.roll_out_pressure_fr,
            "roll_out_pressure_rl": self.roll_out_pressure_rl,
            "roll_out_pressure_rr": self.roll_out_pressure_rr,
            "target_pressure_psi": self.target_pressure_psi,
            "track_layout_id": self.track_layout_id,
            "lap_count_notes": self.lap_count_notes,
            "planning_tag": self.planning_tag,
            "bleed_events": list(self.bleed_events),
            "file_path": self.file_path,
            "parsed_data": self.parsed_data,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Session:
        bleed = d.get("bleed_events")
        if isinstance(bleed, str):
            import json as _json
            try:
                bleed = _json.loads(bleed)
            except (ValueError, TypeError):
                bleed = []
        return cls(
            id=str(d["id"]),
            car_driver_id=str(d["car_driver_id"]),
            session_type=SessionType(d.get("session_type", "Practice 1")),
            track=str(d.get("track", "")),
            driver=str(d.get("driver", "")),
            car=str(d.get("car", "")),
            outing_number=str(d.get("outing_number", "")),
            session_number=str(d.get("session_number", "")),
            ambient_temp_c=d.get("ambient_temp_c"),
            track_temp_c=d.get("track_temp_c"),
            tire_set_id=d.get("tire_set_id"),
            roll_out_pressure_fl=d.get("roll_out_pressure_fl"),
            roll_out_pressure_fr=d.get("roll_out_pressure_fr"),
            roll_out_pressure_rl=d.get("roll_out_pressure_rl"),
            roll_out_pressure_rr=d.get("roll_out_pressure_rr"),
            target_pressure_psi=d.get("target_pressure_psi"),
            track_layout_id=d.get("track_layout_id"),
            lap_count_notes=d.get("lap_count_notes"),
            planning_tag=d.get("planning_tag"),
            bleed_events=bleed if isinstance(bleed, list) else [],
            file_path=d.get("file_path"),
            parsed_data=d.get("parsed_data"),
            created_at=str(d.get("created_at", "")),
        )


@dataclass
class Weekend:
    id: str
    name: str
    track: str = ""
    date_start: str = ""
    date_end: str = ""
    created_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "track": self.track,
            "date_start": self.date_start,
            "date_end": self.date_end,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Weekend:
        return cls(
            id=str(d["id"]),
            name=str(d.get("name", "")),
            track=str(d.get("track", "")),
            date_start=str(d.get("date_start", "")),
            date_end=str(d.get("date_end", "")),
            created_at=str(d.get("created_at", "")),
        )


@dataclass
class Plan:
    id: str
    car_driver_id: str
    weekend_id: str
    session_ids: list[str] = field(default_factory=list)
    checklist: list[dict[str, Any]] = field(default_factory=list)
    planning_mode: str = "both"
    qual_plan: dict[str, Any] = field(default_factory=dict)
    race_plan: dict[str, Any] = field(default_factory=dict)
    qual_lap_range: list[int] = field(default_factory=lambda: [2, 3])
    race_stint_lap_range: list[int | None] = field(default_factory=lambda: [3, None])
    pressure_band_psi: float = 0.5
    current_ambient_temp_c: float | None = None
    current_track_temp_c: float | None = None
    created_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "car_driver_id": self.car_driver_id,
            "weekend_id": self.weekend_id,
            "session_ids": list(self.session_ids),
            "checklist": list(self.checklist),
            "planning_mode": self.planning_mode,
            "qual_plan": dict(self.qual_plan),
            "race_plan": dict(self.race_plan),
            "qual_lap_range": list(self.qual_lap_range),
            "race_stint_lap_range": list(self.race_stint_lap_range),
            "pressure_band_psi": self.pressure_band_psi,
            "current_ambient_temp_c": self.current_ambient_temp_c,
            "current_track_temp_c": self.current_track_temp_c,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Plan:
        import json as _json

        def _parse_json_field(val: Any, default: Any) -> Any:
            if val is None:
                return default
            if isinstance(val, str):
                try:
                    return _json.loads(val)
                except (ValueError, TypeError):
                    return default
            return val

        return cls(
            id=str(d["id"]),
            car_driver_id=str(d["car_driver_id"]),
            weekend_id=str(d["weekend_id"]),
            session_ids=_parse_json_field(d.get("session_ids"), []),
            checklist=_parse_json_field(d.get("checklist"), []),
            planning_mode=str(d.get("planning_mode", "both")),
            qual_plan=_parse_json_field(d.get("qual_plan"), {}),
            race_plan=_parse_json_field(d.get("race_plan"), {}),
            qual_lap_range=_parse_json_field(d.get("qual_lap_range"), [2, 3]),
            race_stint_lap_range=_parse_json_field(d.get("race_stint_lap_range"), [3, None]),
            pressure_band_psi=float(d.get("pressure_band_psi") or 0.5),
            current_ambient_temp_c=d.get("current_ambient_temp_c"),
            current_track_temp_c=d.get("current_track_temp_c"),
            created_at=str(d.get("created_at", "")),
        )


@dataclass
class TrackSection:
    """Named section of a track, defined by distance boundaries."""

    id: str
    track_name: str
    name: str
    start_distance: float
    end_distance: float
    section_type: str = "auto"  # "auto" or "manual"
    sort_order: int = 0
    corner_group: int | None = None

    def to_dict(self) -> dict[str, Any]:
        d = {
            "id": self.id,
            "track_name": self.track_name,
            "name": self.name,
            "start_distance": self.start_distance,
            "end_distance": self.end_distance,
            "section_type": self.section_type,
            "sort_order": self.sort_order,
        }
        if self.corner_group is not None:
            d["corner_group"] = self.corner_group
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> TrackSection:
        cg = d.get("corner_group") or d.get("cornerGroup")
        return cls(
            id=str(d["id"]),
            track_name=str(d.get("track_name", "")),
            name=str(d.get("name", "")),
            start_distance=float(d.get("start_distance", 0)),
            end_distance=float(d.get("end_distance", 0)),
            section_type=str(d.get("section_type", "auto")),
            sort_order=int(d.get("sort_order", 0)),
            corner_group=int(cg) if cg is not None else None,
        )


@dataclass
class TrackLayout:
    """Named track map geometry derived from a specific session/lap."""

    id: str
    name: str
    track_name: str
    source_session_id: str | None = None
    source_lap_index: int | None = None
    reference_lap_json: str = ""
    created_at: str = ""
    source_driver: str | None = None
    source_car: str | None = None
    source_session_name: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "track_name": self.track_name,
            "source_session_id": self.source_session_id,
            "source_lap_index": self.source_lap_index,
            "created_at": self.created_at,
            "source_driver": self.source_driver,
            "source_car": self.source_car,
            "source_session_name": self.source_session_name,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> TrackLayout:
        lap = d.get("source_lap_index")
        return cls(
            id=str(d["id"]),
            name=str(d.get("name", "")),
            track_name=str(d.get("track_name", "")),
            source_session_id=d.get("source_session_id"),
            source_lap_index=int(lap) if lap is not None else None,
            reference_lap_json=str(d.get("reference_lap_json", "")),
            created_at=str(d.get("created_at", "")),
            source_driver=d.get("source_driver"),
            source_car=d.get("source_car"),
            source_session_name=d.get("source_session_name"),
        )


@dataclass
class SavedComparison:
    """Named list of session IDs for the Compare view."""

    id: str
    name: str
    session_ids: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "session_ids": list(self.session_ids)}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> SavedComparison:
        return cls(
            id=str(d["id"]),
            name=str(d.get("name", "")),
            session_ids=list(d.get("session_ids", [])),
        )
