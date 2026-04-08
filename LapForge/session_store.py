"""SQLite store for car-drivers, sessions, weekends, tire sets."""

from __future__ import annotations

import datetime
import json
import logging
import os
import sqlite3
import uuid
from pathlib import Path
from typing import Any

from .models import (
    DEFAULT_CHECKLIST_STEPS,
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

log = logging.getLogger(__name__)

def _default_data_root() -> Path:
    """Default data directory in the OS appdata folder (%APPDATA%/LapForge/data/)."""
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    d = base / "LapForge" / "data"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _ensure_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def _migrate_old_db(db_path: Path) -> None:
    """Auto-rename legacy tire_pressure.db to race_data.db if needed."""
    old = db_path.parent / "tire_pressure.db"
    if not db_path.exists() and old.exists():
        old.rename(db_path)


class SessionStore:
    def __init__(self, db_path: str | Path | None = None, *, data_root: Path | None = None):
        if data_root is not None:
            self.data_root = Path(data_root)
            self.db_path = self.data_root / "race_data.db"
        elif db_path is not None:
            self.db_path = Path(db_path)
            self.data_root = self.db_path.parent
        else:
            self.data_root = _default_data_root()
            self.db_path = self.data_root / "race_data.db"
        self.uploads_dir = self.data_root / "uploads"
        _ensure_dir(self.db_path)
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        _migrate_old_db(self.db_path)
        self._init_schema()

    def resolve_file_path(self, file_path: str | None) -> Path | None:
        """Resolve a file_path (relative or legacy absolute) to an absolute Path."""
        if not file_path:
            return None
        p = Path(file_path)
        if p.is_absolute():
            return p
        return self.data_root / file_path

    def _conn(self) -> sqlite3.Connection:
        return sqlite3.connect(str(self.db_path))

    def _init_schema(self) -> None:
        with self._conn() as c:
            c.executescript("""
                CREATE TABLE IF NOT EXISTS car_drivers (
                    id TEXT PRIMARY KEY,
                    car_identifier TEXT NOT NULL,
                    driver_name TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS tire_sets (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    car_driver_id TEXT,
                    morning_pressure_fl REAL,
                    morning_pressure_fr REAL,
                    morning_pressure_rl REAL,
                    morning_pressure_rr REAL,
                    FOREIGN KEY (car_driver_id) REFERENCES car_drivers(id)
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    car_driver_id TEXT NOT NULL,
                    session_type TEXT NOT NULL,
                    track TEXT,
                    driver TEXT,
                    car TEXT,
                    outing_number TEXT,
                    session_number TEXT,
                    ambient_temp_c REAL,
                    track_temp_c REAL,
                    weather_condition TEXT,
                    tire_set_id TEXT,
                    roll_out_pressure_fl REAL,
                    roll_out_pressure_fr REAL,
                    roll_out_pressure_rl REAL,
                    roll_out_pressure_rr REAL,
                    lap_count_notes TEXT,
                    file_path TEXT,
                    parsed_data_json TEXT,
                    FOREIGN KEY (car_driver_id) REFERENCES car_drivers(id),
                    FOREIGN KEY (tire_set_id) REFERENCES tire_sets(id)
                );
                CREATE TABLE IF NOT EXISTS weekends (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    track TEXT DEFAULT '',
                    date_start TEXT DEFAULT '',
                    date_end TEXT DEFAULT '',
                    created_at TEXT DEFAULT ''
                );
                CREATE TABLE IF NOT EXISTS plans (
                    id TEXT PRIMARY KEY,
                    car_driver_id TEXT NOT NULL,
                    weekend_id TEXT NOT NULL,
                    session_ids_json TEXT DEFAULT '[]',
                    checklist_json TEXT DEFAULT '[]',
                    planning_mode TEXT DEFAULT 'both',
                    qual_plan_json TEXT DEFAULT '{}',
                    race_plan_json TEXT DEFAULT '{}',
                    qual_lap_range_json TEXT DEFAULT '[2,3]',
                    race_stint_lap_range_json TEXT DEFAULT '[3,null]',
                    pressure_band_psi REAL DEFAULT 0.5,
                    current_ambient_temp_c REAL,
                    current_track_temp_c REAL,
                    current_weather_condition TEXT,
                    created_at TEXT DEFAULT '',
                    notes TEXT DEFAULT '',
                    FOREIGN KEY (car_driver_id) REFERENCES car_drivers(id),
                    FOREIGN KEY (weekend_id) REFERENCES weekends(id),
                    UNIQUE(car_driver_id, weekend_id)
                );
                CREATE TABLE IF NOT EXISTS saved_comparisons (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    session_ids_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS track_sections (
                    id TEXT PRIMARY KEY,
                    track_name TEXT NOT NULL,
                    name TEXT NOT NULL,
                    start_distance REAL NOT NULL,
                    end_distance REAL NOT NULL,
                    section_type TEXT NOT NULL DEFAULT 'auto',
                    sort_order INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS track_layouts (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    track_name TEXT NOT NULL,
                    source_session_id TEXT,
                    source_lap_index INTEGER,
                    reference_lap_json TEXT NOT NULL,
                    created_at TEXT
                );
                CREATE TABLE IF NOT EXISTS dashboard_templates (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    layout_json TEXT NOT NULL,
                    created_at TEXT
                );
                CREATE TABLE IF NOT EXISTS setups (
                    id TEXT PRIMARY KEY,
                    car_driver_id TEXT NOT NULL,
                    weekend_id TEXT,
                    session_id TEXT,
                    parent_id TEXT,
                    name TEXT NOT NULL DEFAULT '',
                    data_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT '',
                    FOREIGN KEY (car_driver_id) REFERENCES car_drivers(id),
                    FOREIGN KEY (session_id) REFERENCES sessions(id),
                    FOREIGN KEY (parent_id) REFERENCES setups(id)
                );
            """)
            self._migrate()

    def _migrate(self) -> None:
        """Add columns that may not exist in older databases."""
        with self._conn() as c:
            cols = {
                row[1]
                for row in c.execute("PRAGMA table_info(sessions)").fetchall()
            }
            if "session_summary_json" not in cols:
                c.execute("ALTER TABLE sessions ADD COLUMN session_summary_json TEXT")
            if "target_pressure_psi" not in cols:
                c.execute("ALTER TABLE sessions ADD COLUMN target_pressure_psi REAL")

            if "track_layout_id" not in cols:
                c.execute("ALTER TABLE sessions ADD COLUMN track_layout_id TEXT")

            if "dashboard_layout_json" not in cols:
                c.execute("ALTER TABLE sessions ADD COLUMN dashboard_layout_json TEXT")

            if "planning_tag" not in cols:
                c.execute("ALTER TABLE sessions ADD COLUMN planning_tag TEXT")
            if "bleed_events_json" not in cols:
                c.execute("ALTER TABLE sessions ADD COLUMN bleed_events_json TEXT")
            if "created_at" not in cols:
                c.execute("ALTER TABLE sessions ADD COLUMN created_at TEXT DEFAULT ''")
            if "weather_condition" not in cols:
                c.execute("ALTER TABLE sessions ADD COLUMN weather_condition TEXT")

            # Migrate old weekends schema (had car_driver_id + session_ids_json) to event-level
            wk_cols = {
                row[1]
                for row in c.execute("PRAGMA table_info(weekends)").fetchall()
            }
            if "car_driver_id" in wk_cols:
                old_rows = c.execute(
                    "SELECT id, car_driver_id, name, session_ids_json FROM weekends"
                ).fetchall()
                c.execute("DROP TABLE weekends")
                c.execute("""
                    CREATE TABLE weekends (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        track TEXT DEFAULT '',
                        date_start TEXT DEFAULT '',
                        date_end TEXT DEFAULT '',
                        created_at TEXT DEFAULT ''
                    )
                """)
                c.execute("""
                    CREATE TABLE IF NOT EXISTS plans (
                        id TEXT PRIMARY KEY,
                        car_driver_id TEXT NOT NULL,
                        weekend_id TEXT NOT NULL,
                        session_ids_json TEXT DEFAULT '[]',
                        checklist_json TEXT DEFAULT '[]',
                        planning_mode TEXT DEFAULT 'both',
                        qual_plan_json TEXT DEFAULT '{}',
                        race_plan_json TEXT DEFAULT '{}',
                        qual_lap_range_json TEXT DEFAULT '[2,3]',
                        race_stint_lap_range_json TEXT DEFAULT '[3,null]',
                        pressure_band_psi REAL DEFAULT 0.5,
                        current_ambient_temp_c REAL,
                        current_track_temp_c REAL,
                        created_at TEXT DEFAULT '',
                        notes TEXT DEFAULT '',
                        FOREIGN KEY (car_driver_id) REFERENCES car_drivers(id),
                        FOREIGN KEY (weekend_id) REFERENCES weekends(id),
                        UNIQUE(car_driver_id, weekend_id)
                    )
                """)
                now = datetime.datetime.now(datetime.timezone.utc).isoformat()
                migrated_names: dict[str, str] = {}
                for wid, cdid, wname, sids_json in old_rows:
                    if wname not in migrated_names:
                        migrated_names[wname] = wid
                        c.execute(
                            "INSERT INTO weekends (id, name, created_at) VALUES (?, ?, ?)",
                            (wid, wname, now),
                        )
                    weekend_id = migrated_names[wname]
                    sids = json.loads(sids_json or "[]")
                    plan_id = str(uuid.uuid4())
                    c.execute(
                        """INSERT OR IGNORE INTO plans
                           (id, car_driver_id, weekend_id, session_ids_json, checklist_json, created_at)
                           VALUES (?, ?, ?, ?, ?, ?)""",
                        (plan_id, cdid, weekend_id, json.dumps(sids),
                         json.dumps(DEFAULT_CHECKLIST_STEPS), now),
                    )

            sc_cols = {
                row[1]
                for row in c.execute("PRAGMA table_info(saved_comparisons)").fetchall()
            }
            if sc_cols and "dashboard_layout_json" not in sc_cols:
                c.execute("ALTER TABLE saved_comparisons ADD COLUMN dashboard_layout_json TEXT")

            plan_cols = {
                row[1]
                for row in c.execute("PRAGMA table_info(plans)").fetchall()
            }
            if plan_cols and "notes" not in plan_cols:
                c.execute("ALTER TABLE plans ADD COLUMN notes TEXT DEFAULT ''")
            if plan_cols and "current_weather_condition" not in plan_cols:
                c.execute("ALTER TABLE plans ADD COLUMN current_weather_condition TEXT")

            ts_cols = {
                row[1]
                for row in c.execute("PRAGMA table_info(track_sections)").fetchall()
            }
            if ts_cols and "corner_group" not in ts_cols:
                c.execute("ALTER TABLE track_sections ADD COLUMN corner_group INTEGER")

            # Migrate file_path from absolute to relative (for portability / sync)
            abs_rows = c.execute(
                "SELECT id, file_path FROM sessions WHERE file_path IS NOT NULL"
            ).fetchall()
            for row_id, fp in abs_rows:
                if fp and Path(fp).is_absolute():
                    try:
                        rel = Path(fp).relative_to(self.data_root)
                        c.execute(
                            "UPDATE sessions SET file_path = ? WHERE id = ?",
                            (rel.as_posix(), row_id),
                        )
                    except ValueError:
                        pass

            tl_cols = {
                row[1]
                for row in c.execute("PRAGMA table_info(track_layouts)").fetchall()
            }
            for col_name in ("source_driver", "source_car", "source_session_name"):
                if tl_cols and col_name not in tl_cols:
                    c.execute(f"ALTER TABLE track_layouts ADD COLUMN {col_name} TEXT")
                    tl_cols.add(col_name)

            # Migrate track_layouts: old schema had track_name as PK, new has id PK
            if tl_cols and "id" not in tl_cols:
                old_rows = c.execute("SELECT track_name, reference_lap_json, updated_at FROM track_layouts").fetchall()
                c.execute("DROP TABLE track_layouts")
                c.execute("""
                    CREATE TABLE track_layouts (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        track_name TEXT NOT NULL,
                        source_session_id TEXT,
                        source_lap_index INTEGER,
                        reference_lap_json TEXT NOT NULL,
                        created_at TEXT
                    )
                """)
                for tn, rj, ua in old_rows:
                    c.execute(
                        "INSERT INTO track_layouts (id, name, track_name, reference_lap_json, created_at) VALUES (?, ?, ?, ?, ?)",
                        (str(uuid.uuid4()), tn, tn, rj, ua),
                    )

    # ---------- Car-Driver ----------
    def add_car_driver(self, car_identifier: str, driver_name: str, id: str | None = None) -> CarDriver:
        id = id or str(uuid.uuid4())
        cd = CarDriver(id=id, car_identifier=car_identifier, driver_name=driver_name)
        with self._conn() as c:
            c.execute(
                "INSERT INTO car_drivers (id, car_identifier, driver_name) VALUES (?, ?, ?)",
                (cd.id, cd.car_identifier, cd.driver_name),
            )
        return cd

    def update_car_driver(self, cd: CarDriver) -> None:
        with self._conn() as c:
            c.execute(
                "UPDATE car_drivers SET car_identifier = ?, driver_name = ? WHERE id = ?",
                (cd.car_identifier, cd.driver_name, cd.id),
            )

    def get_car_driver(self, id: str) -> CarDriver | None:
        with self._conn() as c:
            row = c.execute("SELECT id, car_identifier, driver_name FROM car_drivers WHERE id = ?", (id,)).fetchone()
        if not row:
            return None
        return CarDriver(id=row[0], car_identifier=row[1], driver_name=row[2])

    def list_car_drivers(self) -> list[CarDriver]:
        with self._conn() as c:
            rows = c.execute("SELECT id, car_identifier, driver_name FROM car_drivers ORDER BY driver_name").fetchall()
        return [CarDriver(id=r[0], car_identifier=r[1], driver_name=r[2]) for r in rows]

    def delete_car_driver(self, id: str) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM car_drivers WHERE id = ?", (id,))

    # ---------- TireSet ----------
    def add_tire_set(
        self,
        name: str,
        car_driver_id: str | None = None,
        id: str | None = None,
        morning_pressures: tuple[float | None, float | None, float | None, float | None] | None = None,
    ) -> TireSet:
        id = id or str(uuid.uuid4())
        fl, fr, rl, rr = morning_pressures or (None, None, None, None)
        ts = TireSet(id=id, name=name, car_driver_id=car_driver_id, morning_pressure_fl=fl, morning_pressure_fr=fr, morning_pressure_rl=rl, morning_pressure_rr=rr)
        with self._conn() as c:
            c.execute(
                """INSERT INTO tire_sets (id, name, car_driver_id, morning_pressure_fl, morning_pressure_fr, morning_pressure_rl, morning_pressure_rr)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (ts.id, ts.name, ts.car_driver_id, ts.morning_pressure_fl, ts.morning_pressure_fr, ts.morning_pressure_rl, ts.morning_pressure_rr),
            )
        return ts

    def update_tire_set(self, ts: TireSet) -> None:
        with self._conn() as c:
            c.execute(
                """UPDATE tire_sets SET name = ?, car_driver_id = ?, morning_pressure_fl = ?, morning_pressure_fr = ?, morning_pressure_rl = ?, morning_pressure_rr = ?
                   WHERE id = ?""",
                (ts.name, ts.car_driver_id, ts.morning_pressure_fl, ts.morning_pressure_fr, ts.morning_pressure_rl, ts.morning_pressure_rr, ts.id),
            )

    def get_tire_set(self, id: str) -> TireSet | None:
        with self._conn() as c:
            row = c.execute(
                "SELECT id, name, car_driver_id, morning_pressure_fl, morning_pressure_fr, morning_pressure_rl, morning_pressure_rr FROM tire_sets WHERE id = ?",
                (id,),
            ).fetchone()
        if not row:
            return None
        return TireSet(id=row[0], name=row[1], car_driver_id=row[2], morning_pressure_fl=row[3], morning_pressure_fr=row[4], morning_pressure_rl=row[5], morning_pressure_rr=row[6])

    def list_tire_sets(self, car_driver_id: str | None = None) -> list[TireSet]:
        with self._conn() as c:
            if car_driver_id:
                rows = c.execute(
                    "SELECT id, name, car_driver_id, morning_pressure_fl, morning_pressure_fr, morning_pressure_rl, morning_pressure_rr FROM tire_sets WHERE car_driver_id = ? ORDER BY name",
                    (car_driver_id,),
                ).fetchall()
            else:
                rows = c.execute(
                    "SELECT id, name, car_driver_id, morning_pressure_fl, morning_pressure_fr, morning_pressure_rl, morning_pressure_rr FROM tire_sets ORDER BY name"
                ).fetchall()
        return [TireSet(id=r[0], name=r[1], car_driver_id=r[2], morning_pressure_fl=r[3], morning_pressure_fr=r[4], morning_pressure_rl=r[5], morning_pressure_rr=r[6]) for r in rows]

    def delete_tire_set(self, id: str) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM tire_sets WHERE id = ?", (id,))

    # ---------- Session ----------
    @staticmethod
    def _extract_summary_json(parsed_data: dict | None) -> str | None:
        if not parsed_data or not isinstance(parsed_data, dict):
            return None
        summary = parsed_data.get("summary")
        if summary:
            return json.dumps(summary, default=str)
        return None

    def add_session(self, session: Session) -> Session:
        parsed_json = json.dumps(session.parsed_data, default=str) if session.parsed_data else None
        summary_json = self._extract_summary_json(session.parsed_data)
        bleed_json = json.dumps(session.bleed_events) if session.bleed_events else None
        if not session.created_at:
            session.created_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with self._conn() as c:
            c.execute(
                """INSERT INTO sessions (id, car_driver_id, session_type, track, driver, car, outing_number, session_number,
                   ambient_temp_c, track_temp_c, weather_condition, tire_set_id,
                   roll_out_pressure_fl, roll_out_pressure_fr, roll_out_pressure_rl, roll_out_pressure_rr,
                   target_pressure_psi, track_layout_id, lap_count_notes, planning_tag, bleed_events_json,
                   file_path, parsed_data_json, session_summary_json, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    session.id,
                    session.car_driver_id,
                    session.session_type.value,
                    session.track,
                    session.driver,
                    session.car,
                    session.outing_number,
                    session.session_number,
                    session.ambient_temp_c,
                    session.track_temp_c,
                    session.weather_condition,
                    session.tire_set_id,
                    session.roll_out_pressure_fl,
                    session.roll_out_pressure_fr,
                    session.roll_out_pressure_rl,
                    session.roll_out_pressure_rr,
                    session.target_pressure_psi,
                    session.track_layout_id,
                    session.lap_count_notes,
                    session.planning_tag,
                    bleed_json,
                    session.file_path,
                    parsed_json,
                    summary_json,
                    session.created_at,
                ),
            )
        return session

    def update_session(self, session: Session) -> None:
        parsed_json = json.dumps(session.parsed_data, default=str) if session.parsed_data else None
        summary_json = self._extract_summary_json(session.parsed_data)
        bleed_json = json.dumps(session.bleed_events) if session.bleed_events else None
        with self._conn() as c:
            c.execute(
                """UPDATE sessions SET car_driver_id = ?, session_type = ?, track = ?, driver = ?, car = ?, outing_number = ?, session_number = ?,
                   ambient_temp_c = ?, track_temp_c = ?, weather_condition = ?,
                   tire_set_id = ?, roll_out_pressure_fl = ?, roll_out_pressure_fr = ?, roll_out_pressure_rl = ?, roll_out_pressure_rr = ?,
                   target_pressure_psi = ?, track_layout_id = ?, lap_count_notes = ?, planning_tag = ?, bleed_events_json = ?,
                   file_path = ?, parsed_data_json = ?, session_summary_json = ? WHERE id = ?""",
                (
                    session.car_driver_id,
                    session.session_type.value,
                    session.track,
                    session.driver,
                    session.car,
                    session.outing_number,
                    session.session_number,
                    session.ambient_temp_c,
                    session.track_temp_c,
                    session.weather_condition,
                    session.tire_set_id,
                    session.roll_out_pressure_fl,
                    session.roll_out_pressure_fr,
                    session.roll_out_pressure_rl,
                    session.roll_out_pressure_rr,
                    session.target_pressure_psi,
                    session.track_layout_id,
                    session.lap_count_notes,
                    session.planning_tag,
                    bleed_json,
                    session.file_path,
                    parsed_json,
                    summary_json,
                    session.id,
                ),
            )

    def get_session(self, id: str) -> Session | None:
        with self._conn() as c:
            row = c.execute(
                """SELECT id, car_driver_id, session_type, track, driver, car, outing_number, session_number,
                   ambient_temp_c, track_temp_c, tire_set_id, roll_out_pressure_fl, roll_out_pressure_fr, roll_out_pressure_rl, roll_out_pressure_rr,
                   target_pressure_psi, track_layout_id, lap_count_notes, planning_tag, bleed_events_json,
                   file_path, parsed_data_json, created_at, weather_condition FROM sessions WHERE id = ?""",
                (id,),
            ).fetchone()
        if not row:
            return None
        parsed = None
        if row[21]:
            try:
                parsed = json.loads(row[21])
            except (ValueError, TypeError):
                parsed = None
        bleed_events: list[dict] = []
        if row[19]:
            try:
                bleed_events = json.loads(row[19])
            except (ValueError, TypeError):
                bleed_events = []
        return Session(
            id=row[0],
            car_driver_id=row[1],
            session_type=SessionType(row[2]),
            track=row[3] or "",
            driver=row[4] or "",
            car=row[5] or "",
            outing_number=row[6] or "",
            session_number=row[7] or "",
            ambient_temp_c=row[8],
            track_temp_c=row[9],
            tire_set_id=row[10],
            roll_out_pressure_fl=row[11],
            roll_out_pressure_fr=row[12],
            roll_out_pressure_rl=row[13],
            roll_out_pressure_rr=row[14],
            target_pressure_psi=row[15],
            track_layout_id=row[16],
            lap_count_notes=row[17],
            planning_tag=row[18],
            bleed_events=bleed_events,
            file_path=row[20],
            parsed_data=parsed,
            created_at=row[22] or "",
            weather_condition=row[23] if len(row) > 23 else None,
        )

    def list_sessions(self, car_driver_id: str | None = None) -> list[Session]:
        """List sessions. Only loads the lightweight summary, not the full blob."""
        with self._conn() as c:
            if car_driver_id:
                rows = c.execute(
                    """SELECT id, car_driver_id, session_type, track, driver, car, outing_number, session_number,
                       ambient_temp_c, track_temp_c, tire_set_id, roll_out_pressure_fl, roll_out_pressure_fr, roll_out_pressure_rl, roll_out_pressure_rr,
                       target_pressure_psi, track_layout_id, lap_count_notes, planning_tag, bleed_events_json,
                       file_path, session_summary_json, created_at, weather_condition FROM sessions WHERE car_driver_id = ? ORDER BY track, session_type""",
                    (car_driver_id,),
                ).fetchall()
            else:
                rows = c.execute(
                    """SELECT id, car_driver_id, session_type, track, driver, car, outing_number, session_number,
                       ambient_temp_c, track_temp_c, tire_set_id, roll_out_pressure_fl, roll_out_pressure_fr, roll_out_pressure_rl, roll_out_pressure_rr,
                       target_pressure_psi, track_layout_id, lap_count_notes, planning_tag, bleed_events_json,
                       file_path, session_summary_json, created_at, weather_condition FROM sessions ORDER BY car_driver_id, track, session_type"""
                ).fetchall()
        out = []
        for row in rows:
            summary = None
            if row[21]:
                try:
                    summary = json.loads(row[21])
                except (ValueError, TypeError):
                    summary = None
            bleed_events: list[dict] = []
            if row[19]:
                try:
                    bleed_events = json.loads(row[19])
                except (ValueError, TypeError):
                    bleed_events = []
            out.append(
                Session(
                    id=row[0],
                    car_driver_id=row[1],
                    session_type=SessionType(row[2]),
                    track=row[3] or "",
                    driver=row[4] or "",
                    car=row[5] or "",
                    outing_number=row[6] or "",
                    session_number=row[7] or "",
                    ambient_temp_c=row[8],
                    track_temp_c=row[9],
                    tire_set_id=row[10],
                    roll_out_pressure_fl=row[11],
                    roll_out_pressure_fr=row[12],
                    roll_out_pressure_rl=row[13],
                    roll_out_pressure_rr=row[14],
                    target_pressure_psi=row[15],
                    track_layout_id=row[16],
                    lap_count_notes=row[17],
                    planning_tag=row[18],
                    bleed_events=bleed_events,
                    file_path=row[20],
                    parsed_data={"summary": summary} if summary else None,
                    created_at=row[22] or "",
                    weather_condition=row[23] if len(row) > 23 else None,
                )
            )
        return out

    def cleanup_orphan_uploads(self) -> list[str]:
        """Delete upload files not referenced by any session. Returns list of removed filenames."""
        if not self.uploads_dir.is_dir():
            return []
        with self._conn() as c:
            rows = c.execute(
                "SELECT file_path FROM sessions WHERE file_path IS NOT NULL"
            ).fetchall()
        referenced: set[str] = set()
        for (fp,) in rows:
            if fp:
                p = Path(fp)
                resolved = (self.data_root / fp) if not p.is_absolute() else p
                try:
                    referenced.add(str(resolved.resolve()))
                except OSError:
                    pass
        removed: list[str] = []
        uploads_canon = self.uploads_dir.resolve()
        for child in self.uploads_dir.iterdir():
            if not child.is_file():
                continue
            try:
                canon = child.resolve()
                if not canon.is_relative_to(uploads_canon):
                    continue
            except OSError:
                continue
            if str(canon) not in referenced:
                try:
                    child.unlink()
                    removed.append(child.name)
                except OSError:
                    log.warning("Failed to remove orphan upload %s", child, exc_info=True)
        return removed

    def delete_session(self, id: str) -> list[dict[str, str]]:
        """Delete session and clean up plan references. Returns affected plan ids."""
        affected: list[dict[str, str]] = []
        with self._conn() as c:
            c.execute("UPDATE setups SET session_id = NULL WHERE session_id = ?", (id,))
            plan_rows = c.execute(
                "SELECT id, session_ids_json, checklist_json FROM plans"
            ).fetchall()
            for pid, sids_json, cl_json in plan_rows:
                sids = json.loads(sids_json or "[]")
                checklist = json.loads(cl_json or "[]")
                changed = False
                if id in sids:
                    sids.remove(id)
                    changed = True
                for step in checklist:
                    step_sids = step.get("session_ids", [])
                    if id in step_sids:
                        step_sids.remove(id)
                        changed = True
                if changed:
                    c.execute(
                        "UPDATE plans SET session_ids_json = ?, checklist_json = ? WHERE id = ?",
                        (json.dumps(sids), json.dumps(checklist), pid),
                    )
                    affected.append({"id": pid})
            c.execute("DELETE FROM sessions WHERE id = ?", (id,))
        return affected

    # ---------- Weekend ----------
    def add_weekend(self, name: str, track: str = "", date_start: str = "",
                    date_end: str = "", id: str | None = None) -> Weekend:
        id = id or str(uuid.uuid4())
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        w = Weekend(id=id, name=name, track=track, date_start=date_start,
                    date_end=date_end, created_at=now)
        with self._conn() as c:
            c.execute(
                "INSERT INTO weekends (id, name, track, date_start, date_end, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (w.id, w.name, w.track, w.date_start, w.date_end, w.created_at),
            )
        return w

    def get_weekend(self, id: str) -> Weekend | None:
        with self._conn() as c:
            row = c.execute(
                "SELECT id, name, track, date_start, date_end, created_at FROM weekends WHERE id = ?",
                (id,),
            ).fetchone()
        if not row:
            return None
        return Weekend(id=row[0], name=row[1], track=row[2] or "", date_start=row[3] or "",
                       date_end=row[4] or "", created_at=row[5] or "")

    def update_weekend(self, weekend_id: str, **kwargs: Any) -> Weekend | None:
        existing = self.get_weekend(weekend_id)
        if not existing:
            return None
        allowed = {"name", "track", "date_start", "date_end"}
        sets: list[str] = []
        vals: list[Any] = []
        for k, v in kwargs.items():
            if k in allowed and v is not None:
                sets.append(f"{k} = ?")
                vals.append(v)
        if sets:
            vals.append(weekend_id)
            with self._conn() as c:
                c.execute(f"UPDATE weekends SET {', '.join(sets)} WHERE id = ?", vals)
        return self.get_weekend(weekend_id)

    def list_weekends(self) -> list[Weekend]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT id, name, track, date_start, date_end, created_at FROM weekends ORDER BY date_start DESC, name"
            ).fetchall()
        return [Weekend(id=r[0], name=r[1], track=r[2] or "", date_start=r[3] or "",
                        date_end=r[4] or "", created_at=r[5] or "") for r in rows]

    def delete_weekend(self, id: str) -> list[dict[str, str]]:
        """Delete weekend and cascade-delete its plans. Returns affected plans."""
        affected: list[dict[str, str]] = []
        with self._conn() as c:
            c.execute("UPDATE setups SET weekend_id = NULL WHERE weekend_id = ?", (id,))
            rows = c.execute("SELECT id FROM plans WHERE weekend_id = ?", (id,)).fetchall()
            for r in rows:
                affected.append({"id": r[0]})
            c.execute("DELETE FROM plans WHERE weekend_id = ?", (id,))
            c.execute("DELETE FROM weekends WHERE id = ?", (id,))
        return affected

    # ---------- Plan ----------
    def add_plan(self, car_driver_id: str, weekend_id: str, id: str | None = None) -> Plan:
        import copy
        id = id or str(uuid.uuid4())
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        checklist = copy.deepcopy(DEFAULT_CHECKLIST_STEPS)
        p = Plan(id=id, car_driver_id=car_driver_id, weekend_id=weekend_id,
                 checklist=checklist, created_at=now)
        with self._conn() as c:
            c.execute(
                """INSERT INTO plans (id, car_driver_id, weekend_id, session_ids_json,
                   checklist_json, planning_mode, qual_plan_json, race_plan_json,
                   qual_lap_range_json, race_stint_lap_range_json, pressure_band_psi,
                   current_ambient_temp_c, current_track_temp_c, current_weather_condition,
                   created_at, notes)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (p.id, p.car_driver_id, p.weekend_id, json.dumps(p.session_ids),
                 json.dumps(p.checklist), p.planning_mode, json.dumps(p.qual_plan),
                 json.dumps(p.race_plan), json.dumps(p.qual_lap_range),
                 json.dumps(p.race_stint_lap_range), p.pressure_band_psi,
                 p.current_ambient_temp_c, p.current_track_temp_c,
                 p.current_weather_condition, p.created_at, p.notes),
            )
        return p

    def get_plan(self, plan_id: str) -> Plan | None:
        with self._conn() as c:
            row = c.execute(
                """SELECT id, car_driver_id, weekend_id, session_ids_json, checklist_json,
                   planning_mode, qual_plan_json, race_plan_json, qual_lap_range_json,
                   race_stint_lap_range_json, pressure_band_psi, current_ambient_temp_c,
                   current_track_temp_c, created_at, notes, current_weather_condition
                   FROM plans WHERE id = ?""",
                (plan_id,),
            ).fetchone()
        if not row:
            return None
        return self._plan_from_row(row)

    def get_plan_for_car_weekend(self, car_driver_id: str, weekend_id: str) -> Plan | None:
        with self._conn() as c:
            row = c.execute(
                """SELECT id, car_driver_id, weekend_id, session_ids_json, checklist_json,
                   planning_mode, qual_plan_json, race_plan_json, qual_lap_range_json,
                   race_stint_lap_range_json, pressure_band_psi, current_ambient_temp_c,
                   current_track_temp_c, created_at, notes, current_weather_condition
                   FROM plans WHERE car_driver_id = ? AND weekend_id = ?""",
                (car_driver_id, weekend_id),
            ).fetchone()
        if not row:
            return None
        return self._plan_from_row(row)

    def list_plans(self, weekend_id: str | None = None) -> list[Plan]:
        with self._conn() as c:
            if weekend_id:
                rows = c.execute(
                    """SELECT id, car_driver_id, weekend_id, session_ids_json, checklist_json,
                       planning_mode, qual_plan_json, race_plan_json, qual_lap_range_json,
                       race_stint_lap_range_json, pressure_band_psi, current_ambient_temp_c,
                       current_track_temp_c, created_at, notes, current_weather_condition
                       FROM plans WHERE weekend_id = ? ORDER BY created_at""",
                    (weekend_id,),
                ).fetchall()
            else:
                rows = c.execute(
                    """SELECT id, car_driver_id, weekend_id, session_ids_json, checklist_json,
                       planning_mode, qual_plan_json, race_plan_json, qual_lap_range_json,
                       race_stint_lap_range_json, pressure_band_psi, current_ambient_temp_c,
                       current_track_temp_c, created_at, notes, current_weather_condition
                       FROM plans ORDER BY created_at"""
                ).fetchall()
        return [self._plan_from_row(r) for r in rows]

    def update_plan(self, plan_id: str, **kwargs: Any) -> Plan | None:
        existing = self.get_plan(plan_id)
        if not existing:
            return None
        json_fields = {
            "session_ids": "session_ids_json",
            "checklist": "checklist_json",
            "qual_plan": "qual_plan_json",
            "race_plan": "race_plan_json",
            "qual_lap_range": "qual_lap_range_json",
            "race_stint_lap_range": "race_stint_lap_range_json",
        }
        scalar_fields = {"planning_mode", "pressure_band_psi",
                         "current_ambient_temp_c", "current_track_temp_c",
                         "current_weather_condition", "notes"}
        sets: list[str] = []
        vals: list[Any] = []
        for k, v in kwargs.items():
            if k in json_fields:
                sets.append(f"{json_fields[k]} = ?")
                vals.append(json.dumps(v) if not isinstance(v, str) else v)
            elif k in scalar_fields:
                sets.append(f"{k} = ?")
                vals.append(v)
        if sets:
            vals.append(plan_id)
            with self._conn() as c:
                c.execute(f"UPDATE plans SET {', '.join(sets)} WHERE id = ?", vals)
        return self.get_plan(plan_id)

    def delete_plan(self, plan_id: str) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM plans WHERE id = ?", (plan_id,))

    @staticmethod
    def _plan_from_row(row: tuple) -> Plan:
        checklist = json.loads(row[4] or "[]")
        for step in checklist:
            step.setdefault("setup_ids", [])
        return Plan(
            id=row[0],
            car_driver_id=row[1],
            weekend_id=row[2],
            session_ids=json.loads(row[3] or "[]"),
            checklist=checklist,
            planning_mode=row[5] or "race",
            qual_plan=json.loads(row[6] or "{}"),
            race_plan=json.loads(row[7] or "{}"),
            qual_lap_range=json.loads(row[8] or "[2,3]"),
            race_stint_lap_range=json.loads(row[9] or "[3,null]"),
            pressure_band_psi=row[10] if row[10] is not None else 0.5,
            current_ambient_temp_c=row[11],
            current_track_temp_c=row[12],
            created_at=row[13] or "",
            notes=(row[14] or "") if len(row) > 14 else "",
            current_weather_condition=row[15] if len(row) > 15 else None,
        )

    # ---------- Setup ----------
    def add_setup(
        self,
        car_driver_id: str,
        name: str = "",
        data: dict[str, Any] | None = None,
        weekend_id: str | None = None,
        session_id: str | None = None,
        parent_id: str | None = None,
        id: str | None = None,
    ) -> Setup:
        id = id or str(uuid.uuid4())
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        s = Setup(
            id=id,
            car_driver_id=car_driver_id,
            name=name,
            weekend_id=weekend_id,
            session_id=session_id,
            parent_id=parent_id,
            data=data or {},
            created_at=now,
            updated_at=now,
        )
        with self._conn() as c:
            c.execute(
                """INSERT INTO setups
                   (id, car_driver_id, weekend_id, session_id, parent_id, name, data_json, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (s.id, s.car_driver_id, s.weekend_id, s.session_id, s.parent_id,
                 s.name, json.dumps(s.data), s.created_at, s.updated_at),
            )
        return s

    def get_setup(self, id: str) -> Setup | None:
        with self._conn() as c:
            row = c.execute(
                "SELECT id, car_driver_id, weekend_id, session_id, parent_id, name, data_json, created_at, updated_at FROM setups WHERE id = ?",
                (id,),
            ).fetchone()
        if not row:
            return None
        data: dict[str, Any] = {}
        if row[6]:
            try:
                data = json.loads(row[6])
            except (ValueError, TypeError):
                data = {}
        return Setup(
            id=row[0], car_driver_id=row[1], weekend_id=row[2],
            session_id=row[3], parent_id=row[4], name=row[5] or "",
            data=data, created_at=row[7] or "", updated_at=row[8] or "",
        )

    def list_setups(
        self,
        car_driver_id: str | None = None,
        weekend_id: str | None = None,
    ) -> list[Setup]:
        clauses: list[str] = []
        params: list[Any] = []
        if car_driver_id is not None:
            clauses.append("car_driver_id = ?")
            params.append(car_driver_id)
        if weekend_id is not None:
            clauses.append("weekend_id = ?")
            params.append(weekend_id)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._conn() as c:
            rows = c.execute(
                f"SELECT id, car_driver_id, weekend_id, session_id, parent_id, name, data_json, created_at, updated_at FROM setups{where} ORDER BY created_at DESC",
                params,
            ).fetchall()
        out: list[Setup] = []
        for row in rows:
            data: dict[str, Any] = {}
            if row[6]:
                try:
                    data = json.loads(row[6])
                except (ValueError, TypeError):
                    data = {}
            out.append(Setup(
                id=row[0], car_driver_id=row[1], weekend_id=row[2],
                session_id=row[3], parent_id=row[4], name=row[5] or "",
                data=data, created_at=row[7] or "", updated_at=row[8] or "",
            ))
        return out

    def update_setup(self, id: str, **kwargs: Any) -> Setup | None:
        existing = self.get_setup(id)
        if not existing:
            return None
        allowed_scalar = {"name", "weekend_id", "session_id"}
        sets: list[str] = []
        vals: list[Any] = []
        for k, v in kwargs.items():
            if k in allowed_scalar:
                sets.append(f"{k} = ?")
                vals.append(v)
            elif k == "data":
                sets.append("data_json = ?")
                vals.append(json.dumps(v) if not isinstance(v, str) else v)
        if sets:
            now = datetime.datetime.now(datetime.timezone.utc).isoformat()
            sets.append("updated_at = ?")
            vals.append(now)
            vals.append(id)
            with self._conn() as c:
                c.execute(f"UPDATE setups SET {', '.join(sets)} WHERE id = ?", vals)
        return self.get_setup(id)

    def delete_setup(self, id: str) -> None:
        with self._conn() as c:
            plan_rows = c.execute(
                "SELECT id, checklist_json FROM plans"
            ).fetchall()
            for pid, cl_json in plan_rows:
                checklist = json.loads(cl_json or "[]")
                changed = False
                for step in checklist:
                    step_sids = step.get("setup_ids", [])
                    if id in step_sids:
                        step_sids.remove(id)
                        changed = True
                if changed:
                    c.execute(
                        "UPDATE plans SET checklist_json = ? WHERE id = ?",
                        (json.dumps(checklist), pid),
                    )
            c.execute("DELETE FROM setups WHERE id = ?", (id,))

    def fork_setup(
        self,
        source_id: str,
        name: str | None = None,
        weekend_id: str | None = None,
        session_id: str | None = None,
    ) -> Setup | None:
        source = self.get_setup(source_id)
        if not source:
            return None
        fork_snapshot = source.data.get("after") if source.data.get("after") else source.data.get("before")
        if not fork_snapshot:
            fork_snapshot = {}
        new_data: dict[str, Any] = {"before": fork_snapshot}
        return self.add_setup(
            car_driver_id=source.car_driver_id,
            name=name if name is not None else source.name,
            data=new_data,
            weekend_id=weekend_id if weekend_id is not None else source.weekend_id,
            session_id=session_id,
            parent_id=source_id,
        )

    # ---------- Saved comparison (Compare view bookmarks) ----------
    def add_saved_comparison(self, name: str, session_ids: list[str], id: str | None = None) -> SavedComparison:
        id = id or str(uuid.uuid4())
        ids_clean = [str(x).strip() for x in session_ids if str(x).strip()]
        sc = SavedComparison(id=id, name=name.strip() or "Comparison", session_ids=ids_clean)
        with self._conn() as c:
            c.execute(
                "INSERT INTO saved_comparisons (id, name, session_ids_json) VALUES (?, ?, ?)",
                (sc.id, sc.name, json.dumps(sc.session_ids)),
            )
        return sc

    def get_saved_comparison(self, id: str) -> SavedComparison | None:
        with self._conn() as c:
            row = c.execute(
                "SELECT id, name, session_ids_json FROM saved_comparisons WHERE id = ?",
                (id,),
            ).fetchone()
        if not row:
            return None
        return SavedComparison(id=row[0], name=row[1], session_ids=json.loads(row[2] or "[]"))

    def list_saved_comparisons(self) -> list[SavedComparison]:
        with self._conn() as c:
            rows = c.execute("SELECT id, name, session_ids_json FROM saved_comparisons ORDER BY name COLLATE NOCASE").fetchall()
        return [SavedComparison(id=r[0], name=r[1], session_ids=json.loads(r[2] or "[]")) for r in rows]

    def update_saved_comparison(self, id: str, name: str | None = None, session_ids: list[str] | None = None) -> SavedComparison | None:
        existing = self.get_saved_comparison(id)
        if not existing:
            return None
        new_name = name.strip() if name is not None else existing.name
        new_ids = [str(x).strip() for x in session_ids if str(x).strip()] if session_ids is not None else existing.session_ids
        with self._conn() as c:
            c.execute(
                "UPDATE saved_comparisons SET name = ?, session_ids_json = ? WHERE id = ?",
                (new_name, json.dumps(new_ids), id),
            )
        return SavedComparison(id=id, name=new_name, session_ids=new_ids)

    def delete_saved_comparison(self, id: str) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM saved_comparisons WHERE id = ?", (id,))

    # ---------- Track sections ----------
    def add_track_section(self, section: TrackSection) -> TrackSection:
        section.track_name = self.normalize_track_key(section.track_name)
        with self._conn() as c:
            c.execute(
                """INSERT INTO track_sections (id, track_name, name, start_distance, end_distance, section_type, sort_order, corner_group)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (section.id, section.track_name, section.name, section.start_distance,
                 section.end_distance, section.section_type, section.sort_order, section.corner_group),
            )
        return section

    def list_track_sections(self, track_name: str) -> list[TrackSection]:
        key = self.normalize_track_key(track_name)
        with self._conn() as c:
            rows = c.execute(
                "SELECT id, track_name, name, start_distance, end_distance, section_type, sort_order, corner_group FROM track_sections WHERE track_name = ? OR track_name = ? ORDER BY sort_order",
                (key, track_name),
            ).fetchall()
        return [
            TrackSection(id=r[0], track_name=r[1], name=r[2], start_distance=r[3],
                         end_distance=r[4], section_type=r[5], sort_order=r[6],
                         corner_group=r[7] if len(r) > 7 else None)
            for r in rows
        ]

    def delete_track_sections(self, track_name: str, section_type: str | None = None) -> None:
        key = self.normalize_track_key(track_name)
        with self._conn() as c:
            if section_type:
                c.execute("DELETE FROM track_sections WHERE (track_name = ? OR track_name = ?) AND section_type = ?", (key, track_name, section_type))
            else:
                c.execute("DELETE FROM track_sections WHERE track_name = ? OR track_name = ?", (key, track_name))

    def delete_track_section(self, id: str) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM track_sections WHERE id = ?", (id,))

    # ---------- Track layouts ----------
    @staticmethod
    def normalize_track_key(name: str) -> str:
        return name.strip().casefold()

    def get_track_layout(self, track_name: str) -> dict | None:
        """Legacy helper: return the reference_lap dict for the first layout matching track_name."""
        key = self.normalize_track_key(track_name)
        with self._conn() as c:
            row = c.execute(
                "SELECT reference_lap_json FROM track_layouts WHERE LOWER(track_name) = ? ORDER BY created_at DESC LIMIT 1",
                (key,),
            ).fetchone()
        if not row or not row[0]:
            return None
        try:
            return json.loads(row[0])
        except (ValueError, TypeError):
            return None

    def get_track_layout_by_id(self, layout_id: str) -> TrackLayout | None:
        with self._conn() as c:
            row = c.execute(
                "SELECT id, name, track_name, source_session_id, source_lap_index, reference_lap_json, created_at,"
                " source_driver, source_car, source_session_name FROM track_layouts WHERE id = ?",
                (layout_id,),
            ).fetchone()
        if not row:
            return None
        return TrackLayout(id=row[0], name=row[1], track_name=row[2],
                           source_session_id=row[3], source_lap_index=row[4],
                           reference_lap_json=row[5] or "", created_at=row[6] or "",
                           source_driver=row[7], source_car=row[8], source_session_name=row[9])

    def get_track_layout_ref(self, layout_id: str) -> dict | None:
        """Return the reference_lap dict for a specific layout by id."""
        layout = self.get_track_layout_by_id(layout_id)
        if not layout or not layout.reference_lap_json:
            return None
        try:
            return json.loads(layout.reference_lap_json)
        except (ValueError, TypeError):
            return None

    def list_track_layouts(self, track_name: str | None = None) -> list[TrackLayout]:
        cols = ("id, name, track_name, source_session_id, source_lap_index,"
                " reference_lap_json, created_at, source_driver, source_car, source_session_name")
        with self._conn() as c:
            if track_name:
                key = self.normalize_track_key(track_name)
                rows = c.execute(
                    f"SELECT {cols} FROM track_layouts WHERE LOWER(track_name) = ? ORDER BY created_at DESC",
                    (key,),
                ).fetchall()
            else:
                rows = c.execute(
                    f"SELECT {cols} FROM track_layouts ORDER BY track_name, created_at DESC"
                ).fetchall()
        return [
            TrackLayout(id=r[0], name=r[1], track_name=r[2],
                        source_session_id=r[3], source_lap_index=r[4],
                        reference_lap_json=r[5] or "", created_at=r[6] or "",
                        source_driver=r[7], source_car=r[8], source_session_name=r[9])
            for r in rows
        ]

    def add_track_layout(self, name: str, track_name: str, reference_lap: dict,
                         source_session_id: str | None = None,
                         source_lap_index: int | None = None,
                         source_driver: str | None = None,
                         source_car: str | None = None,
                         source_session_name: str | None = None) -> TrackLayout:
        from datetime import datetime, timezone
        layout_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        ref_json = json.dumps(reference_lap, default=str)
        layout = TrackLayout(
            id=layout_id, name=name, track_name=track_name,
            source_session_id=source_session_id, source_lap_index=source_lap_index,
            reference_lap_json=ref_json, created_at=now,
            source_driver=source_driver, source_car=source_car,
            source_session_name=source_session_name,
        )
        with self._conn() as c:
            c.execute(
                "INSERT INTO track_layouts (id, name, track_name, source_session_id, source_lap_index,"
                " reference_lap_json, created_at, source_driver, source_car, source_session_name)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (layout.id, layout.name, layout.track_name, layout.source_session_id,
                 layout.source_lap_index, ref_json, now,
                 layout.source_driver, layout.source_car, layout.source_session_name),
            )
        return layout

    def update_track_layout(self, layout_id: str, name: str | None = None,
                            reference_lap: dict | None = None,
                            source_lap_index: int | None = None,
                            source_session_id: str | None = None,
                            source_driver: str | None = None,
                            source_car: str | None = None,
                            source_session_name: str | None = None) -> None:
        with self._conn() as c:
            sets: list[str] = []
            vals: list = []
            if name is not None:
                sets.append("name = ?")
                vals.append(name)
            if reference_lap is not None:
                sets.append("reference_lap_json = ?")
                vals.append(json.dumps(reference_lap, default=str))
            if source_lap_index is not None:
                sets.append("source_lap_index = ?")
                vals.append(source_lap_index)
            if source_session_id is not None:
                sets.append("source_session_id = ?")
                vals.append(source_session_id)
            if source_driver is not None:
                sets.append("source_driver = ?")
                vals.append(source_driver)
            if source_car is not None:
                sets.append("source_car = ?")
                vals.append(source_car)
            if source_session_name is not None:
                sets.append("source_session_name = ?")
                vals.append(source_session_name)
            if sets:
                vals.append(layout_id)
                c.execute(f"UPDATE track_layouts SET {', '.join(sets)} WHERE id = ?", vals)

    def delete_track_layout(self, layout_id: str) -> None:
        with self._conn() as c:
            c.execute("UPDATE sessions SET track_layout_id = NULL WHERE track_layout_id = ?", (layout_id,))
            c.execute("DELETE FROM track_layouts WHERE id = ?", (layout_id,))

    def upsert_track_layout(self, track_name: str, reference_lap: dict,
                            source_session_id: str | None = None,
                            source_lap_index: int | None = None,
                            source_driver: str | None = None,
                            source_car: str | None = None,
                            source_session_name: str | None = None) -> TrackLayout:
        """Legacy compat: create or update a layout for the given track name."""
        key = self.normalize_track_key(track_name)
        existing = self.list_track_layouts(track_name)
        if existing:
            layout = existing[0]
            self.update_track_layout(
                layout.id,
                reference_lap=reference_lap,
                source_lap_index=source_lap_index,
                source_session_id=source_session_id,
                source_driver=source_driver,
                source_car=source_car,
                source_session_name=source_session_name,
            )
            return layout
        return self.add_track_layout(track_name, key, reference_lap,
                                     source_session_id=source_session_id,
                                     source_lap_index=source_lap_index,
                                     source_driver=source_driver,
                                     source_car=source_car,
                                     source_session_name=source_session_name)

    # ---------- Dashboard Templates ----------

    def add_dashboard_template(self, name: str, layout: list[dict]) -> dict:
        tid = str(uuid.uuid4())
        now = datetime.datetime.utcnow().isoformat()
        with self._conn() as c:
            c.execute(
                "INSERT INTO dashboard_templates (id, name, layout_json, created_at) VALUES (?, ?, ?, ?)",
                (tid, name, json.dumps(layout), now),
            )
        return {"id": tid, "name": name, "layout": layout, "created_at": now}

    def list_dashboard_templates(self) -> list[dict]:
        with self._conn() as c:
            rows = c.execute("SELECT id, name, layout_json, created_at FROM dashboard_templates ORDER BY created_at DESC").fetchall()
        out = []
        for r in rows:
            try:
                layout = json.loads(r[2])
            except (json.JSONDecodeError, TypeError):
                layout = []
            out.append({"id": r[0], "name": r[1], "layout": layout, "created_at": r[3]})
        return out

    def get_dashboard_template(self, tid: str) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT id, name, layout_json, created_at FROM dashboard_templates WHERE id = ?", (tid,)).fetchone()
        if not row:
            return None
        try:
            layout = json.loads(row[2])
        except (json.JSONDecodeError, TypeError):
            layout = []
        return {"id": row[0], "name": row[1], "layout": layout, "created_at": row[3]}

    def update_dashboard_template(self, tid: str, name: str | None = None, layout: list[dict] | None = None) -> None:
        with self._conn() as c:
            if name is not None:
                c.execute("UPDATE dashboard_templates SET name = ? WHERE id = ?", (name, tid))
            if layout is not None:
                c.execute("UPDATE dashboard_templates SET layout_json = ? WHERE id = ?", (json.dumps(layout), tid))

    def delete_dashboard_template(self, tid: str) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM dashboard_templates WHERE id = ?", (tid,))

    # ---------- Per-session / per-comparison dashboard layouts ----------

    def get_dashboard_layout(self, session_id: str) -> list[dict] | None:
        with self._conn() as c:
            row = c.execute(
                "SELECT dashboard_layout_json FROM sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
        if not row or not row[0]:
            return None
        try:
            return json.loads(row[0])
        except (json.JSONDecodeError, TypeError):
            return None

    def save_dashboard_layout(self, session_id: str, layout: list[dict]) -> None:
        with self._conn() as c:
            c.execute(
                "UPDATE sessions SET dashboard_layout_json = ? WHERE id = ?",
                (json.dumps(layout), session_id),
            )

    def get_compare_dashboard_layout(self, comparison_id: str) -> list[dict] | None:
        with self._conn() as c:
            row = c.execute(
                "SELECT dashboard_layout_json FROM saved_comparisons WHERE id = ?",
                (comparison_id,),
            ).fetchone()
        if not row or not row[0]:
            return None
        try:
            return json.loads(row[0])
        except (json.JSONDecodeError, TypeError):
            return None

    def save_compare_dashboard_layout(self, comparison_id: str, layout: list[dict]) -> None:
        with self._conn() as c:
            c.execute(
                "UPDATE saved_comparisons SET dashboard_layout_json = ? WHERE id = ?",
                (json.dumps(layout), comparison_id),
            )
