"""SQLite store for car-drivers, sessions, weekends, tire sets."""

from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any

from .models import CarDriver, SavedComparison, Session, SessionType, TireSet, TrackLayout, TrackSection, Weekend


def _default_db_path() -> Path:
    return Path(__file__).resolve().parent / "data" / "race_data.db"


def _ensure_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def _migrate_old_db(db_path: Path) -> None:
    """Auto-rename legacy tire_pressure.db to race_data.db if needed."""
    old = db_path.parent / "tire_pressure.db"
    if not db_path.exists() and old.exists():
        old.rename(db_path)


class SessionStore:
    def __init__(self, db_path: str | Path | None = None):
        self.db_path = Path(db_path) if db_path else _default_db_path()
        _ensure_dir(self.db_path)
        _migrate_old_db(self.db_path)
        self._init_schema()

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
                    car_driver_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    session_ids_json TEXT NOT NULL,
                    FOREIGN KEY (car_driver_id) REFERENCES car_drivers(id)
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

            ts_cols = {
                row[1]
                for row in c.execute("PRAGMA table_info(track_sections)").fetchall()
            }
            if ts_cols and "corner_group" not in ts_cols:
                c.execute("ALTER TABLE track_sections ADD COLUMN corner_group INTEGER")

            # Migrate track_layouts: old schema had track_name as PK, new has id PK
            tl_cols = {
                row[1]
                for row in c.execute("PRAGMA table_info(track_layouts)").fetchall()
            }
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
        with self._conn() as c:
            c.execute(
                """INSERT INTO sessions (id, car_driver_id, session_type, track, driver, car, outing_number, session_number,
                   ambient_temp_c, track_temp_c, tire_set_id, roll_out_pressure_fl, roll_out_pressure_fr, roll_out_pressure_rl, roll_out_pressure_rr,
                   target_pressure_psi, track_layout_id, lap_count_notes, file_path, parsed_data_json, session_summary_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
                    session.tire_set_id,
                    session.roll_out_pressure_fl,
                    session.roll_out_pressure_fr,
                    session.roll_out_pressure_rl,
                    session.roll_out_pressure_rr,
                    session.target_pressure_psi,
                    session.track_layout_id,
                    session.lap_count_notes,
                    session.file_path,
                    parsed_json,
                    summary_json,
                ),
            )
        return session

    def update_session(self, session: Session) -> None:
        parsed_json = json.dumps(session.parsed_data, default=str) if session.parsed_data else None
        summary_json = self._extract_summary_json(session.parsed_data)
        with self._conn() as c:
            c.execute(
                """UPDATE sessions SET car_driver_id = ?, session_type = ?, track = ?, driver = ?, car = ?, outing_number = ?, session_number = ?,
                   ambient_temp_c = ?, track_temp_c = ?, tire_set_id = ?, roll_out_pressure_fl = ?, roll_out_pressure_fr = ?, roll_out_pressure_rl = ?, roll_out_pressure_rr = ?,
                   target_pressure_psi = ?, track_layout_id = ?, lap_count_notes = ?, file_path = ?, parsed_data_json = ?, session_summary_json = ? WHERE id = ?""",
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
                    session.tire_set_id,
                    session.roll_out_pressure_fl,
                    session.roll_out_pressure_fr,
                    session.roll_out_pressure_rl,
                    session.roll_out_pressure_rr,
                    session.target_pressure_psi,
                    session.track_layout_id,
                    session.lap_count_notes,
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
                   target_pressure_psi, track_layout_id, lap_count_notes, file_path, parsed_data_json FROM sessions WHERE id = ?""",
                (id,),
            ).fetchone()
        if not row:
            return None
        parsed = None
        if row[19]:
            try:
                parsed = json.loads(row[19])
            except (ValueError, TypeError):
                parsed = None
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
            file_path=row[18],
            parsed_data=parsed,
        )

    def list_sessions(self, car_driver_id: str | None = None) -> list[Session]:
        """List sessions. Only loads the lightweight summary, not the full blob."""
        with self._conn() as c:
            if car_driver_id:
                rows = c.execute(
                    """SELECT id, car_driver_id, session_type, track, driver, car, outing_number, session_number,
                       ambient_temp_c, track_temp_c, tire_set_id, roll_out_pressure_fl, roll_out_pressure_fr, roll_out_pressure_rl, roll_out_pressure_rr,
                       target_pressure_psi, track_layout_id, lap_count_notes, file_path, session_summary_json FROM sessions WHERE car_driver_id = ? ORDER BY track, session_type""",
                    (car_driver_id,),
                ).fetchall()
            else:
                rows = c.execute(
                    """SELECT id, car_driver_id, session_type, track, driver, car, outing_number, session_number,
                       ambient_temp_c, track_temp_c, tire_set_id, roll_out_pressure_fl, roll_out_pressure_fr, roll_out_pressure_rl, roll_out_pressure_rr,
                       target_pressure_psi, track_layout_id, lap_count_notes, file_path, session_summary_json FROM sessions ORDER BY car_driver_id, track, session_type"""
                ).fetchall()
        out = []
        for row in rows:
            summary = None
            if row[19]:
                try:
                    summary = json.loads(row[19])
                except (ValueError, TypeError):
                    summary = None
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
                    file_path=row[18],
                    parsed_data={"summary": summary} if summary else None,
                )
            )
        return out

    def delete_session(self, id: str) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM sessions WHERE id = ?", (id,))

    # ---------- Weekend ----------
    def add_weekend(self, car_driver_id: str, name: str, session_ids: list[str] | None = None, id: str | None = None) -> Weekend:
        id = id or str(uuid.uuid4())
        w = Weekend(id=id, car_driver_id=car_driver_id, name=name, session_ids=session_ids or [])
        with self._conn() as c:
            c.execute(
                "INSERT INTO weekends (id, car_driver_id, name, session_ids_json) VALUES (?, ?, ?, ?)",
                (w.id, w.car_driver_id, w.name, json.dumps(w.session_ids)),
            )
        return w

    def get_weekend(self, id: str) -> Weekend | None:
        with self._conn() as c:
            row = c.execute("SELECT id, car_driver_id, name, session_ids_json FROM weekends WHERE id = ?", (id,)).fetchone()
        if not row:
            return None
        return Weekend(id=row[0], car_driver_id=row[1], name=row[2], session_ids=json.loads(row[3] or "[]"))

    def list_weekends(self, car_driver_id: str | None = None) -> list[Weekend]:
        with self._conn() as c:
            if car_driver_id:
                rows = c.execute("SELECT id, car_driver_id, name, session_ids_json FROM weekends WHERE car_driver_id = ? ORDER BY name", (car_driver_id,)).fetchall()
            else:
                rows = c.execute("SELECT id, car_driver_id, name, session_ids_json FROM weekends ORDER BY name").fetchall()
        return [Weekend(id=r[0], car_driver_id=r[1], name=r[2], session_ids=json.loads(r[3] or "[]")) for r in rows]

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
                "SELECT id, name, track_name, source_session_id, source_lap_index, reference_lap_json, created_at FROM track_layouts WHERE id = ?",
                (layout_id,),
            ).fetchone()
        if not row:
            return None
        return TrackLayout(id=row[0], name=row[1], track_name=row[2],
                           source_session_id=row[3], source_lap_index=row[4],
                           reference_lap_json=row[5] or "", created_at=row[6] or "")

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
        with self._conn() as c:
            if track_name:
                key = self.normalize_track_key(track_name)
                rows = c.execute(
                    "SELECT id, name, track_name, source_session_id, source_lap_index, reference_lap_json, created_at FROM track_layouts WHERE LOWER(track_name) = ? ORDER BY created_at DESC",
                    (key,),
                ).fetchall()
            else:
                rows = c.execute(
                    "SELECT id, name, track_name, source_session_id, source_lap_index, reference_lap_json, created_at FROM track_layouts ORDER BY track_name, created_at DESC"
                ).fetchall()
        return [
            TrackLayout(id=r[0], name=r[1], track_name=r[2],
                        source_session_id=r[3], source_lap_index=r[4],
                        reference_lap_json=r[5] or "", created_at=r[6] or "")
            for r in rows
        ]

    def add_track_layout(self, name: str, track_name: str, reference_lap: dict,
                         source_session_id: str | None = None,
                         source_lap_index: int | None = None) -> TrackLayout:
        from datetime import datetime, timezone
        layout_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        ref_json = json.dumps(reference_lap, default=str)
        layout = TrackLayout(
            id=layout_id, name=name, track_name=track_name,
            source_session_id=source_session_id, source_lap_index=source_lap_index,
            reference_lap_json=ref_json, created_at=now,
        )
        with self._conn() as c:
            c.execute(
                "INSERT INTO track_layouts (id, name, track_name, source_session_id, source_lap_index, reference_lap_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (layout.id, layout.name, layout.track_name, layout.source_session_id,
                 layout.source_lap_index, ref_json, now),
            )
        return layout

    def update_track_layout(self, layout_id: str, name: str | None = None,
                            reference_lap: dict | None = None) -> None:
        with self._conn() as c:
            if name is not None:
                c.execute("UPDATE track_layouts SET name = ? WHERE id = ?", (name, layout_id))
            if reference_lap is not None:
                ref_json = json.dumps(reference_lap, default=str)
                c.execute("UPDATE track_layouts SET reference_lap_json = ? WHERE id = ?", (ref_json, layout_id))

    def delete_track_layout(self, layout_id: str) -> None:
        with self._conn() as c:
            c.execute("UPDATE sessions SET track_layout_id = NULL WHERE track_layout_id = ?", (layout_id,))
            c.execute("DELETE FROM track_layouts WHERE id = ?", (layout_id,))

    def upsert_track_layout(self, track_name: str, reference_lap: dict,
                            source_session_id: str | None = None,
                            source_lap_index: int | None = None) -> TrackLayout:
        """Legacy compat: create or update a layout for the given track name."""
        key = self.normalize_track_key(track_name)
        existing = self.list_track_layouts(track_name)
        if existing:
            layout = existing[0]
            self.update_track_layout(layout.id, reference_lap=reference_lap)
            return layout
        return self.add_track_layout(track_name, key, reference_lap,
                                     source_session_id=source_session_id,
                                     source_lap_index=source_lap_index)
