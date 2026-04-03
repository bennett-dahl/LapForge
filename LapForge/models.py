"""Data models for 992 Cup Tire Pressure tool: Car-Driver, Session, Weekend, TireSet."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


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
    file_path: str | None = None  # path to original .txt or None if embedded
    parsed_data: dict[str, Any] | None = None  # embedded: metadata, rows, lap_split_times, pressure_columns

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
            "file_path": self.file_path,
            "parsed_data": self.parsed_data,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Session:
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
            file_path=d.get("file_path"),
            parsed_data=d.get("parsed_data"),
        )


@dataclass
class Weekend:
    id: str
    car_driver_id: str
    name: str  # e.g. "Spring Mountain 2024"
    session_ids: list[str] = field(default_factory=list)  # order: P1, P2, P3, Qual, R1, R2

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "car_driver_id": self.car_driver_id,
            "name": self.name,
            "session_ids": list(self.session_ids),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Weekend:
        return cls(
            id=str(d["id"]),
            car_driver_id=str(d["car_driver_id"]),
            name=str(d.get("name", "")),
            session_ids=list(d.get("session_ids", [])),
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
