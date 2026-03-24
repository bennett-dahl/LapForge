"""
Race Data Analysis Tool - Flask app (localhost, offline).
Run: python -m TirePressure.app  or  flask --app TirePressure.app run
"""

from __future__ import annotations

import json
import sys
import traceback
import uuid
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from flask import (
    Flask,
    Response,
    jsonify,
    redirect,
    render_template,
    request,
    stream_with_context,
    url_for,
)

from Decoding.pi_toolbox_export import load_pi_toolbox_export
from TirePressure.models import CarDriver, Session, SessionType, TireSet, TrackSection, Weekend
from TirePressure.processing import (
    BAR_TO_PSI,
    CHART_MAX_POINTS,
    CHART_SAMPLE_RATE_HZ,
    CHART_SMOOTH_WINDOW_S,
    CHART_Y_MAX_PSI,
    CHART_Y_MIN_PSI,
    DEFAULT_TARGET_PSI,
    PIPELINE_VERSION,
    needs_reprocess as check_needs_reprocess,
    patch_pressure_summaries,
    process_session,
    process_session_incremental,
    process_session_streaming,
    sanitize_for_json,
    stale_stages,
)
from TirePressure.session_store import SessionStore
from TirePressure.tools import get_available_tools


def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.secret_key = "tire-pressure-local-only"
    app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024

    store = SessionStore()
    app.store = store  # type: ignore[attr-defined]

    PREFERENCES_PATH = Path(__file__).resolve().parent / "data" / "preferences.json"

    # ---- Preferences helpers ----

    _PREF_DEFAULTS: dict[str, Any] = {
        "target_psi": DEFAULT_TARGET_PSI,
        "default_target_pressure_psi": DEFAULT_TARGET_PSI,
        "default_temp_unit": "c",
        "default_pressure_unit": "psi",
        "default_distance_unit": "km",
        "section_lat_g_threshold": None,
        "section_min_corner_length_m": 30,
        "section_merge_gap_m": 50,
    }

    def _get_preferences() -> dict:
        base = dict(_PREF_DEFAULTS)
        if not PREFERENCES_PATH.exists():
            return base
        try:
            data = json.loads(PREFERENCES_PATH.read_text(encoding="utf-8"))
            base.update(data)
        except (json.JSONDecodeError, OSError):
            pass
        return base

    def _save_preferences(prefs: dict) -> None:
        PREFERENCES_PATH.parent.mkdir(parents=True, exist_ok=True)
        PREFERENCES_PATH.write_text(json.dumps(prefs, indent=2), encoding="utf-8")

    def _session_target_psi(session: Session) -> float:
        """Effective target PSI for a session: per-session override, else preference default."""
        if session.target_pressure_psi is not None:
            return float(session.target_pressure_psi)
        return float(_get_preferences().get("default_target_pressure_psi", DEFAULT_TARGET_PSI))

    # ---- Utility helpers ----

    PSI_TO_BAR = 1 / BAR_TO_PSI

    def _safe_float(val: str | None) -> float | None:
        if not val or not str(val).strip():
            return None
        try:
            return float(str(val).strip().replace(",", "."))
        except (ValueError, TypeError):
            return None

    def _f_to_c(f: float) -> float:
        return (f - 32) * 5 / 9

    def _temp_c_from_form(temp_unit: str | None, value: str | None) -> float | None:
        v = _safe_float(value)
        if v is None:
            return None
        if (temp_unit or "").lower() == "f":
            return _f_to_c(v)
        return v

    def _morning_pressures_from_form() -> tuple[float | None, float | None, float | None, float | None]:
        unit = (request.form.get("pressure_unit") or "bar").lower()
        is_psi = unit == "psi"
        fl = _safe_float(request.form.get("morning_pressure_fl"))
        fr = _safe_float(request.form.get("morning_pressure_fr"))
        rl = _safe_float(request.form.get("morning_pressure_rl"))
        rr = _safe_float(request.form.get("morning_pressure_rr"))
        if is_psi:
            fl = fl * PSI_TO_BAR if fl is not None else None
            fr = fr * PSI_TO_BAR if fr is not None else None
            rl = rl * PSI_TO_BAR if rl is not None else None
            rr = rr * PSI_TO_BAR if rr is not None else None
        return (fl, fr, rl, rr)

    # ---- Session data helpers ----

    def _get_parsed_for_session(session: Session) -> dict | None:
        if session.parsed_data:
            return session.parsed_data
        if session.file_path and Path(session.file_path).exists():
            try:
                return load_pi_toolbox_export(session.file_path)
            except Exception:
                return None
        return None

    def _session_summary(parsed: dict, use_psi: bool, target_psi: float | None = None) -> dict:
        """Compute pressure summary from raw parsed rows (legacy v1 fallback)."""
        rows = parsed.get("rows") or []
        pressure_cols = parsed.get("pressure_columns") or []
        if not rows or not pressure_cols:
            return {}
        if use_psi:
            cols = [c + "_psi" for c in pressure_cols if (c + "_psi") in rows[0]]
        else:
            cols = [c for c in pressure_cols if c in rows[0]]
        if not cols:
            return {}
        t_psi = target_psi if target_psi is not None else DEFAULT_TARGET_PSI
        target = t_psi if use_psi else round(t_psi / BAR_TO_PSI, 4)
        lap_splits = parsed.get("lap_split_times") or []
        time_col = "Time" if "Time" in rows[0] else "time"

        per_lap_max: dict[int, list[float]] = {}
        all_vals: list[float] = []
        for r in rows:
            t = r.get(time_col)
            lap_idx = r.get("lap_index", 0)
            if t is None:
                continue
            for c in cols:
                v = r.get(c)
                if v is not None and not (isinstance(v, float) and (v != v)):
                    try:
                        val = float(v)
                        all_vals.append(val)
                        per_lap_max.setdefault(lap_idx, []).append(val)
                    except (TypeError, ValueError):
                        pass
        global_max = max(all_vals) if all_vals else None
        global_min = min(all_vals) if all_vals else None
        laps_over = []
        for lap_idx, vals in per_lap_max.items():
            if vals and max(vals) > target:
                laps_over.append(lap_idx)
        return {
            "target": target,
            "unit": "psi" if use_psi else "bar",
            "global_min": round(global_min, 3) if global_min is not None else None,
            "global_max": round(global_max, 3) if global_max is not None else None,
            "laps_over_target": laps_over,
            "lap_count": len(per_lap_max),
            "lap_splits": lap_splits,
            "qual_note": "In range at lap start, slightly over at lap end." if not laps_over else "Some laps over target; consider lower starting pressure for qual.",
            "race_note": "Never over target; right pressure throughout." if not laps_over else "Laps over target — reduce starting pressure so steady-state stays at or just under target.",
        }

    def _build_chart_data_from_parsed(parsed: dict, use_psi: bool, target_psi: float | None = None) -> dict | None:
        """Build chart data from raw parsed rows (legacy v1 fallback)."""
        from TirePressure.processing import _smooth_linear_regression

        rows = parsed.get("rows") or []
        pressure_cols = parsed.get("pressure_columns") or []
        if not rows or not pressure_cols:
            return None
        row0_keys = list(rows[0].keys())
        time_col = (
            next((c for c in ["Time", "time"] if c in row0_keys), None)
            or next((c for c in row0_keys if c and c.lower() == "time"), None)
            or next((c for c in row0_keys if c and "time" in c.lower()), None)
            or (row0_keys[0] if row0_keys else "time")
        )
        full_times: list[float] = []
        full_series: dict[str, list[float | None]] = {c: [] for c in pressure_cols}
        for r in rows:
            t = r.get(time_col)
            if t is not None:
                full_times.append(round(float(t), 2))
                for c in pressure_cols:
                    v = r.get(c)
                    if v is not None and not (isinstance(v, float) and (v != v)):
                        try:
                            full_series[c].append(round(float(v), 4))
                        except (TypeError, ValueError):
                            full_series[c].append(None)
                    else:
                        full_series[c].append(None)
        if not full_times:
            return None
        half_win = int(CHART_SMOOTH_WINDOW_S * CHART_SAMPLE_RATE_HZ / 2)
        smoothed = {c: _smooth_linear_regression(full_series[c], half_win) for c in pressure_cols}
        step = max(1, len(full_times) // 500)
        times = full_times[::step]
        series_bar = {c: [smoothed[c][i] for i in range(0, len(full_times), step)] for c in pressure_cols}
        if use_psi:
            series = {c: [round((v or 0) * BAR_TO_PSI, 4) if v is not None else None for v in series_bar[c]] for c in series_bar}
        else:
            series = series_bar
        t_psi = target_psi if target_psi is not None else DEFAULT_TARGET_PSI
        t_bar = round(t_psi / BAR_TO_PSI, 4)
        if use_psi:
            y_min, y_max = CHART_Y_MIN_PSI, CHART_Y_MAX_PSI
        else:
            y_min = round(CHART_Y_MIN_PSI / BAR_TO_PSI, 4)
            y_max = round(CHART_Y_MAX_PSI / BAR_TO_PSI, 4)
        return {
            "times": times,
            "series": series,
            "lap_splits": parsed.get("lap_split_times") or [],
            "target": t_psi if use_psi else t_bar,
            "unit": "psi" if use_psi else "bar",
            "yMin": y_min,
            "yMax": y_max,
        }

    def _build_chart_data_v2(session_data: dict, use_psi: bool, target_psi: float | None = None) -> dict | None:
        """Build chart data from v2 processed blob."""
        times = session_data.get("times") or []
        series_raw = session_data.get("series") or {}
        lap_splits = session_data.get("lap_splits") or []

        pressure_keys = [k for k in series_raw if "tpms_press" in k.lower()]
        if not times or not pressure_keys:
            return None

        if use_psi:
            series = {c: [round((v or 0) * BAR_TO_PSI, 4) if v is not None else None for v in series_raw[c]] for c in pressure_keys}
        else:
            series = {c: list(series_raw[c]) for c in pressure_keys}

        t_psi = target_psi if target_psi is not None else DEFAULT_TARGET_PSI
        t_bar = round(t_psi / BAR_TO_PSI, 4)
        if use_psi:
            y_min, y_max = CHART_Y_MIN_PSI, CHART_Y_MAX_PSI
        else:
            y_min = round(CHART_Y_MIN_PSI / BAR_TO_PSI, 4)
            y_max = round(CHART_Y_MAX_PSI / BAR_TO_PSI, 4)

        return {
            "times": times,
            "series": series,
            "lap_splits": lap_splits,
            "target": t_psi if use_psi else t_bar,
            "unit": "psi" if use_psi else "bar",
            "yMin": y_min,
            "yMax": y_max,
        }

    # ---- Context processor for unit defaults ----

    @app.context_processor
    def inject_unit_defaults():
        prefs = _get_preferences()
        eff_pressure = request.args.get("unit", "").lower()
        if eff_pressure not in ("psi", "bar"):
            eff_pressure = prefs.get("default_pressure_unit", "psi")
        eff_temp = request.args.get("temp_unit", "").lower()
        if eff_temp not in ("c", "f"):
            eff_temp = prefs.get("default_temp_unit", "c")
        eff_distance = prefs.get("default_distance_unit", "km")
        return {
            "default_pressure_unit": eff_pressure,
            "default_temp_unit": eff_temp,
            "default_distance_unit": eff_distance,
        }

    # ---- Error handler ----

    @app.errorhandler(500)
    def internal_error(e):
        tb = traceback.format_exc()
        print(tb, flush=True)
        return f"<pre>Internal error:\n{tb}</pre>", 500

    # ---- Core routes ----

    @app.route("/")
    def index():
        car_drivers = store.list_car_drivers()
        active_id = request.args.get("car_driver_id") or (car_drivers[0].id if car_drivers else None)
        return render_template("index.html", car_drivers=car_drivers, active_car_driver_id=active_id)

    @app.route("/settings", methods=["GET", "POST"])
    def settings():
        if request.method == "POST":
            prefs = _get_preferences()
            v = _safe_float(request.form.get("default_target_pressure_psi"))
            if v is not None:
                prefs["default_target_pressure_psi"] = max(14.0, min(35.0, v))
                prefs["target_psi"] = prefs["default_target_pressure_psi"]
            for key in ("default_temp_unit", "default_pressure_unit", "default_distance_unit"):
                val = request.form.get(key, "").strip().lower()
                if val:
                    prefs[key] = val
            # Section detection thresholds
            lat_g_raw = request.form.get("section_lat_g_threshold", "").strip()
            if lat_g_raw:
                prefs["section_lat_g_threshold"] = max(0.05, min(1.0, float(lat_g_raw)))
            else:
                prefs["section_lat_g_threshold"] = None
            for skey, default, lo, hi in [
                ("section_min_corner_length_m", 30, 5, 200),
                ("section_merge_gap_m", 50, 5, 200),
            ]:
                sv = _safe_float(request.form.get(skey))
                prefs[skey] = max(lo, min(hi, sv)) if sv is not None else default
            _save_preferences(prefs)
            return redirect(url_for("settings"))
        return render_template("settings.html", prefs=_get_preferences())

    @app.route("/car_drivers")
    def car_drivers_list():
        return render_template("car_drivers.html", car_drivers=store.list_car_drivers())

    @app.route("/car_drivers/add", methods=["GET", "POST"])
    def car_driver_add():
        if request.method == "POST":
            car_identifier = request.form.get("car_identifier", "").strip()
            driver_name = request.form.get("driver_name", "").strip()
            if car_identifier and driver_name:
                store.add_car_driver(car_identifier=car_identifier, driver_name=driver_name)
                return redirect(url_for("car_drivers_list"))
        return render_template("car_driver_edit.html", car_driver=None)

    @app.route("/car_drivers/<id>/edit", methods=["GET", "POST"])
    def car_driver_edit(id: str):
        cd = store.get_car_driver(id)
        if not cd:
            return redirect(url_for("car_drivers_list"))
        if request.method == "POST":
            cd.car_identifier = request.form.get("car_identifier", "").strip()
            cd.driver_name = request.form.get("driver_name", "").strip()
            store.update_car_driver(cd)
            return redirect(url_for("car_drivers_list"))
        return render_template("car_driver_edit.html", car_driver=cd)

    @app.route("/car_drivers/<id>/delete", methods=["POST"])
    def car_driver_delete(id: str):
        store.delete_car_driver(id)
        return redirect(url_for("car_drivers_list"))

    @app.route("/tire_sets")
    def tire_sets_list():
        car_driver_id = request.args.get("car_driver_id")
        pressure_unit = request.args.get("pressure_unit", "bar").lower()
        if pressure_unit not in ("bar", "psi"):
            pressure_unit = "bar"
        tire_sets = store.list_tire_sets(car_driver_id=car_driver_id)
        car_drivers = store.list_car_drivers()
        return render_template("tire_sets.html", tire_sets=tire_sets, car_drivers=car_drivers, filter_car_driver_id=car_driver_id, pressure_unit=pressure_unit)

    @app.route("/tire_sets/add", methods=["GET", "POST"])
    def tire_set_add():
        car_drivers = store.list_car_drivers()
        pressure_unit = request.args.get("pressure_unit", "bar").lower()
        if pressure_unit not in ("bar", "psi"):
            pressure_unit = "bar"
        if request.method == "POST":
            name = request.form.get("name", "").strip()
            car_driver_id = request.form.get("car_driver_id") or None
            if name:
                store.add_tire_set(name=name, car_driver_id=car_driver_id, morning_pressures=_morning_pressures_from_form())
                return redirect(url_for("tire_sets_list", car_driver_id=car_driver_id))
        return render_template("tire_set_edit.html", tire_set=None, car_drivers=car_drivers, pressure_unit=pressure_unit)

    @app.route("/tire_sets/<id>/edit", methods=["GET", "POST"])
    def tire_set_edit(id: str):
        ts = store.get_tire_set(id)
        if not ts:
            return redirect(url_for("tire_sets_list"))
        car_drivers = store.list_car_drivers()
        pressure_unit = request.args.get("pressure_unit", "bar").lower()
        if pressure_unit not in ("bar", "psi"):
            pressure_unit = "bar"
        if request.method == "POST":
            ts.name = request.form.get("name", "").strip()
            ts.car_driver_id = request.form.get("car_driver_id") or None
            fl, fr, rl, rr = _morning_pressures_from_form()
            ts.morning_pressure_fl = fl
            ts.morning_pressure_fr = fr
            ts.morning_pressure_rl = rl
            ts.morning_pressure_rr = rr
            store.update_tire_set(ts)
            return redirect(url_for("tire_sets_list", car_driver_id=ts.car_driver_id))
        return render_template("tire_set_edit.html", tire_set=ts, car_drivers=car_drivers, pressure_unit=pressure_unit)

    @app.route("/tire_sets/<id>/delete", methods=["POST"])
    def tire_set_delete(id: str):
        store.delete_tire_set(id)
        return redirect(url_for("tire_sets_list"))

    @app.route("/sessions")
    def sessions_list():
        car_driver_id = request.args.get("car_driver_id")
        compare_ids = request.args.get("compare_ids", "").strip()
        sessions = store.list_sessions(car_driver_id=car_driver_id)
        car_drivers = store.list_car_drivers()
        return render_template("sessions.html", sessions=sessions, car_drivers=car_drivers, filter_car_driver_id=car_driver_id, compare_ids=compare_ids)

    # ---- Upload ----

    @app.route("/upload", methods=["GET", "POST"])
    def upload():
        car_drivers = store.list_car_drivers()
        active_id = request.args.get("car_driver_id") or (car_drivers[0].id if car_drivers else None)
        if request.method == "GET":
            temp_unit = request.args.get("temp_unit", "c").lower()
            if temp_unit not in ("c", "f"):
                temp_unit = "c"
            return render_template("upload.html", car_drivers=car_drivers, active_car_driver_id=active_id, parsed=None, form_metadata=None, tire_sets=store.list_tire_sets(), filter_car_driver_id=active_id, temp_unit=temp_unit)

        if request.form.get("save") == "1":
            session_type_val = request.form.get("session_type")
            car_driver_id = request.form.get("car_driver_id") or active_id
            if not car_driver_id:
                return render_template("upload.html", car_drivers=car_drivers, active_car_driver_id=active_id, parsed=None, form_metadata=None, tire_sets=store.list_tire_sets(), filter_car_driver_id=active_id, temp_unit="c", error="Select or create a car/driver.")
            try:
                session_type = SessionType(session_type_val or "Practice 1")
            except ValueError:
                session_type = SessionType.PRACTICE_1
            session_id = str(uuid.uuid4())
            uploads_dir = Path(__file__).resolve().parent / "data" / "uploads"
            uploads_dir.mkdir(parents=True, exist_ok=True)
            persistent_path = uploads_dir / f"{session_id}.txt"
            import shutil
            upload_path_str = request.form.get("upload_path")
            if not upload_path_str or not Path(upload_path_str).exists():
                return render_template("upload.html", car_drivers=car_drivers, active_car_driver_id=active_id, parsed=None, form_metadata=None, tire_sets=store.list_tire_sets(), filter_car_driver_id=active_id, temp_unit="c", error="Upload file missing. Please upload and parse again.")

            default_target = float(_get_preferences().get("default_target_pressure_psi", DEFAULT_TARGET_PSI))

            def _build_session(processed: dict) -> Session:
                return Session(
                    id=session_id,
                    car_driver_id=car_driver_id,
                    session_type=session_type,
                    track=request.form.get("track", ""),
                    driver=request.form.get("driver", ""),
                    car=request.form.get("car", ""),
                    outing_number=request.form.get("outing_number", ""),
                    session_number=request.form.get("session_number", ""),
                    target_pressure_psi=default_target,
                    file_path=str(persistent_path),
                    parsed_data=sanitize_for_json(processed),
                )

            if request.form.get("stream") == "1":
                def save_stream():
                    try:
                        yield "PROGRESS:0\n"
                        parsed = load_pi_toolbox_export(upload_path_str)
                        yield "PROGRESS:10\n"
                        processed = None
                        for pct, stage_label, data in process_session_streaming(parsed, target_psi=default_target):
                            label_part = f":{stage_label}" if stage_label else ""
                            yield f"PROGRESS:{pct}{label_part}\n"
                            if data is not None:
                                processed = data
                        if processed is None:
                            yield "ERROR:Processing failed\n"
                            return
                        shutil.copy2(upload_path_str, persistent_path)
                        Path(upload_path_str).unlink(missing_ok=True)
                        session = _build_session(processed)
                        store.add_session(session)
                        detail_url = url_for("session_detail", id=session_id)
                        yield f"PROGRESS:100\nREDIRECT:{detail_url}\n"
                    except Exception as e:
                        yield f"ERROR:{str(e)}\n"

                return Response(stream_with_context(save_stream()), content_type="text/plain; charset=utf-8")

            try:
                parsed = load_pi_toolbox_export(upload_path_str)
                processed = process_session(parsed, target_psi=default_target)
            except Exception as e:
                return render_template("upload.html", car_drivers=car_drivers, active_car_driver_id=active_id, parsed=None, form_metadata=None, tire_sets=store.list_tire_sets(), filter_car_driver_id=active_id, temp_unit="c", error=f"Process failed: {e}")
            shutil.copy2(upload_path_str, persistent_path)
            Path(upload_path_str).unlink(missing_ok=True)
            session = _build_session(processed)
            store.add_session(session)
            return redirect(url_for("session_detail", id=session_id))

        f = request.files.get("file")
        if not f or not f.filename:
            return render_template("upload.html", car_drivers=car_drivers, active_car_driver_id=active_id, parsed=None, form_metadata=None, tire_sets=[], temp_unit="c", error="Select a file.")
        if not f.filename.lower().endswith(".txt"):
            return render_template("upload.html", car_drivers=car_drivers, active_car_driver_id=active_id, parsed=None, form_metadata=None, tire_sets=[], temp_unit="c", error="File must be .txt")

        import tempfile
        path = Path(tempfile.gettempdir()) / f"tire_upload_{uuid.uuid4().hex}.txt"
        try:
            f.save(str(path))
            parsed = load_pi_toolbox_export(path)
        except Exception as e:
            return render_template("upload.html", car_drivers=car_drivers, active_car_driver_id=active_id, parsed=None, form_metadata=None, tire_sets=[], temp_unit="c", error=str(e))
        meta = parsed.get("metadata") or {}
        form_metadata = {
            "car": meta.get("CarName", ""),
            "driver": meta.get("DriverName", ""),
            "track": meta.get("TrackName", ""),
            "outing_number": meta.get("OutingNumber", ""),
            "session_number": meta.get("SessionNumber", ""),
        }
        tire_sets = store.list_tire_sets()
        temp_unit = request.args.get("temp_unit", "c").lower()
        if temp_unit not in ("c", "f"):
            temp_unit = "c"
        return render_template("upload.html", car_drivers=car_drivers, active_car_driver_id=active_id, parsed=parsed, form_metadata=form_metadata, tire_sets=tire_sets, filter_car_driver_id=active_id, upload_path=str(path), temp_unit=temp_unit)

    # ---- Session detail and analysis ----

    @app.route("/sessions/<id>/delete", methods=["POST"])
    def session_delete(id: str):
        session = store.get_session(id)
        car_driver_id = session.car_driver_id if session else None
        store.delete_session(id)
        return redirect(url_for("sessions_list", car_driver_id=car_driver_id))

    @app.route("/sessions/<id>/edit", methods=["POST"])
    def session_edit(id: str):
        session = store.get_session(id)
        if not session:
            return redirect(url_for("sessions_list"))
        session.ambient_temp_c = _temp_c_from_form(
            request.form.get("temp_unit"), request.form.get("ambient_temp_c"),
        )
        session.track_temp_c = _temp_c_from_form(
            request.form.get("temp_unit"), request.form.get("track_temp_c"),
        )
        session.tire_set_id = request.form.get("tire_set_id") or None
        session.roll_out_pressure_fl = _safe_float(request.form.get("roll_out_pressure_fl"))
        session.roll_out_pressure_fr = _safe_float(request.form.get("roll_out_pressure_fr"))
        session.roll_out_pressure_rl = _safe_float(request.form.get("roll_out_pressure_rl"))
        session.roll_out_pressure_rr = _safe_float(request.form.get("roll_out_pressure_rr"))
        session.lap_count_notes = request.form.get("lap_count_notes") or None

        new_target = _safe_float(request.form.get("target_pressure_psi"))
        if new_target is not None:
            new_target = max(14.0, min(35.0, new_target))
        old_target = session.target_pressure_psi
        session.target_pressure_psi = new_target

        if (new_target != old_target
                and new_target is not None
                and isinstance(session.parsed_data, dict)
                and session.parsed_data.get("version") == 2):
            patch_pressure_summaries(session.parsed_data, new_target)

        store.update_session(session)
        unit = request.form.get("unit", "psi")
        tool = request.form.get("tool", "dashboard")
        return redirect(url_for("session_detail", id=id, unit=unit, tool=tool))

    @app.route("/sessions/<id>/simplify", methods=["POST"])
    def session_simplify(id: str):
        session = store.get_session(id)
        if not session or not session.file_path or not Path(session.file_path).exists():
            return redirect(url_for("session_detail", id=id))
        try:
            parsed = load_pi_toolbox_export(session.file_path)
            proc = session.parsed_data or {}
            level = int(proc.get("smoothing_level", 0)) + 1
            processed = process_session(parsed, smoothing_level=level, target_psi=_session_target_psi(session))
            session.parsed_data = processed
            store.update_session(session)
        except Exception:
            pass
        return redirect(url_for("session_detail", id=id))

    @app.route("/sessions/<id>/restore", methods=["POST"])
    def session_restore(id: str):
        session = store.get_session(id)
        if not session or not session.file_path or not Path(session.file_path).exists():
            return redirect(url_for("session_detail", id=id))

        stream_mode = request.form.get("stream") == "1" or request.args.get("stream") == "1"

        if stream_mode:
            def restore_stream():
                try:
                    existing = session.parsed_data if isinstance(session.parsed_data, dict) else None
                    _stale = stale_stages(existing) if existing else []
                    can_incremental = existing and "core" not in _stale and len(_stale) > 0
                    yield "PROGRESS:0\n"
                    parsed = load_pi_toolbox_export(session.file_path)
                    yield "PROGRESS:5\n"

                    processed = None
                    if can_incremental:
                        gen = process_session_incremental(
                            parsed, existing,
                            target_psi=_session_target_psi(session),
                        )
                    else:
                        gen = process_session_streaming(
                            parsed, target_psi=_session_target_psi(session),
                        )
                    for pct, stage_label, data in gen:
                        label_part = f":{stage_label}" if stage_label else ""
                        yield f"PROGRESS:{pct}{label_part}\n"
                        if data is not None:
                            processed = data

                    if processed is None:
                        yield "ERROR:Processing failed\n"
                        return
                    session.parsed_data = sanitize_for_json(processed)
                    store.update_session(session)
                    detail_url = url_for("session_detail", id=id)
                    yield f"PROGRESS:100\nREDIRECT:{detail_url}\n"
                except Exception as e:
                    yield f"ERROR:{str(e)}\n"
            return Response(stream_with_context(restore_stream()), content_type="text/plain; charset=utf-8")

        try:
            parsed = load_pi_toolbox_export(session.file_path)
            processed = process_session(parsed, smoothing_level=0, target_psi=_session_target_psi(session))
            session.parsed_data = sanitize_for_json(processed)
            store.update_session(session)
        except Exception:
            pass
        return redirect(url_for("session_detail", id=id))

    # ---- Track Sections API ----

    @app.route("/api/sections/<track_name>", methods=["GET"])
    def api_list_sections(track_name: str):
        sections = store.list_track_sections(track_name)
        return jsonify([s.to_dict() for s in sections])

    @app.route("/api/sections/<track_name>", methods=["POST"])
    def api_save_sections(track_name: str):
        data = request.get_json(silent=True) or {}
        incoming = data.get("sections", [])
        store.delete_track_sections(track_name)
        saved = []
        for i, raw in enumerate(incoming):
            cg = raw.get("cornerGroup") or raw.get("corner_group")
            sec = TrackSection(
                id=raw.get("id") or str(uuid.uuid4()),
                track_name=track_name,
                name=raw.get("name", f"Section {i + 1}"),
                start_distance=float(raw.get("start_distance", 0)),
                end_distance=float(raw.get("end_distance", 0)),
                section_type=raw.get("section_type", "manual"),
                sort_order=i,
                corner_group=int(cg) if cg is not None else None,
            )
            store.add_track_section(sec)
            saved.append(sec.to_dict())

        ref_lap = data.get("reference_lap")
        source_session_id = data.get("session_id")
        source_lap_index = None
        if not ref_lap:
            if source_session_id:
                sess = store.get_session(source_session_id)
                if sess and isinstance(sess.parsed_data, dict):
                    ref_lap = sess.parsed_data.get("reference_lap")
        if ref_lap and isinstance(ref_lap, dict):
            source_lap_index = ref_lap.get("lap_index")
            store.upsert_track_layout(track_name, ref_lap,
                                      source_session_id=source_session_id,
                                      source_lap_index=source_lap_index)

        return jsonify({"ok": True, "sections": saved})

    @app.route("/api/sections/<track_name>/<section_id>", methods=["DELETE"])
    def api_delete_section(track_name: str, section_id: str):
        store.delete_track_section(section_id)
        return jsonify({"ok": True})

    # ---------- Track Layouts ----------

    @app.route("/track-layouts")
    def track_layouts_list():
        layouts = store.list_track_layouts()
        sessions = store.list_sessions()
        session_map = {s.id: s for s in sessions}
        return render_template("track_layouts.html", layouts=layouts, session_map=session_map)

    @app.route("/api/track-layouts", methods=["POST"])
    def api_create_track_layout():
        data = request.get_json(force=True)
        name = (data.get("name") or "").strip()
        source_session_id = data.get("source_session_id")
        source_lap_index = data.get("source_lap_index")
        if not name:
            return jsonify({"error": "Name is required"}), 400
        if not source_session_id:
            return jsonify({"error": "Source session is required"}), 400
        sess = store.get_session(source_session_id)
        if not sess or not isinstance(sess.parsed_data, dict):
            return jsonify({"error": "Session not found or has no data"}), 404
        ref_lap = sess.parsed_data.get("reference_lap")
        if not ref_lap:
            return jsonify({"error": "Session has no reference lap data"}), 400
        track_name = sess.track or "unknown"
        layout = store.add_track_layout(
            name=name, track_name=track_name, reference_lap=ref_lap,
            source_session_id=source_session_id,
            source_lap_index=source_lap_index if source_lap_index is not None else ref_lap.get("lap_index"),
        )
        return jsonify({"ok": True, "layout": layout.to_dict()})

    @app.route("/api/track-layouts/<layout_id>", methods=["PATCH"])
    def api_update_track_layout(layout_id: str):
        data = request.get_json(force=True)
        name = data.get("name")
        if name is not None:
            name = name.strip()
            if not name:
                return jsonify({"error": "Name cannot be empty"}), 400
        store.update_track_layout(layout_id, name=name)
        return jsonify({"ok": True})

    @app.route("/api/track-layouts/<layout_id>", methods=["DELETE"])
    def api_delete_track_layout(layout_id: str):
        store.delete_track_layout(layout_id)
        return jsonify({"ok": True})

    @app.route("/api/sessions/<session_id>/track-layout", methods=["PATCH"])
    def api_set_session_layout(session_id: str):
        data = request.get_json(force=True)
        layout_id = data.get("track_layout_id")  # None to clear
        sess = store.get_session(session_id)
        if not sess:
            return jsonify({"error": "Session not found"}), 404
        sess.track_layout_id = layout_id
        store.update_session(sess)
        return jsonify({"ok": True})

    @app.route("/sessions/<id>")
    def session_detail(id: str):
        session = store.get_session(id)
        if not session:
            return redirect(url_for("sessions_list"))

        use_psi = request.args.get("unit", "psi").lower() == "psi"
        use_fahrenheit = request.args.get("temp_unit", "c").lower() == "f"
        default_tool = "dashboard" if (isinstance(session.parsed_data, dict) and session.parsed_data.get("version") == 2) else "tire_pressure"
        active_tool = request.args.get("tool", default_tool)
        tire_set = store.get_tire_set(session.tire_set_id) if session.tire_set_id else None
        car_driver = store.get_car_driver(session.car_driver_id)

        summary = None
        chart_data = None
        parsed = None
        session_data = None
        tool_data = None

        is_v2 = (
            isinstance(session.parsed_data, dict)
            and session.parsed_data.get("version") == 2
        )

        _needs_reprocess = False
        if is_v2:
            if check_needs_reprocess(session.parsed_data) and session.file_path and Path(session.file_path).exists():
                _needs_reprocess = True

        if is_v2:
            session_data = session.parsed_data
            summary_blob = session_data.get("summary") or {}
            summary = summary_blob.get("pressure_summary_psi") if use_psi else summary_blob.get("pressure_summary_bar")
            chart_data = _build_chart_data_v2(session_data, use_psi, target_psi=_session_target_psi(session))
            parsed = session_data

            # Tool registry
            channel_list = summary_blob.get("channel_list") or session_data.get("columns") or []
            channel_meta = session_data.get("channel_meta") or {}
            available_tools = get_available_tools(channel_list, channel_meta)
            current_tool = next((t for t in available_tools if t["tool_name"] == active_tool), None)
            session_target = _session_target_psi(session)
            if current_tool and current_tool.get("available") and current_tool.get("prepare_data"):
                _prefs = _get_preferences()
                tool_opts: dict[str, Any] = {
                    "use_psi": use_psi,
                    "target_psi": session_target,
                    "channel_meta": channel_meta,
                    "section_lat_g_threshold": _prefs.get("section_lat_g_threshold"),
                    "section_min_corner_length_m": _prefs.get("section_min_corner_length_m", 30),
                    "section_merge_gap_m": _prefs.get("section_merge_gap_m", 50),
                }
                if active_tool in ("section_generator", "section_metrics", "track_map"):
                    saved = store.list_track_sections(session.track)
                    if saved and not (active_tool == "section_generator" and request.args.get("regen")):
                        tool_opts["saved_sections"] = [s.to_dict() for s in saved]
                        if active_tool == "section_metrics":
                            tool_opts["sections"] = tool_opts["saved_sections"]
                    layout = None
                    if session.track_layout_id:
                        layout = store.get_track_layout_ref(session.track_layout_id)
                    if not layout:
                        layout = store.get_track_layout(session.track)
                    if layout:
                        session_data = dict(session_data)
                        session_data["reference_lap"] = layout
                tool_data = current_tool["prepare_data"](session_data, tool_opts)

                if active_tool == "section_generator" and tool_data and tool_data.get("has_data"):
                    ref_lap = session_data.get("reference_lap") or {}
                    lap_idx = ref_lap.get("lap_index")
                    full_dists = session_data.get("distances") or []
                    raw_series = session_data.get("series") or {}
                    split_dists = session_data.get("lap_split_distances") or []
                    gps_dists = tool_data.get("distances") or []
                    if lap_idx is not None and full_dists and raw_series and gps_dists:
                        lap_start_d = split_dists[lap_idx] if lap_idx < len(split_dists) else 0
                        lap_end_d = split_dists[lap_idx + 1] if (lap_idx + 1) < len(split_dists) else (full_dists[-1] if full_dists else 0)
                        si = next((i for i, d in enumerate(full_dists) if d >= lap_start_d), 0)
                        ei = next((i for i, d in enumerate(full_dists) if d >= lap_end_d), len(full_dists))
                        lap_dists_rel = [d - lap_start_d for d in full_dists[si:ei]]

                        def _resample_to_gps(src_d: list, src_v: list, tgt_d: list) -> list:
                            """Linear interpolation of src_v(src_d) onto tgt_d."""
                            out = []
                            j = 0
                            n = len(src_d)
                            for td in tgt_d:
                                while j < n - 1 and src_d[j + 1] < td:
                                    j += 1
                                if j >= n - 1:
                                    out.append(src_v[-1] if src_v else None)
                                elif src_d[j + 1] == src_d[j]:
                                    out.append(src_v[j])
                                else:
                                    f = (td - src_d[j]) / (src_d[j + 1] - src_d[j])
                                    v0, v1 = src_v[j], src_v[j + 1]
                                    if v0 is None or v1 is None:
                                        out.append(v0 if v0 is not None else v1)
                                    else:
                                        out.append(v0 + f * (v1 - v0))
                            return out

                        editor_series: dict[str, Any] = {}
                        editor_meta: dict[str, Any] = {}
                        for cname, vals in raw_series.items():
                            cmeta = channel_meta.get(cname, {})
                            cat = cmeta.get("category", "")
                            if cat in ("timing", "gps", "derived", "unknown"):
                                continue
                            lap_vals = vals[si:ei]
                            editor_series[cname] = _resample_to_gps(lap_dists_rel, lap_vals, gps_dists)
                            editor_meta[cname] = cmeta
                        editor_by_cat: dict[str, list[dict]] = {}
                        for cname, cmeta_item in editor_meta.items():
                            cat = cmeta_item.get("category", "other")
                            editor_by_cat.setdefault(cat, []).append({
                                "name": cname,
                                "display": cmeta_item.get("display", cname),
                                "unit": cmeta_item.get("unit", ""),
                                "color": cmeta_item.get("color", "#888"),
                            })
                        tool_data["editor_chart"] = sanitize_for_json({
                            "distances": gps_dists,
                            "series": editor_series,
                            "channel_meta": editor_meta,
                            "channels_by_category": editor_by_cat,
                        })

            # Prepare dashboard data for v2 sessions
            dashboard_data: dict[str, Any] | None = None
            if active_tool == "dashboard":
                stored_layout = None
                if session.track_layout_id:
                    stored_layout = store.get_track_layout_ref(session.track_layout_id)
                if not stored_layout:
                    stored_layout = store.get_track_layout(session.track)
                ref = stored_layout if stored_layout else session_data.get("reference_lap")
                lap_splits = session_data.get("lap_splits") or []
                lap_times = []
                for li in range(len(lap_splits) - 1):
                    dt = lap_splits[li + 1] - lap_splits[li]
                    if dt > 0:
                        lap_times.append({"index": li + 1, "time": round(dt, 3)})

                raw_series = session_data.get("series") or {}
                dash_series: dict[str, Any] = {}
                dash_meta = dict(channel_meta)
                for cname, vals in raw_series.items():
                    cmeta = channel_meta.get(cname, {})
                    if use_psi and cmeta.get("unit") == "bar" and cmeta.get("category") == "pressure":
                        dash_series[cname] = [
                            round(v * BAR_TO_PSI, 4) if v is not None else None
                            for v in vals
                        ]
                        dash_meta[cname] = {**cmeta, "unit": "psi"}
                    else:
                        dash_series[cname] = vals

                channels_by_cat: dict[str, list[dict]] = {}
                skip_cats = {"timing", "gps", "derived"}
                for cname, cmeta_item in dash_meta.items():
                    cat = cmeta_item.get("category", "unknown")
                    if cat in skip_cats or cname not in dash_series:
                        continue
                    channels_by_cat.setdefault(cat, []).append({
                        "name": cname,
                        "display": cmeta_item.get("display", cname),
                        "unit": cmeta_item.get("unit", ""),
                        "color": cmeta_item.get("color", "#888"),
                        "category": cat,
                    })

                raw_pres_chart = session_data.get("raw_pressure_chart") or {}
                raw_pres_out: dict[str, Any] = {}
                for cname, vals in raw_pres_chart.items():
                    cmeta = channel_meta.get(cname, {})
                    if use_psi and cmeta.get("unit") == "bar":
                        raw_pres_out[cname] = [
                            round(v * BAR_TO_PSI, 4) if v is not None else None for v in vals
                        ]
                    else:
                        raw_pres_out[cname] = vals

                session_target_psi = _session_target_psi(session)
                target_val = session_target_psi if use_psi else round(session_target_psi / BAR_TO_PSI, 4)
                target_unit = "psi" if use_psi else "bar"

                dashboard_data = sanitize_for_json({
                    "session_id": session.id,
                    "times": session_data.get("times") or [],
                    "distances": session_data.get("distances") or [],
                    "series": dash_series,
                    "channel_meta": dash_meta,
                    "channels_by_category": channels_by_cat,
                    "lap_splits": lap_splits,
                    "lap_split_distances": session_data.get("lap_split_distances") or [],
                    "lap_times": lap_times,
                    "has_distance": bool(session_data.get("distances")),
                    "reference_lap": {
                        "lat": ref.get("lat") or [],
                        "lon": ref.get("lon") or [],
                        "heading": ref.get("heading") or [],
                        "distance": ref.get("distance") or [],
                        "lap_index": ref.get("lap_index"),
                        "lap_time": ref.get("lap_time"),
                    } if ref else None,
                    "fastest_lap_index": summary_blob.get("fastest_lap_index"),
                    "target_psi": target_val,
                    "target_unit": target_unit,
                    "raw_pressure_series": raw_pres_out,
                })
        else:
            available_tools = get_available_tools([])
            current_tool = None
            dashboard_data = None

            if isinstance(session.parsed_data, dict) and session.parsed_data.get("processed"):
                proc = session.parsed_data
                summary = proc.get("summary_psi") if use_psi else proc.get("summary_bar")
                times = proc.get("times") or []
                series_bar = proc.get("series") or {}
                if times and series_bar:
                    if use_psi:
                        series = {c: [round((v or 0) * BAR_TO_PSI, 4) if v is not None else None for v in series_bar[c]] for c in series_bar}
                    else:
                        series = series_bar
                    t_psi = _session_target_psi(session)
                    t_bar = round(t_psi / BAR_TO_PSI, 4)
                    if use_psi:
                        y_min, y_max = CHART_Y_MIN_PSI, CHART_Y_MAX_PSI
                    else:
                        y_min = round(CHART_Y_MIN_PSI / BAR_TO_PSI, 4)
                        y_max = round(CHART_Y_MAX_PSI / BAR_TO_PSI, 4)
                    chart_data = {
                        "times": times,
                        "series": series,
                        "lap_splits": proc.get("lap_splits") or [],
                        "target": t_psi if use_psi else t_bar,
                        "unit": "psi" if use_psi else "bar",
                        "yMin": y_min,
                        "yMax": y_max,
                    }
                parsed = proc

            if chart_data is None and session.file_path and Path(session.file_path).exists():
                try:
                    file_parsed = load_pi_toolbox_export(session.file_path)
                except Exception:
                    file_parsed = None
                if file_parsed and file_parsed.get("rows") and file_parsed.get("pressure_columns"):
                    if summary is None:
                        summary = _session_summary(file_parsed, use_psi, target_psi=_session_target_psi(session))
                    parsed = file_parsed
                    chart_data = _build_chart_data_from_parsed(file_parsed, use_psi, target_psi=_session_target_psi(session))

            if chart_data is None:
                parsed = _get_parsed_for_session(session)
                summary = _session_summary(parsed, use_psi, target_psi=_session_target_psi(session)) if summary is None and parsed else summary
                if parsed and parsed.get("rows") and parsed.get("pressure_columns"):
                    chart_data = _build_chart_data_from_parsed(parsed, use_psi, target_psi=_session_target_psi(session))

        can_reprocess = bool(session.file_path and Path(session.file_path).exists())
        smoothing_level = int(session.parsed_data.get("smoothing_level", 0)) if (isinstance(session.parsed_data, dict) and session.parsed_data.get("processed")) else 0

        return render_template(
            "session_detail.html",
            session=session,
            parsed=parsed,
            summary=summary,
            tire_set=tire_set,
            car_driver=car_driver,
            chart_data=chart_data,
            use_psi=use_psi,
            use_fahrenheit=use_fahrenheit,
            target_psi=_session_target_psi(session),
            target_bar=round(_session_target_psi(session) / BAR_TO_PSI, 4),
            can_reprocess=can_reprocess,
            needs_reprocess=_needs_reprocess,
            smoothing_level=smoothing_level,
            available_tools=available_tools,
            active_tool=active_tool,
            current_tool=current_tool,
            tool_data=tool_data,
            is_v2=is_v2,
            dashboard_data=dashboard_data,
            full_width=(active_tool in ("dashboard", "section_generator")),
            tire_sets=store.list_tire_sets(session.car_driver_id),
            track_layouts=store.list_track_layouts(),
        )

    # ---- Compare ----

    def _build_session_dash_data(sess: Session, use_psi: bool) -> dict[str, Any] | None:
        """Build a dashboard-compatible data dict for one session."""
        proc = sess.parsed_data
        if not isinstance(proc, dict):
            return None
        is_v2 = proc.get("version") == 2
        if not proc.get("processed") and not is_v2:
            return None
        times = proc.get("times") or []
        raw_series = proc.get("series") or {}
        if not times or not raw_series:
            return None
        ch_meta = proc.get("channel_meta") or {}
        distances = proc.get("distances") or []
        lap_splits = proc.get("lap_splits") or []
        lap_split_distances = proc.get("lap_split_distances") or []

        dash_series: dict[str, Any] = {}
        dash_meta: dict[str, Any] = dict(ch_meta)
        skip_cats = {"timing", "gps", "derived"}
        for cname, vals in raw_series.items():
            cmeta = ch_meta.get(cname, {})
            cat = cmeta.get("category", "unknown")
            if cat in skip_cats:
                continue
            if use_psi and cmeta.get("unit") == "bar" and cat == "pressure":
                dash_series[cname] = [round(v * BAR_TO_PSI, 4) if v is not None else None for v in vals]
                dash_meta[cname] = {**cmeta, "unit": "psi"}
            else:
                dash_series[cname] = vals

        raw_pres_chart = proc.get("raw_pressure_chart") or {}
        raw_pres_out: dict[str, Any] = {}
        for cname, vals in raw_pres_chart.items():
            cmeta = ch_meta.get(cname, {})
            if use_psi and cmeta.get("unit") == "bar":
                raw_pres_out[cname] = [round(v * BAR_TO_PSI, 4) if v is not None else None for v in vals]
            else:
                raw_pres_out[cname] = vals

        car_driver = store.get_car_driver(sess.car_driver_id)
        label = f"{sess.track} — {sess.session_type.value}"
        if car_driver:
            label += f" ({car_driver.display_name()})"

        lap_times_list: list[dict] = []
        for li in range(len(lap_splits) - 1):
            dt = lap_splits[li + 1] - lap_splits[li]
            if dt > 0:
                lap_times_list.append({"index": li + 1, "time": round(dt, 3)})

        sess_target_psi = _session_target_psi(sess)
        target_val = sess_target_psi if use_psi else round(sess_target_psi / BAR_TO_PSI, 4)
        target_unit = "psi" if use_psi else "bar"

        return {
            "id": sess.id,
            "label": label,
            "times": times,
            "distances": distances,
            "series": dash_series,
            "channel_meta": dash_meta,
            "lap_splits": lap_splits,
            "lap_split_distances": lap_split_distances,
            "lap_times": lap_times_list,
            "has_distance": bool(distances),
            "target_psi": target_val,
            "target_unit": target_unit,
            "raw_pressure_series": raw_pres_out,
        }

    @app.route("/compare")
    def compare_list():
        """List saved comparisons and allow creating new ones."""
        ids_param = request.args.get("ids", "").strip()
        if ids_param:
            session_ids = [x.strip() for x in ids_param.split(",") if x.strip()]
            name = request.args.get("name", "").strip() or "New Comparison"
            sc = store.add_saved_comparison(name, session_ids)
            return redirect(url_for("compare_dashboard", id=sc.id))
        saved_comparisons = store.list_saved_comparisons()
        all_sessions = store.list_sessions()
        return render_template("compare.html", saved_comparisons=saved_comparisons, all_sessions=all_sessions)

    @app.route("/compare/<id>")
    def compare_dashboard(id: str):
        """Dashboard view for a saved comparison."""
        sc = store.get_saved_comparison(id)
        if not sc:
            return redirect(url_for("compare_list"))
        use_psi = request.args.get("unit", "psi").lower() == "psi"
        sessions_blob: list[dict] = []
        all_channels_by_cat: dict[str, list[dict]] = {}
        seen_channels: set[str] = set()

        for sid in sc.session_ids:
            sess = store.get_session(sid)
            if not sess:
                continue
            sd = _build_session_dash_data(sess, use_psi)
            if not sd:
                continue
            sessions_blob.append(sd)
            ch_meta = sd["channel_meta"]
            for cname in sd["series"]:
                if cname in seen_channels:
                    continue
                seen_channels.add(cname)
                cmeta = ch_meta.get(cname, {})
                cat = cmeta.get("category", "other")
                all_channels_by_cat.setdefault(cat, []).append({
                    "name": cname,
                    "display": cmeta.get("display", cname),
                    "unit": cmeta.get("unit", ""),
                    "color": cmeta.get("color", "#888"),
                    "category": cat,
                })

        dashboard_data = sanitize_for_json({
            "comparison_id": sc.id,
            "comparison_name": sc.name,
            "sessions": sessions_blob,
            "channels_by_category": all_channels_by_cat,
            "all_session_ids": list(sc.session_ids),
        })
        all_sessions = store.list_sessions()
        return render_template(
            "compare_dashboard.html",
            comparison=sc,
            dashboard_data=dashboard_data,
            use_psi=use_psi,
            all_sessions=all_sessions,
            full_width=True,
        )

    # ---- Compare API ----

    @app.route("/api/comparisons", methods=["POST"])
    def api_create_comparison():
        data = request.get_json(force=True) if request.is_json else {}
        name = (data.get("name") or request.form.get("name") or "").strip() or "New Comparison"
        ids_raw = data.get("session_ids") or []
        if isinstance(ids_raw, str):
            ids_raw = [x.strip() for x in ids_raw.split(",") if x.strip()]
        sc = store.add_saved_comparison(name, ids_raw)
        return jsonify({"ok": True, "id": sc.id, "url": url_for("compare_dashboard", id=sc.id)})

    @app.route("/api/comparisons/<id>", methods=["PATCH"])
    def api_update_comparison(id: str):
        data = request.get_json(force=True)
        name = data.get("name")
        session_ids = data.get("session_ids")
        sc = store.update_saved_comparison(id, name=name, session_ids=session_ids)
        if not sc:
            return jsonify({"error": "Not found"}), 404
        return jsonify({"ok": True, "comparison": sc.to_dict()})

    @app.route("/api/comparisons/<id>", methods=["DELETE"])
    def api_delete_comparison(id: str):
        store.delete_saved_comparison(id)
        return jsonify({"ok": True})

    @app.route("/api/comparisons/<id>/sessions", methods=["POST"])
    def api_comparison_add_session(id: str):
        data = request.get_json(force=True)
        session_id = (data.get("session_id") or "").strip()
        if not session_id:
            return jsonify({"error": "session_id required"}), 400
        sc = store.get_saved_comparison(id)
        if not sc:
            return jsonify({"error": "Not found"}), 404
        if session_id not in sc.session_ids:
            sc.session_ids.append(session_id)
            store.update_saved_comparison(id, session_ids=sc.session_ids)
        return jsonify({"ok": True, "session_ids": sc.session_ids})

    @app.route("/api/comparisons/<id>/sessions/<session_id>", methods=["DELETE"])
    def api_comparison_remove_session(id: str, session_id: str):
        sc = store.get_saved_comparison(id)
        if not sc:
            return jsonify({"error": "Not found"}), 404
        sc.session_ids = [s for s in sc.session_ids if s != session_id]
        store.update_saved_comparison(id, session_ids=sc.session_ids)
        return jsonify({"ok": True, "session_ids": sc.session_ids})

    @app.route("/api/sessions/list", methods=["GET"])
    def api_sessions_list():
        """Lightweight session list for the add-session picker."""
        sessions = store.list_sessions()
        out = []
        for s in sessions:
            car_driver = store.get_car_driver(s.car_driver_id)
            label = f"{s.track} — {s.session_type.value}"
            if car_driver:
                label += f" ({car_driver.display_name()})"
            out.append({"id": s.id, "label": label, "track": s.track})
        return jsonify(out)

    return app


# Module-level app for backward compat: flask --app TirePressure.app run
app = create_app()


def main():
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True,
        use_reloader=True,
        reloader_type="stat",
    )


if __name__ == "__main__":
    main()
