"""
LapForge - Flask app (localhost, offline).
Run: python -m LapForge.app  or  flask --app LapForge.app run
"""

from __future__ import annotations

import argparse
import json
import logging
import socket
import sys
import threading
import traceback
import uuid
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from flask import (
    Flask,
    Response,
    jsonify,
    redirect,
    request,
    send_file,
    stream_with_context,
    url_for,
)

from LapForge.parsers.pi_toolbox_export import load_pi_toolbox_export, merge_parsed_outings, read_file_metadata
from LapForge.models import CarDriver, Session, TireSet, TrackSection, Weekend, normalize_session_type
from LapForge.processing import (
    BAR_TO_PSI,
    CHART_MAX_POINTS,
    CHART_SAMPLE_RATE_HZ,
    CHART_SMOOTH_WINDOW_S,
    CHART_Y_MAX_PSI,
    CHART_Y_MIN_PSI,
    DEFAULT_TARGET_PSI,
    PIPELINE_VERSION,
    extract_reference_lap_from_session_blob,
    needs_reprocess as check_needs_reprocess,
    patch_pressure_summaries,
    pressure_lap_band_summary,
    pressure_window_stats,
    process_session,
    process_session_incremental,
    process_session_streaming,
    sanitize_for_json,
    stale_stages,
)
from LapForge.auth.oauth import auth_bp, get_current_user, init_oauth
from LapForge.config import AppConfig
from LapForge.session_store import SessionStore
from LapForge.tools import get_available_tools


def create_app() -> Flask:
    app_config = AppConfig()

    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.secret_key = app_config.flask_secret_key
    app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024

    app.config["GOOGLE_CLIENT_ID"] = app_config.google_client_id
    app.config["GOOGLE_CLIENT_SECRET"] = app_config.google_client_secret

    init_oauth(app)
    app.register_blueprint(auth_bp)

    store = SessionStore(data_root=app_config.data_root) if app_config.data_root else SessionStore()
    app.store = store  # type: ignore[attr-defined]

    _bg_tasks: dict[str, dict[str, Any]] = {}
    _bg_lock = threading.Lock()

    PREFERENCES_PATH = store.data_root / "preferences.json"

    def _resolve_fp(session: Session) -> Path | None:
        """Resolve session's file_path to an absolute Path, or None."""
        return store.resolve_file_path(session.file_path)

    def _load_session_files(session: Session) -> dict | None:
        """Load all source files for a session, parse each, and merge."""
        paths = store.resolve_file_paths(session.file_path)
        if not paths or not all(p.exists() for p in paths):
            return None
        try:
            parsed_list = [load_pi_toolbox_export(str(p)) for p in paths]
        except Exception:
            return None
        if len(parsed_list) > 1:
            parsed_list.sort(
                key=lambda d: int((d.get("metadata") or {}).get("OutingNumber", 0))
            )
            return merge_parsed_outings(parsed_list)
        return parsed_list[0] if parsed_list else None

    def _all_source_files_exist(session: Session) -> bool:
        """Check whether all source files for a session exist on disk."""
        paths = store.resolve_file_paths(session.file_path)
        return bool(paths) and all(p.exists() for p in paths)

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
        "session_type_options": [
            "Practice 1",
            "Practice 2",
            "Practice 3",
            "Qualifying",
            "Race 1",
            "Race 2",
        ],
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
    _PRESSURE_KEYS_LOWER = {
        "tpms_press_fl", "tpms_press_fr", "tpms_press_rl", "tpms_press_rr",
        "tpms_press_fl_psi", "tpms_press_fr_psi", "tpms_press_rl_psi", "tpms_press_rr_psi",
    }

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
        return _load_session_files(session)

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
        from LapForge.processing import _smooth_linear_regression

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

    def _gps_points_from_reference_lap(reference_lap: dict) -> list[dict[str, Any]]:
        gps_points: list[dict[str, Any]] = []
        ref_points = reference_lap.get("points") or []
        if ref_points:
            for pt in ref_points:
                if isinstance(pt, dict) and "lat" in pt and "lng" in pt:
                    gps_points.append({"lat": pt["lat"], "lng": pt["lng"], "distance": pt.get("distance", 0)})
                elif isinstance(pt, (list, tuple)) and len(pt) >= 2:
                    gps_points.append({"lat": pt[0], "lng": pt[1], "distance": pt[2] if len(pt) > 2 else 0})
        else:
            ref_lat = reference_lap.get("lat") or []
            ref_lon = reference_lap.get("lon") or []
            ref_dist = reference_lap.get("distance") or []
            for i in range(min(len(ref_lat), len(ref_lon))):
                lat_v = ref_lat[i]
                lon_v = ref_lon[i]
                if lat_v is not None and lon_v is not None:
                    gps_points.append({
                        "lat": lat_v,
                        "lng": lon_v,
                        "distance": ref_dist[i] if i < len(ref_dist) else 0,
                    })
        return gps_points

    def _gps_points_with_session_distance(
        reference_lap: dict,
        lap_split_distances: list[float],
    ) -> list[dict[str, Any]]:
        """Shift reference-lap point distances to session cumulative (matches chart / cursor)."""
        pts = _gps_points_from_reference_lap(reference_lap)
        if not pts or not lap_split_distances:
            return pts
        lap_idx = reference_lap.get("lap_index")
        if lap_idx is None:
            return pts
        try:
            li = int(lap_idx)
        except (TypeError, ValueError):
            return pts
        if li < 0 or li >= len(lap_split_distances):
            return pts
        try:
            base = float(lap_split_distances[li])
        except (TypeError, ValueError):
            return pts
        out: list[dict[str, Any]] = []
        for p in pts:
            q = dict(p)
            d = q.get("distance")
            try:
                q["distance"] = base + (float(d) if d is not None else 0.0)
            except (TypeError, ValueError):
                q["distance"] = base
            out.append(q)
        return out

    def _reference_lap_has_geometry(ref: dict) -> bool:
        if not isinstance(ref, dict):
            return False
        pts = ref.get("points")
        if isinstance(pts, list) and len(pts) >= 2:
            return True
        lat = ref.get("lat") or []
        lon = ref.get("lon") or []
        return (
            isinstance(lat, list)
            and isinstance(lon, list)
            and len(lat) >= 2
            and len(lon) >= 2
        )

    def _build_dashboard_data(sd: dict, session: Any, st: Any) -> dict | None:
        """Build a complete dashboard blob for the SPA from v2 session data."""
        times = sd.get("times") or []
        distances = sd.get("distances") or []
        series = sd.get("series") or {}
        channel_meta = sd.get("channel_meta") or {}
        summary_blob = sd.get("summary") or {}
        lap_splits = sd.get("lap_splits") or []
        lap_split_distances = sd.get("lap_split_distances") or lap_splits
        has_distance = bool(distances)

        cat_groups: dict[str, list[str]] = {}
        for cname, cmeta in channel_meta.items():
            cat = cmeta.get("category", "other")
            cat_groups.setdefault(cat, []).append(cname)

        # Build per-lap times from split boundaries
        lap_splits_for_times = lap_splits or sd.get("lap_split_times") or []
        lap_times_raw = summary_blob.get("lap_times")
        lap_times = []
        if lap_times_raw:
            for i, lt in enumerate(lap_times_raw):
                t = lt if isinstance(lt, (int, float)) else lt.get("time", lt) if isinstance(lt, dict) else 0
                lap_times.append({"lap": i + 1, "time": t, "segment_index": i})
        elif len(lap_splits_for_times) >= 2:
            for i in range(len(lap_splits_for_times) - 1):
                dt = lap_splits_for_times[i + 1] - lap_splits_for_times[i]
                if dt > 0:
                    lap_times.append({"lap": i + 1, "time": round(dt, 3), "segment_index": i})

        # Excluded segment indices. If never saved, default excludes segment 0 (typical out-lap).
        excluded_raw = sd.get("excluded_laps")
        if isinstance(excluded_raw, list):
            excluded_set = {int(x) for x in excluded_raw if isinstance(x, (int, float))}
        else:
            excluded_set = {0}
        excluded_list = sorted(excluded_set)

        fast_idx_effective: int | None = None
        for i, lt in enumerate(lap_times):
            seg = int(lt["segment_index"]) if isinstance(lt.get("segment_index"), (int, float)) else i
            if seg in excluded_set:
                continue
            t = float(lt["time"])
            if fast_idx_effective is None or t < float(lap_times[fast_idx_effective]["time"]):
                fast_idx_effective = i

        reference_lap = sd.get("reference_lap") if isinstance(sd.get("reference_lap"), dict) else {}
        if not _reference_lap_has_geometry(reference_lap):
            merged_ref = None
            if session.track_layout_id:
                merged_ref = st.get_track_layout_ref(session.track_layout_id)
            if (not merged_ref or not _reference_lap_has_geometry(merged_ref)) and session.track:
                merged_ref = st.get_track_layout(session.track)
            if merged_ref and _reference_lap_has_geometry(merged_ref):
                reference_lap = merged_ref
        lsd = lap_split_distances if isinstance(lap_split_distances, list) else []
        gps_points = _gps_points_with_session_distance(reference_lap, lsd)
        local_gps_points = _gps_points_from_reference_lap(reference_lap)

        map_lap_blob: dict[str, Any] | None = None
        if _reference_lap_has_geometry(reference_lap):
            ref_dists = reference_lap.get("distances_raw") or reference_lap.get("distance") or []
            ref_times = reference_lap.get("times") or []
            ref_series = reference_lap.get("series") or {}
            ref_ch_meta = reference_lap.get("channel_meta") or channel_meta
            lap_length = max(ref_dists) if ref_dists else 0.0

            layout_obj = st.get_track_layout_by_id(session.track_layout_id) if session.track_layout_id else None
            src: dict[str, Any] = {
                "lap_index": reference_lap.get("lap_index"),
                "lap_time": reference_lap.get("lap_time"),
            }
            if layout_obj:
                src["driver"] = layout_obj.source_driver
                src["car"] = layout_obj.source_car
                src["session_name"] = layout_obj.source_session_name
            else:
                src["driver"] = session.driver
                src["car"] = session.car
                src["session_name"] = f"{session.track} — {session.session_type}" if session.track else None

            map_lap_blob = {
                "distances": ref_dists,
                "times": ref_times,
                "series": ref_series,
                "channel_meta": ref_ch_meta,
                "points": local_gps_points,
                "lap_length": lap_length,
                "source": src,
            }

        sections = []
        track_sections = st.list_track_sections(session.track) if session.track else []
        for ts_sec in track_sections:
            sections.append({"name": ts_sec.name, "start_distance": ts_sec.start_distance, "end_distance": ts_sec.end_distance})

        tire_summary = summary_blob.get("pressure_summary_psi")

        target_psi = _session_target_psi(session)

        # Normalize pressure channels to PSI (same as _build_session_dash_data) so that
        # ChartModule always sees a consistent unit regardless of what the stored blob
        # contains.  This also fixes sessions stored before the parser corrected
        # [psi]-labelled channels — the double-PSI values pass through this path intact
        # (meta patched to "psi") so the frontend never applies a second conversion.
        norm_series: dict[str, Any] = {}
        norm_meta: dict[str, Any] = dict(channel_meta)
        skip_cats = {"timing", "gps", "derived"}
        for cname, vals in series.items():
            cmeta = channel_meta.get(cname, {})
            cat = cmeta.get("category", "unknown")
            if cat in skip_cats:
                continue
            if cmeta.get("unit") == "bar" and cat == "pressure":
                norm_series[cname] = [round(v * BAR_TO_PSI, 4) if v is not None else None for v in vals]
                norm_meta[cname] = {**cmeta, "unit": "psi"}
            else:
                norm_series[cname] = vals

        raw_pres_chart = sd.get("raw_pressure_chart") or {}
        raw_pres_out: dict[str, Any] = {}
        for cname, vals in raw_pres_chart.items():
            cmeta = channel_meta.get(cname, {})
            if cmeta.get("unit") == "bar":
                raw_pres_out[cname] = [round(v * BAR_TO_PSI, 4) if v is not None else None for v in vals]
            else:
                raw_pres_out[cname] = vals

        return {
            "times": times,
            "distances": distances,
            "series": norm_series,
            "channel_meta": norm_meta,
            "channels_by_category": cat_groups,
            "lap_splits": lap_splits,
            "lap_split_distances": lap_split_distances,
            "lap_times": lap_times,
            "has_distance": has_distance,
            "fast_lap_index": fast_idx_effective,
            "sections": sections,
            "points": gps_points,
            "tire_summary": tire_summary,
            "target_pressure_psi": target_psi,
            "raw_pressure_series": raw_pres_out,
            "excluded_laps": excluded_list,
            "reference_lap_index": reference_lap.get("lap_index"),
            "raw_times": sd.get("raw_times") or [],
            "raw_distances": sd.get("raw_distances") or [],
            "map_lap_segment_index": sd.get("map_lap_segment_index"),
            "map_lap": map_lap_blob,
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

    # ---- Context processors ----

    @app.context_processor
    def inject_auth():
        user = get_current_user()
        return {
            "current_user": user,
            "oauth_enabled": app.config.get("OAUTH_ENABLED", False),
        }

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

    # ---- SPA page routes (all non-API paths serve the SPA) ----

    def _serve_spa():
        spa_dir = Path(app.static_folder or "") / "spa"
        index = spa_dir / "index.html"
        if index.exists():
            return send_file(index)
        return "SPA not built. Run: cd frontend && npm run build", 404

    @app.route("/")
    def index():
        return _serve_spa()

    @app.route("/settings")
    def settings():
        return _serve_spa()

    @app.route("/api/data-location", methods=["POST"])
    def api_change_data_location():
        """Change the data_root directory, optionally moving existing data."""
        nonlocal store, PREFERENCES_PATH
        import shutil

        data = request.get_json(force=True)
        new_path_str = (data.get("path") or "").strip()
        action = data.get("action", "move")  # "move" or "switch"

        if not new_path_str:
            return jsonify({"error": "Path is required"}), 400

        new_root = Path(new_path_str).resolve()
        old_root = store.data_root.resolve()

        if new_root == old_root:
            return jsonify({"ok": True, "message": "Already using this location", "path": str(new_root)})

        has_existing_data = (new_root / "race_data.db").exists() or (new_root / "uploads").exists()

        if action == "check":
            return jsonify({
                "has_existing_data": has_existing_data,
                "old_path": str(old_root),
                "new_path": str(new_root),
            })

        try:
            new_root.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            return jsonify({"error": f"Cannot create directory: {e}"}), 400

        if action == "move" and not has_existing_data:
            try:
                for item_name in ("race_data.db", "uploads", "preferences.json"):
                    src = old_root / item_name
                    if src.exists():
                        dst = new_root / item_name
                        shutil.move(str(src), str(dst))
            except OSError as e:
                return jsonify({"error": f"Move failed: {e}. Original location unchanged."}), 500

        store = SessionStore(data_root=new_root)
        app.store = store  # type: ignore[attr-defined]
        PREFERENCES_PATH = store.data_root / "preferences.json"

        app_config.data_root = new_root

        return jsonify({"ok": True, "path": str(new_root)})

    # ---- Backup / Restore ----

    @app.route("/api/backup/export", methods=["POST"])
    def api_backup_export():
        """Create a zip bundle of all data and return its path."""
        from LapForge.sync.bundle import build_bundle

        user = get_current_user()
        user_key = user["user_key"] if user else None
        dest = store.data_root / f"backup_{__import__('datetime').datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
        try:
            path = build_bundle(
                data_root=store.data_root,
                device_id=app_config.device_id,
                user_key=user_key,
                dest=dest,
            )
            return jsonify({"ok": True, "path": str(path), "size_bytes": path.stat().st_size})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/backup/restore", methods=["POST"])
    def api_backup_restore():
        """Restore from a zip bundle. Expects JSON { "path": "..." }."""
        nonlocal store, PREFERENCES_PATH
        from LapForge.sync.bundle import read_bundle_manifest, restore_bundle

        data = request.get_json(force=True)
        bundle_path_str = (data.get("path") or "").strip()
        if not bundle_path_str or not Path(bundle_path_str).exists():
            return jsonify({"error": "Bundle file not found"}), 400
        bundle_path = Path(bundle_path_str)

        try:
            manifest = restore_bundle(
                bundle_path=bundle_path,
                data_root=store.data_root,
            )
            store = SessionStore(data_root=store.data_root)
            app.store = store  # type: ignore[attr-defined]
            PREFERENCES_PATH = store.data_root / "preferences.json"
            return jsonify({"ok": True, "manifest": manifest})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ---- Cloud Sync API ----

    @app.route("/api/sync/status", methods=["GET"])
    def api_sync_status():
        """Return current sync status (requires login)."""
        from LapForge.sync.engine import SyncStatus, detect_status, load_sync_state

        client_id = app.config.get("GOOGLE_CLIENT_ID")
        client_secret = app.config.get("GOOGLE_CLIENT_SECRET")
        if not client_id or not client_secret:
            return jsonify({"status": "oauth_not_configured"})

        user = get_current_user()
        if not user:
            return jsonify({"status": "not_logged_in"})

        from LapForge.sync.secrets import build_google_credentials
        creds = build_google_credentials(user["user_key"], client_id, client_secret)
        if not creds:
            return jsonify({"status": "no_credentials", "message": "Sign in again to enable sync"})

        try:
            from LapForge.sync.cloud_google import DriveClient
            client = DriveClient(creds)
            remote_manifest = client.get_remote_manifest()
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)})

        status = detect_status(
            store.data_root, app_config.device_id,
            user["user_key"], remote_manifest,
        )
        state = load_sync_state(store.data_root)
        return jsonify({
            "status": status.value,
            "last_synced_at": state.get("last_synced_at"),
            "remote_timestamp": remote_manifest.get("created_at") if remote_manifest else None,
        })

    @app.route("/api/sync/files", methods=["GET"])
    def api_sync_files():
        """Return per-file sync inventory (local comparison, no Drive calls)."""
        from LapForge.sync.engine import build_file_list

        user = get_current_user()
        if not user:
            return jsonify({"error": "Not signed in"}), 401
        return jsonify(build_file_list(
            store.data_root, app_config.device_id, user["user_key"],
        ))

    @app.route("/api/sync/push", methods=["POST"])
    def api_sync_push():
        """Push local data to cloud, streaming SSE progress events."""
        nonlocal store, PREFERENCES_PATH
        from LapForge.sync.engine import do_push

        user = get_current_user()
        if not user:
            return jsonify({"error": "Not signed in"}), 401

        client_id = app.config.get("GOOGLE_CLIENT_ID")
        client_secret = app.config.get("GOOGLE_CLIENT_SECRET")
        from LapForge.sync.secrets import build_google_credentials
        creds = build_google_credentials(user["user_key"], client_id, client_secret)
        if not creds:
            return jsonify({"error": "No credentials. Sign in again."}), 401

        def generate():
            try:
                for evt in do_push(
                    store.data_root, app_config.device_id,
                    user["user_key"], creds,
                ):
                    yield f"data: {json.dumps(evt)}\n\n"
            except Exception as e:
                log.exception("Sync push failed")
                msg = str(e)
                if "HttpError 403" in msg or "insufficientPermissions" in msg:
                    msg = "Google Drive permission denied. Try signing out and back in."
                elif "HttpError 401" in msg or "invalid_grant" in msg:
                    msg = "Google credentials expired. Sign out and back in."
                yield f"data: {json.dumps({'event': 'error', 'message': msg})}\n\n"

        return Response(
            stream_with_context(generate()),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.route("/api/sync/pull", methods=["POST"])
    def api_sync_pull():
        """Pull latest data from cloud, streaming SSE progress events."""
        nonlocal store, PREFERENCES_PATH
        from LapForge.sync.engine import do_pull

        user = get_current_user()
        if not user:
            return jsonify({"error": "Not signed in"}), 401

        client_id = app.config.get("GOOGLE_CLIENT_ID")
        client_secret = app.config.get("GOOGLE_CLIENT_SECRET")
        from LapForge.sync.secrets import build_google_credentials
        creds = build_google_credentials(user["user_key"], client_id, client_secret)
        if not creds:
            return jsonify({"error": "No credentials. Sign in again."}), 401

        def generate():
            nonlocal store, PREFERENCES_PATH
            try:
                last_evt = None
                for evt in do_pull(store.data_root, creds):
                    last_evt = evt
                    yield f"data: {json.dumps(evt)}\n\n"
                if last_evt and last_evt.get("event") == "complete":
                    store = SessionStore(data_root=store.data_root)
                    app.store = store  # type: ignore[attr-defined]
                    PREFERENCES_PATH = store.data_root / "preferences.json"
            except Exception as e:
                log.exception("Sync pull failed")
                msg = str(e)
                if "HttpError 403" in msg or "insufficientPermissions" in msg:
                    msg = "Google Drive permission denied. Try signing out and back in."
                elif "HttpError 401" in msg or "invalid_grant" in msg:
                    msg = "Google credentials expired. Sign out and back in."
                elif "HttpError 404" in msg:
                    msg = "Remote backup not found on Google Drive."
                yield f"data: {json.dumps({'event': 'error', 'message': msg})}\n\n"

        return Response(
            stream_with_context(generate()),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.route("/car-drivers")
    @app.route("/car_drivers")
    def car_drivers_list():
        return _serve_spa()

    @app.route("/tire-sets")
    @app.route("/tire_sets")
    def tire_sets_list():
        return _serve_spa()

    @app.route("/sessions")
    def sessions_list():
        return _serve_spa()

    @app.route("/plan")
    def plan_list():
        return _serve_spa()

    @app.route("/plan/<weekend_id>")
    def plan_redirect(weekend_id: str):
        return _serve_spa()

    @app.route("/plan/<weekend_id>/<car_driver_id>")
    def plan_page(weekend_id: str, car_driver_id: str):
        return _serve_spa()

    @app.route("/setups")
    def setups_list():
        return _serve_spa()

    @app.route("/setups/new")
    def setups_new():
        return _serve_spa()

    @app.route("/setups/<setup_id>")
    def setup_detail_page(setup_id: str):
        return _serve_spa()

    # ---- Upload ----

    def _upload_form_metadata(outing_meta: dict[str, str]) -> dict[str, str]:
        """Map Pi {OutingInformation} keys to save-form field names."""
        m = outing_meta or {}
        return {
            "session_type": m.get("SessionType") or m.get("Session") or "",
            "track": m.get("TrackName") or m.get("Track") or "",
            "driver": m.get("DriverName") or m.get("Driver") or "",
            "car": m.get("CarName") or m.get("Car") or "",
            "outing_number": m.get("OutingNumber") or "",
            "session_number": m.get("SessionNumber") or "",
        }

    @app.route("/upload", methods=["GET", "POST"])
    def upload():
        if request.method == "GET":
            return _serve_spa()

        car_drivers = store.list_car_drivers()
        active_id = request.form.get("car_driver_id") or request.args.get("car_driver_id") or (car_drivers[0].id if car_drivers else None)

        if request.form.get("save") == "1":
            session_type_val = request.form.get("session_type")
            car_driver_id = request.form.get("car_driver_id") or active_id
            if not car_driver_id:
                return jsonify({"error": "Select or create a car/driver."}), 400
            session_type = normalize_session_type(session_type_val)
            session_id = str(uuid.uuid4())
            import shutil

            upload_paths = request.form.getlist("upload_path")
            if not upload_paths:
                single = request.form.get("upload_path")
                upload_paths = [single] if single else []
            upload_paths = [p for p in upload_paths if p and Path(p).exists()]
            if not upload_paths:
                return jsonify({"error": "Upload file(s) missing. Please upload and parse again."}), 400

            default_target = float(_get_preferences().get("default_target_pressure_psi", DEFAULT_TARGET_PSI))

            form_vals = {
                "track": request.form.get("track", ""),
                "driver": request.form.get("driver", ""),
                "car": request.form.get("car", ""),
                "outing_number": request.form.get("outing_number", ""),
                "session_number": request.form.get("session_number", ""),
            }

            task_id = session_id
            with _bg_lock:
                _bg_tasks[task_id] = {
                    "pct": 0, "stage": "Starting…", "error": None,
                    "done": False, "redirect": None, "label": form_vals["track"] or "Upload",
                }

            def _run_bg():
                try:
                    n_files = len(upload_paths)
                    with _bg_lock:
                        _bg_tasks[task_id]["pct"] = 5
                        _bg_tasks[task_id]["stage"] = f"Parsing {n_files} file(s)"

                    parsed_list = [load_pi_toolbox_export(p) for p in upload_paths]
                    if len(parsed_list) > 1:
                        parsed_list.sort(
                            key=lambda d: int((d.get("metadata") or {}).get("OutingNumber", 0))
                        )
                        parsed_data = merge_parsed_outings(parsed_list)
                    else:
                        parsed_data = parsed_list[0]

                    with _bg_lock:
                        _bg_tasks[task_id]["pct"] = 10
                        _bg_tasks[task_id]["stage"] = "Processing"
                    processed = None
                    for pct, stage_label, data in process_session_streaming(parsed_data, target_psi=default_target):
                        with _bg_lock:
                            _bg_tasks[task_id]["pct"] = pct
                            if stage_label:
                                _bg_tasks[task_id]["stage"] = stage_label
                        if data is not None:
                            processed = data
                    if processed is None:
                        with _bg_lock:
                            _bg_tasks[task_id]["error"] = "Processing failed"
                            _bg_tasks[task_id]["done"] = True
                        return

                    if n_files == 1:
                        persistent_path = store.uploads_dir / f"{session_id}.txt"
                        relative_path = f"uploads/{session_id}.txt"
                        shutil.copy2(upload_paths[0], persistent_path)
                        Path(upload_paths[0]).unlink(missing_ok=True)
                    else:
                        rel_paths: list[str] = []
                        for i, src in enumerate(upload_paths):
                            dest = store.uploads_dir / f"{session_id}_{i}.txt"
                            shutil.copy2(src, dest)
                            Path(src).unlink(missing_ok=True)
                            rel_paths.append(f"uploads/{session_id}_{i}.txt")
                        import json as _json
                        relative_path = _json.dumps(rel_paths)

                    session_obj = Session(
                        id=session_id,
                        car_driver_id=car_driver_id,
                        session_type=session_type,
                        track=form_vals["track"],
                        driver=form_vals["driver"],
                        car=form_vals["car"],
                        outing_number=form_vals["outing_number"],
                        session_number=form_vals["session_number"],
                        target_pressure_psi=default_target,
                        file_path=relative_path,
                        parsed_data=sanitize_for_json(processed),
                    )
                    store.add_session(session_obj)
                    with _bg_lock:
                        _bg_tasks[task_id]["pct"] = 100
                        _bg_tasks[task_id]["stage"] = "Complete"
                        _bg_tasks[task_id]["done"] = True
                        _bg_tasks[task_id]["redirect"] = f"/sessions/{session_id}"
                except Exception as exc:
                    with _bg_lock:
                        _bg_tasks[task_id]["error"] = str(exc)
                        _bg_tasks[task_id]["done"] = True

            t = threading.Thread(target=_run_bg, daemon=True)
            t.start()
            return jsonify({"task_id": task_id})

        # --- Parse phase: accept one or more files ---
        files = request.files.getlist("file")
        if not files or not any(f.filename for f in files):
            f = request.files.get("file")
            files = [f] if f and f.filename else []
        if not files:
            return jsonify({"error": "Select a file."}), 400
        for f in files:
            if not f.filename or not f.filename.lower().endswith(".txt"):
                return jsonify({"error": f"File must be .txt: {f.filename}"}), 400

        import tempfile
        temp_paths: list[str] = []
        parsed_list: list[dict] = []
        try:
            for f in files:
                path = Path(tempfile.gettempdir()) / f"tire_upload_{uuid.uuid4().hex}.txt"
                f.save(str(path))
                parsed_list.append(load_pi_toolbox_export(path))
                temp_paths.append(str(path))
        except Exception as e:
            return jsonify({"error": str(e)}), 400

        if len(parsed_list) > 1:
            parsed_list_sorted = sorted(
                parsed_list,
                key=lambda d: int((d.get("metadata") or {}).get("OutingNumber", 0)),
            )
            merged = merge_parsed_outings(parsed_list_sorted)
        else:
            merged = parsed_list[0]

        meta = merged.get("metadata") or {}
        rows = merged.get("rows") or []
        lap_splits = merged.get("lap_split_times") or []
        return jsonify({
            "parsed": True,
            "metadata": meta,
            "upload_path": temp_paths[0] if temp_paths else "",
            "upload_paths": temp_paths,
            "file_count": len(temp_paths),
            "form_metadata": _upload_form_metadata(meta if isinstance(meta, dict) else {}),
            "row_count": len(rows),
            "lap_split_count": len(lap_splits),
        })

    # ---- Background task status API ----

    @app.route("/api/upload-status/<task_id>")
    def api_upload_status(task_id: str):
        with _bg_lock:
            task = _bg_tasks.get(task_id)
        if not task:
            return jsonify({"error": "Unknown task"}), 404
        return jsonify(task)

    @app.route("/api/upload-tasks")
    def api_upload_tasks():
        with _bg_lock:
            active = {
                tid: t for tid, t in _bg_tasks.items() if not t["done"]
            }
        return jsonify(active)

    @app.route("/api/upload-dismiss/<task_id>", methods=["POST"])
    def api_upload_dismiss(task_id: str):
        with _bg_lock:
            _bg_tasks.pop(task_id, None)
        return jsonify({"ok": True})

    # ---- Session detail and analysis ----

    @app.route("/sessions/<id>/delete", methods=["POST"])
    def session_delete(id: str):
        session = store.get_session(id)
        car_driver_id = session.car_driver_id if session else None
        if session:
            for resolved in store.resolve_file_paths(session.file_path):
                try:
                    canon = resolved.resolve()
                    uploads_canon = store.uploads_dir.resolve()
                    if canon.is_file() and canon.is_relative_to(uploads_canon):
                        canon.unlink()
                except OSError:
                    log.warning("Failed to delete upload file %s for session %s", resolved, id, exc_info=True)
        store.delete_session(id)
        return redirect(url_for("sessions_list", car_driver_id=car_driver_id))

    @app.route("/sessions/<id>/edit", methods=["POST"])
    def session_edit(id: str):
        session = store.get_session(id)
        if not session:
            return redirect(url_for("sessions_list"))

        if request.form.get("car_driver_id"):
            session.car_driver_id = request.form["car_driver_id"]
        if request.form.get("session_type"):
            session.session_type = normalize_session_type(request.form["session_type"])
        if "track" in request.form:
            session.track = request.form["track"]
        if "driver" in request.form:
            session.driver = request.form["driver"]
        if "car" in request.form:
            session.car = request.form["car"]
        if "outing_number" in request.form:
            session.outing_number = request.form["outing_number"]
        if "session_number" in request.form:
            session.session_number = request.form["session_number"]

        session.ambient_temp_c = _temp_c_from_form(
            request.form.get("temp_unit"), request.form.get("ambient_temp_c"),
        )
        session.track_temp_c = _temp_c_from_form(
            request.form.get("temp_unit"), request.form.get("track_temp_c"),
        )
        session.weather_condition = request.form.get("weather_condition") or None
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
        if not session or not _all_source_files_exist(session):
            return redirect(url_for("session_detail", id=id))
        try:
            parsed = _load_session_files(session)
            if parsed is None:
                return redirect(url_for("session_detail", id=id))
            proc = session.parsed_data or {}
            level = int(proc.get("smoothing_level", 0)) + 1
            existing_blob = proc if isinstance(proc, dict) else None
            processed = process_session(
                parsed,
                smoothing_level=level,
                target_psi=_session_target_psi(session),
                existing_blob=existing_blob,
            )
            session.parsed_data = processed
            store.update_session(session)
        except Exception:
            pass
        return redirect(url_for("session_detail", id=id))

    @app.route("/sessions/<id>/restore", methods=["POST"])
    def session_restore(id: str):
        session = store.get_session(id)
        if not session or not _all_source_files_exist(session):
            return redirect(url_for("session_detail", id=id))

        stream_mode = request.form.get("stream") == "1" or request.args.get("stream") == "1"

        if stream_mode:
            def restore_stream():
                try:
                    existing = session.parsed_data if isinstance(session.parsed_data, dict) else None
                    _stale = stale_stages(existing) if existing else []
                    can_incremental = existing and "core" not in _stale and len(_stale) > 0
                    yield "PROGRESS:0\n"
                    parsed = _load_session_files(session)
                    if parsed is None:
                        yield "ERROR:Source files not found\n"
                        return
                    yield "PROGRESS:5\n"

                    processed = None
                    if can_incremental:
                        gen = process_session_incremental(
                            parsed, existing,
                            target_psi=_session_target_psi(session),
                        )
                    else:
                        gen = process_session_streaming(
                            parsed,
                            target_psi=_session_target_psi(session),
                            existing_blob=existing,
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
            parsed = _load_session_files(session)
            if parsed is None:
                return redirect(url_for("session_detail", id=id))
            existing_blob = session.parsed_data if isinstance(session.parsed_data, dict) else None
            processed = process_session(
                parsed,
                smoothing_level=0,
                target_psi=_session_target_psi(session),
                existing_blob=existing_blob,
            )
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
            sec_meta: dict[str, str | None] = {}
            if source_session_id:
                sec_sess = store.get_session(source_session_id)
                if sec_sess:
                    sec_meta = _session_layout_meta(sec_sess)
            store.upsert_track_layout(track_name, ref_lap,
                                      source_session_id=source_session_id,
                                      source_lap_index=source_lap_index,
                                      **sec_meta)

        return jsonify({"ok": True, "sections": saved})

    @app.route("/api/sections/<track_name>/auto-detect", methods=["GET"])
    def api_auto_detect_sections(track_name: str):
        from LapForge.tools.section_generator import prepare_data
        session_id = request.args.get("session_id")
        if not session_id:
            return jsonify({"error": "session_id required"}), 400
        sess = store.get_session(session_id)
        if not sess or not isinstance(sess.parsed_data, dict):
            return jsonify({"error": "Session not found or not processed"}), 404
        result = prepare_data(sess.parsed_data)
        if not result.get("has_data"):
            return jsonify({"error": "No GPS data available for section detection"}), 400
        sections = result.get("sections", [])
        # Persist the auto-detected sections
        store.delete_track_sections(track_name)
        saved = []
        for i, raw in enumerate(sections):
            cg = raw.get("cornerGroup") or raw.get("corner_group")
            sec = TrackSection(
                id=raw.get("id") or str(uuid.uuid4()),
                track_name=track_name,
                name=raw.get("name", f"Section {i + 1}"),
                start_distance=float(raw.get("start_distance", 0)),
                end_distance=float(raw.get("end_distance", 0)),
                section_type=raw.get("section_type", "auto"),
                sort_order=i,
                corner_group=int(cg) if cg is not None else None,
            )
            store.add_track_section(sec)
            saved.append(sec.to_dict())
        return jsonify(saved)

    @app.route("/api/sections/<track_name>/<section_id>", methods=["DELETE"])
    def api_delete_section(track_name: str, section_id: str):
        store.delete_track_section(section_id)
        return jsonify({"ok": True})

    # ---------- Track Layouts ----------

    @app.route("/track-layouts")
    def track_layouts_list():
        return _serve_spa()

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
        meta = _session_layout_meta(sess)
        layout = store.add_track_layout(
            name=name, track_name=track_name, reference_lap=ref_lap,
            source_session_id=source_session_id,
            source_lap_index=source_lap_index if source_lap_index is not None else ref_lap.get("lap_index"),
            **meta,
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
        return _serve_spa()

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
        label = f"{sess.track} — {sess.session_type}"
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
        return _serve_spa()

    @app.route("/compare/<id>")
    def compare_dashboard(id: str):
        return _serve_spa()

    # ---- Compare API ----

    @app.route("/api/comparisons", methods=["GET"])
    def api_list_comparisons():
        return jsonify([sc.to_dict() for sc in store.list_saved_comparisons()])

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
            label = f"{s.track} — {s.session_type}"
            if car_driver:
                label += f" ({car_driver.display_name()})"
            out.append({"id": s.id, "label": label, "track": s.track})
        return jsonify(out)

    @app.route("/api/comparisons/<cid>/dashboard-data")
    def api_comparison_dashboard_data(cid: str):
        sc = store.get_saved_comparison(cid)
        if not sc:
            return jsonify({"error": "Not found"}), 404
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
        return jsonify(sanitize_for_json({
            "comparison_id": sc.id,
            "comparison_name": sc.name,
            "sessions": sessions_blob,
            "channels_by_category": all_channels_by_cat,
            "all_session_ids": list(sc.session_ids),
        }))

    # ---- Dashboard Templates API ----

    @app.route("/api/dashboard-templates", methods=["GET"])
    def api_list_dashboard_templates():
        return jsonify(store.list_dashboard_templates())

    @app.route("/api/dashboard-templates", methods=["POST"])
    def api_create_dashboard_template():
        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()
        layout = data.get("layout")
        if not name:
            return jsonify({"error": "Name is required"}), 400
        if not isinstance(layout, list):
            return jsonify({"error": "Layout must be an array"}), 400
        tpl = store.add_dashboard_template(name, layout)
        return jsonify(tpl)

    @app.route("/api/dashboard-templates/<tid>", methods=["PATCH"])
    def api_update_dashboard_template(tid: str):
        data = request.get_json(silent=True) or {}
        name = data.get("name")
        layout = data.get("layout")
        store.update_dashboard_template(tid, name=name, layout=layout)
        return jsonify({"ok": True})

    @app.route("/api/dashboard-templates/<tid>", methods=["DELETE"])
    def api_delete_dashboard_template(tid: str):
        store.delete_dashboard_template(tid)
        return jsonify({"ok": True})

    # ---- Per-session / per-comparison dashboard layout API ----

    @app.route("/api/sessions/<sid>/dashboard-layout", methods=["GET"])
    def api_get_session_dashboard_layout(sid: str):
        layout = store.get_dashboard_layout(sid)
        return jsonify({"layout": layout})

    @app.route("/api/sessions/<sid>/dashboard-layout", methods=["PUT"])
    def api_save_session_dashboard_layout(sid: str):
        data = request.get_json(silent=True) or {}
        layout = data.get("layout")
        if not isinstance(layout, list):
            return jsonify({"error": "layout must be an array"}), 400
        store.save_dashboard_layout(sid, layout)
        return jsonify({"ok": True})

    @app.route("/api/comparisons/<cid>/dashboard-layout", methods=["GET"])
    def api_get_compare_dashboard_layout(cid: str):
        layout = store.get_compare_dashboard_layout(cid)
        return jsonify({"layout": layout})

    @app.route("/api/comparisons/<cid>/dashboard-layout", methods=["PUT"])
    def api_save_compare_dashboard_layout(cid: str):
        data = request.get_json(silent=True) or {}
        layout = data.get("layout")
        if not isinstance(layout, list):
            return jsonify({"error": "layout must be an array"}), 400
        store.save_compare_dashboard_layout(cid, layout)
        return jsonify({"ok": True})

    # ---- SPA CRUD APIs ----

    @app.route("/api/car-drivers")
    def api_car_drivers_list():
        return jsonify([cd.to_dict() for cd in store.list_car_drivers()])

    @app.route("/api/car-drivers", methods=["POST"])
    def api_car_drivers_create():
        data = request.get_json(silent=True) or {}
        car_identifier = (data.get("car_identifier") or "").strip()
        driver_name = (data.get("driver_name") or "").strip()
        if not car_identifier or not driver_name:
            return jsonify({"error": "car_identifier and driver_name required"}), 400
        cd = store.add_car_driver(car_identifier, driver_name)
        return jsonify({"ok": True, "car_driver": cd.to_dict()})

    @app.route("/api/car-drivers/<cd_id>", methods=["PATCH"])
    def api_car_drivers_update(cd_id: str):
        cd = store.get_car_driver(cd_id)
        if not cd:
            return jsonify({"error": "Not found"}), 404
        data = request.get_json(silent=True) or {}
        if "car_identifier" in data:
            cd.car_identifier = data["car_identifier"].strip()
        if "driver_name" in data:
            cd.driver_name = data["driver_name"].strip()
        store.update_car_driver(cd)
        return jsonify({"ok": True})

    @app.route("/api/car-drivers/<cd_id>", methods=["DELETE"])
    def api_car_drivers_delete(cd_id: str):
        store.delete_car_driver(cd_id)
        return jsonify({"ok": True})

    # ---------- Weekends ----------

    @app.route("/api/weekends")
    def api_weekends_list():
        weekends = store.list_weekends()
        result = []
        for w in weekends:
            plans = store.list_plans(weekend_id=w.id)
            result.append({**w.to_dict(), "plan_count": len(plans)})
        return jsonify(result)

    @app.route("/api/weekends", methods=["POST"])
    def api_weekends_create():
        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify({"error": "name required"}), 400
        w = store.add_weekend(
            name=name,
            track=(data.get("track") or "").strip(),
            date_start=(data.get("date_start") or "").strip(),
            date_end=(data.get("date_end") or "").strip(),
        )
        return jsonify({"ok": True, "id": w.id, "weekend": w.to_dict()})

    @app.route("/api/weekends/<wid>")
    def api_weekends_get(wid: str):
        w = store.get_weekend(wid)
        if not w:
            return jsonify({"error": "Not found"}), 404
        return jsonify(w.to_dict())

    @app.route("/api/weekends/<wid>", methods=["PATCH"])
    def api_weekends_update(wid: str):
        w = store.get_weekend(wid)
        if not w:
            return jsonify({"error": "Not found"}), 404
        data = request.get_json(silent=True) or {}
        updated = store.update_weekend(wid, **{k: v for k, v in data.items()
                                               if k in ("name", "track", "date_start", "date_end")})
        return jsonify({"ok": True, "weekend": updated.to_dict() if updated else w.to_dict()})

    @app.route("/api/weekends/<wid>", methods=["DELETE"])
    def api_weekends_delete(wid: str):
        w = store.get_weekend(wid)
        if not w:
            return jsonify({"error": "Not found"}), 404
        affected = store.delete_weekend(wid)
        return jsonify({"ok": True, "affected_plans": affected})

    @app.route("/api/weekends/<wid>/plans")
    def api_weekend_plans_list(wid: str):
        plans = store.list_plans(weekend_id=wid)
        car_drivers = {cd.id: cd for cd in store.list_car_drivers()}
        result = []
        for p in plans:
            d = p.to_dict()
            cd = car_drivers.get(p.car_driver_id)
            d["car_driver_display"] = cd.display_name() if cd else p.car_driver_id
            result.append(d)
        return jsonify(result)

    # ---------- Plans ----------

    @app.route("/api/plans", methods=["POST"])
    def api_plans_create():
        data = request.get_json(silent=True) or {}
        car_driver_id = (data.get("car_driver_id") or "").strip()
        weekend_id = (data.get("weekend_id") or "").strip()
        if not car_driver_id or not weekend_id:
            return jsonify({"error": "car_driver_id and weekend_id required"}), 400
        existing = store.get_plan_for_car_weekend(car_driver_id, weekend_id)
        if existing:
            return jsonify({"error": "Plan already exists for this car/weekend", "id": existing.id}), 409
        p = store.add_plan(car_driver_id=car_driver_id, weekend_id=weekend_id)
        return jsonify({"ok": True, "id": p.id, "plan": p.to_dict()})

    @app.route("/api/plans/<plan_id>")
    def api_plans_get(plan_id: str):
        p = store.get_plan(plan_id)
        if not p:
            return jsonify({"error": "Not found"}), 404
        return jsonify(p.to_dict())

    @app.route("/api/plans/<plan_id>", methods=["PATCH"])
    def api_plans_update(plan_id: str):
        p = store.get_plan(plan_id)
        if not p:
            return jsonify({"error": "Not found"}), 404
        data = request.get_json(silent=True) or {}
        allowed = {
            "checklist", "planning_mode", "qual_plan", "race_plan",
            "qual_lap_range", "race_stint_lap_range", "pressure_band_psi",
            "session_ids", "current_ambient_temp_c", "current_track_temp_c",
            "current_weather_condition", "notes",
        }
        kwargs = {k: v for k, v in data.items() if k in allowed}
        updated = store.update_plan(plan_id, **kwargs)
        return jsonify({"ok": True, "plan": updated.to_dict() if updated else p.to_dict()})

    @app.route("/api/plans/<plan_id>/cleanup-sessions", methods=["POST"])
    def api_plans_cleanup_sessions(plan_id: str):
        """Repair plan session references: drop deleted sessions, optionally align plan.session_ids with checklist."""
        plan = store.get_plan(plan_id)
        if not plan:
            return jsonify({"error": "Not found"}), 404
        data = request.get_json(silent=True) or {}
        prune_deleted = bool(data.get("prune_deleted", True))
        align_to_checklist = bool(data.get("align_to_checklist", False))

        new_checklist: list[dict[str, Any]] = []
        for step in plan.checklist:
            sid_list = list(step.get("session_ids") or [])
            if prune_deleted:
                sid_list = [sid for sid in sid_list if store.get_session(sid)]
            setup_ids = list(step.get("setup_ids") or [])
            step_copy = dict(step)
            step_copy["session_ids"] = sid_list
            step_copy["setup_ids"] = setup_ids
            old_status = str(step.get("status") or "not_started")
            has_content = bool(sid_list or setup_ids)
            if not has_content:
                step_copy["status"] = "not_started"
            elif old_status == "not_started":
                step_copy["status"] = "linked"
            new_checklist.append(step_copy)

        if align_to_checklist:
            seen: set[str] = set()
            new_session_ids: list[str] = []
            for step in new_checklist:
                for sid in step.get("session_ids") or []:
                    if sid not in seen:
                        seen.add(sid)
                        new_session_ids.append(sid)
        else:
            new_session_ids = list(plan.session_ids or [])
            if prune_deleted:
                new_session_ids = [sid for sid in new_session_ids if store.get_session(sid)]

        updated = store.update_plan(
            plan_id,
            checklist=new_checklist,
            session_ids=new_session_ids,
        )
        return jsonify({"ok": True, "plan": updated.to_dict() if updated else None})

    @app.route("/api/plans/<plan_id>", methods=["DELETE"])
    def api_plans_delete(plan_id: str):
        p = store.get_plan(plan_id)
        if not p:
            return jsonify({"error": "Not found"}), 404
        store.delete_plan(plan_id)
        return jsonify({"ok": True})

    @app.route("/api/plans/<plan_id>/board-data")
    def api_plans_board_data(plan_id: str):
        """Lightweight plan board data: plan settings + per-session metadata/summary (no telemetry)."""
        plan = store.get_plan(plan_id)
        if not plan:
            return jsonify({"error": "Not found"}), 404
        weekend = store.get_weekend(plan.weekend_id)
        car_driver = store.get_car_driver(plan.car_driver_id)
        sessions_out: list[dict[str, Any]] = []
        for sid in plan.session_ids:
            sess = store.get_session(sid)
            if not sess:
                continue
            summary_blob = (sess.parsed_data or {}).get("summary") if sess.parsed_data else None
            tire_summary = None
            if summary_blob and isinstance(summary_blob, dict):
                tire_summary = summary_blob.get("pressure_summary_psi")
            tire_set = store.get_tire_set(sess.tire_set_id) if sess.tire_set_id else None
            sess_cd = store.get_car_driver(sess.car_driver_id)
            label = f"{sess.track} — {sess.session_type}"
            if sess_cd:
                label += f" ({sess_cd.display_name()})"
            ro_fl = round(sess.roll_out_pressure_fl * BAR_TO_PSI, 2) if sess.roll_out_pressure_fl else None
            ro_fr = round(sess.roll_out_pressure_fr * BAR_TO_PSI, 2) if sess.roll_out_pressure_fr else None
            ro_rl = round(sess.roll_out_pressure_rl * BAR_TO_PSI, 2) if sess.roll_out_pressure_rl else None
            ro_rr = round(sess.roll_out_pressure_rr * BAR_TO_PSI, 2) if sess.roll_out_pressure_rr else None
            qual_lap_band = None
            race_lap_band = None
            pd = sess.parsed_data
            if pd and isinstance(pd, dict):
                full_times = pd.get("times") or []
                full_series = pd.get("series") or {}
                lap_splits = pd.get("lap_splits") or []
                pcols = [k for k in full_series if k.lower() in _PRESSURE_KEYS_LOWER]
                eff_target = _session_target_psi(sess)
                ql = plan.qual_lap_range or [2, 3]
                rl = plan.race_stint_lap_range or [3, None]

                qp = plan.qual_plan if isinstance(plan.qual_plan, dict) else {}
                rp = plan.race_plan if isinstance(plan.race_plan, dict) else {}
                q_acceptable = qp.get("acceptable_band_psi") or plan.pressure_band_psi or 0.5
                q_optimal = qp.get("optimal_band_psi") or 0.25
                r_acceptable = rp.get("acceptable_band_psi") or plan.pressure_band_psi or 0.5
                r_optimal = rp.get("optimal_band_psi") or 0.25

                if pcols and full_times:
                    qual_lap_band = pressure_lap_band_summary(
                        full_times, full_series, pcols, lap_splits,
                        target_psi=eff_target,
                        acceptable_psi=q_acceptable, optimal_psi=q_optimal,
                        lap_start=ql[0], lap_end=ql[1],
                        acceptable_upper=qp.get("acceptable_upper_psi"),
                        acceptable_lower=qp.get("acceptable_lower_psi"),
                        optimal_upper=qp.get("optimal_upper_psi"),
                        optimal_lower=qp.get("optimal_lower_psi"),
                    )
                    race_lap_band = pressure_lap_band_summary(
                        full_times, full_series, pcols, lap_splits,
                        target_psi=eff_target,
                        acceptable_psi=r_acceptable, optimal_psi=r_optimal,
                        lap_start=rl[0], lap_end=rl[1],
                        acceptable_upper=rp.get("acceptable_upper_psi"),
                        acceptable_lower=rp.get("acceptable_lower_psi"),
                        optimal_upper=rp.get("optimal_upper_psi"),
                        optimal_lower=rp.get("optimal_lower_psi"),
                    )
            sessions_out.append({
                "id": sess.id,
                "label": label,
                "session_type": sess.session_type,
                "target_pressure_psi": sess.target_pressure_psi,
                "roll_out_psi": {"fl": ro_fl, "fr": ro_fr, "rl": ro_rl, "rr": ro_rr},
                "ambient_temp_c": sess.ambient_temp_c,
                "track_temp_c": sess.track_temp_c,
                "weather_condition": sess.weather_condition,
                "tire_summary": tire_summary,
                "bleed_events": sess.bleed_events,
                "planning_tag": sess.planning_tag,
                "tire_set_name": tire_set.name if tire_set else None,
                "qual_lap_band": qual_lap_band,
                "race_lap_band": race_lap_band,
            })
        return jsonify({
            "plan": plan.to_dict(),
            "weekend": weekend.to_dict() if weekend else None,
            "car_driver": car_driver.to_dict() if car_driver else None,
            "sessions": sessions_out,
        })

    # ---------- Setups ----------

    @app.route("/api/setups/list", methods=["GET"])
    def api_setups_list():
        car_driver_id = request.args.get("car_driver_id") or None
        weekend_id = request.args.get("weekend_id") or None
        setups = store.list_setups(car_driver_id=car_driver_id, weekend_id=weekend_id)
        return jsonify([
            {k: v for k, v in s.to_dict().items() if k != "data"}
            for s in setups
        ])

    @app.route("/api/setups", methods=["POST"])
    def api_setups_create():
        data = request.get_json(silent=True) or {}
        car_driver_id = (data.get("car_driver_id") or "").strip()
        if not car_driver_id:
            return jsonify({"error": "car_driver_id required"}), 400
        s = store.add_setup(
            car_driver_id=car_driver_id,
            name=(data.get("name") or "").strip(),
            data=data.get("data") or {},
            weekend_id=data.get("weekend_id") or None,
            session_id=data.get("session_id") or None,
        )
        return jsonify({"ok": True, "setup": s.to_dict()})

    @app.route("/api/setups/<setup_id>/fork", methods=["POST"])
    def api_setups_fork(setup_id: str):
        data = request.get_json(silent=True) or {}
        fork = store.fork_setup(
            setup_id,
            name=data.get("name"),
            weekend_id=data.get("weekend_id"),
            session_id=data.get("session_id"),
        )
        if not fork:
            return jsonify({"error": "Not found"}), 404
        return jsonify({"ok": True, "setup": fork.to_dict()})

    @app.route("/api/setups/<setup_id>", methods=["GET"])
    def api_setups_get(setup_id: str):
        s = store.get_setup(setup_id)
        if not s:
            return jsonify({"error": "Not found"}), 404
        return jsonify(s.to_dict())

    @app.route("/api/setups/<setup_id>", methods=["PATCH"])
    def api_setups_update(setup_id: str):
        s = store.get_setup(setup_id)
        if not s:
            return jsonify({"error": "Not found"}), 404
        data = request.get_json(silent=True) or {}
        allowed = {"name", "weekend_id", "session_id", "data"}
        kwargs = {k: v for k, v in data.items() if k in allowed}
        updated = store.update_setup(setup_id, **kwargs)
        return jsonify({"ok": True, "setup": updated.to_dict() if updated else s.to_dict()})

    @app.route("/api/setups/<setup_id>", methods=["DELETE"])
    def api_setups_delete(setup_id: str):
        s = store.get_setup(setup_id)
        if not s:
            return jsonify({"error": "Not found"}), 404
        store.delete_setup(setup_id)
        return jsonify({"ok": True})

    @app.route("/api/sessions/<sid>/telemetry")
    def api_session_telemetry(sid: str):
        """Per-session telemetry for lazy-loaded charts."""
        sess = store.get_session(sid)
        if not sess:
            return jsonify({"error": "Not found"}), 404
        data = _build_session_dash_data(sess, use_psi=True)
        if not data:
            return jsonify({"error": "No telemetry data"}), 404
        return jsonify(data)

    @app.route("/api/tire-sets")
    def api_tire_sets_list():
        car_driver_id = request.args.get("car_driver_id")
        all_sets = store.list_tire_sets()
        if car_driver_id:
            all_sets = [ts for ts in all_sets if ts.car_driver_id == car_driver_id or ts.car_driver_id is None]
        return jsonify([ts.to_dict() for ts in all_sets])

    @app.route("/api/tire-sets", methods=["POST"])
    def api_tire_sets_create():
        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify({"error": "name required"}), 400
        ts = store.add_tire_set(
            name=name,
            car_driver_id=data.get("car_driver_id"),
            morning_pressures=(
                data.get("morning_pressure_fl"),
                data.get("morning_pressure_fr"),
                data.get("morning_pressure_rl"),
                data.get("morning_pressure_rr"),
            ),
        )
        return jsonify({"ok": True, "tire_set": ts.to_dict()})

    @app.route("/api/tire-sets/<ts_id>", methods=["PATCH"])
    def api_tire_sets_update(ts_id: str):
        ts = store.get_tire_set(ts_id)
        if not ts:
            return jsonify({"error": "Not found"}), 404
        data = request.get_json(silent=True) or {}
        for field in ("name", "car_driver_id", "morning_pressure_fl", "morning_pressure_fr",
                       "morning_pressure_rl", "morning_pressure_rr"):
            if field in data:
                setattr(ts, field, data[field])
        store.update_tire_set(ts)
        return jsonify({"ok": True})

    @app.route("/api/tire-sets/<ts_id>", methods=["DELETE"])
    def api_tire_sets_delete(ts_id: str):
        store.delete_tire_set(ts_id)
        return jsonify({"ok": True})

    @app.route("/api/sessions/<sid>/detail")
    def api_session_detail(sid: str):
        session = store.get_session(sid)
        if not session:
            return jsonify({"error": "Not found"}), 404

        use_psi = request.args.get("unit", "psi").lower() == "psi"
        car_driver = store.get_car_driver(session.car_driver_id)
        tire_set = store.get_tire_set(session.tire_set_id) if session.tire_set_id else None
        is_v2 = isinstance(session.parsed_data, dict) and session.parsed_data.get("version") == 2

        _needs_reprocess = False
        can_reprocess = _all_source_files_exist(session)
        if is_v2 and can_reprocess:
            _needs_reprocess = check_needs_reprocess(session.parsed_data)

        chart_data = None
        dashboard_data = None
        summary = None
        tool_data = None
        available_tools: list[str] = []
        smoothing = 0

        if is_v2 and session.parsed_data:
            sd = session.parsed_data
            summary_blob = sd.get("summary") or {}
            summary = summary_blob.get("pressure_summary_psi") if use_psi else summary_blob.get("pressure_summary_bar")
            chart_data = _build_chart_data_v2(sd, use_psi, target_psi=_session_target_psi(session))
            smoothing = sd.get("smoothing_level", 0)

            channel_list = summary_blob.get("channel_list") or sd.get("columns") or []
            channel_meta = sd.get("channel_meta") or {}
            tool_list = get_available_tools(channel_list, channel_meta)
            available_tools = [t["tool_name"] for t in tool_list if t.get("available")]

            dashboard_data = _build_dashboard_data(sd, session, store)

        # Build a session_summary with key metadata for the info panel
        session_summary: dict[str, Any] = {}
        if is_v2 and session.parsed_data:
            sb = session.parsed_data.get("summary") or {}
            session_summary = {
                "lap_count": sb.get("lap_count"),
                "fastest_lap_time": sb.get("fastest_lap_time"),
                "fastest_lap_index": sb.get("fastest_lap_index"),
                "has_gps": sb.get("has_gps", False),
                "channel_count": len(sb.get("channel_list") or []),
                "available_categories": sb.get("available_categories") or [],
                "sample_count": len(session.parsed_data.get("times") or []),
                "duration_s": None,
            }
            times = session.parsed_data.get("times") or session.parsed_data.get("full_times") or []
            if times:
                session_summary["duration_s"] = round(times[-1] - times[0], 2) if len(times) > 1 else 0
            outing_meta = session.parsed_data.get("file_metadata") or {}
            if not outing_meta:
                first_fp = store.resolve_file_path(session.file_path)
                if first_fp and first_fp.exists():
                    try:
                        outing_meta = read_file_metadata(str(first_fp))
                    except Exception:
                        outing_meta = {}
            session_summary["file_metadata"] = outing_meta

        return jsonify({
            "session": session.to_dict(),
            "summary": summary,
            "chart_data": chart_data,
            "dashboard_data": dashboard_data,
            "session_summary": session_summary,
            "available_tools": available_tools,
            "tool_data": tool_data,
            "tire_set": tire_set.to_dict() if tire_set else None,
            "car_driver": car_driver.to_dict() if car_driver else None,
            "car_drivers": [cd.to_dict() for cd in store.list_car_drivers()],
            "tire_sets": [ts.to_dict() for ts in store.list_tire_sets()],
            "track_layouts": [tl.to_dict() for tl in store.list_track_layouts()],
            "can_reprocess": can_reprocess,
            "needs_reprocess": _needs_reprocess,
            "smoothing_level": smoothing,
            "is_v2": is_v2,
        })

    def _apply_excluded_laps_to_session(sess: Session, laps: list[Any]) -> list[int]:
        excluded_set: set[int] = set()
        for x in laps:
            try:
                excluded_set.add(int(x))
            except (TypeError, ValueError):
                raise ValueError("invalid_lap_indices") from None
        excluded = sorted(excluded_set)
        pd = dict(sess.parsed_data) if isinstance(sess.parsed_data, dict) else {}
        pd["excluded_laps"] = excluded
        sess.parsed_data = sanitize_for_json(pd)
        return excluded

    def _session_layout_meta(sess: Session) -> dict[str, str | None]:
        """Extract driver/car/session-name from a Session for track-layout metadata."""
        sess_name = f"{sess.track} — {sess.session_type}" if sess.track else sess.session_type
        return {
            "source_driver": sess.driver or None,
            "source_car": sess.car or None,
            "source_session_name": sess_name,
        }

    def _apply_reference_lap_to_session(sess: Session, lap_index: int) -> dict[str, Any]:
        pd_raw = sess.parsed_data if isinstance(sess.parsed_data, dict) else None
        if not pd_raw:
            raise ValueError("no_processed_data")
        ref = extract_reference_lap_from_session_blob(pd_raw, lap_index)
        if not ref:
            raise ValueError("bad_lap_index")
        pd = dict(pd_raw)
        pd["reference_lap"] = ref
        pd["map_lap_segment_index"] = lap_index
        sess.parsed_data = sanitize_for_json(pd)
        meta = _session_layout_meta(sess)
        if sess.track_layout_id:
            store.update_track_layout(
                sess.track_layout_id,
                reference_lap=ref,
                source_lap_index=lap_index,
                source_session_id=sess.id,
                **meta,
            )
        elif sess.track:
            layout = store.upsert_track_layout(
                sess.track,
                ref,
                source_session_id=sess.id,
                source_lap_index=lap_index,
                **meta,
            )
            sess.track_layout_id = layout.id
        lsd = pd.get("lap_split_distances") or pd.get("lap_splits") or []
        lsd_list = lsd if isinstance(lsd, list) else []
        points = _gps_points_with_session_distance(ref, lsd_list)
        return {"reference_lap": ref, "points": points, "reference_lap_index": lap_index}

    @app.route("/api/sessions/<sid>", methods=["PATCH"])
    def api_session_update(sid: str):
        session = store.get_session(sid)
        if not session:
            return jsonify({"error": "Not found"}), 404
        data = request.get_json(silent=True) or {}
        out: dict[str, Any] = {"ok": True}

        if "excluded_laps" in data:
            laps = data["excluded_laps"]
            if not isinstance(laps, list):
                return jsonify({"error": "excluded_laps must be a list"}), 400
            try:
                out["excluded_laps"] = _apply_excluded_laps_to_session(session, laps)
            except ValueError as e:
                if str(e) != "invalid_lap_indices":
                    raise
                return jsonify({"error": "invalid lap indices"}), 400

        if "apply_reference_lap_index" in data:
            try:
                lap_index = int(data["apply_reference_lap_index"])
            except (TypeError, ValueError):
                return jsonify({"error": "invalid apply_reference_lap_index"}), 400
            try:
                out.update(_apply_reference_lap_to_session(session, lap_index))
            except ValueError as e:
                code = str(e)
                if code == "no_processed_data":
                    return jsonify({"error": "Session has no processed data"}), 400
                if code == "bad_lap_index":
                    return jsonify({"error": "Cannot build reference lap for that lap index"}), 400
                raise

        if "session_type" in data:
            session.session_type = normalize_session_type(str(data["session_type"]))

        for field in ("tire_set_id", "track_layout_id", "car_driver_id",
                       "ambient_temp_c", "track_temp_c", "weather_condition",
                       "target_pressure_psi", "lap_count_notes",
                       "roll_out_pressure_fl", "roll_out_pressure_fr",
                       "roll_out_pressure_rl", "roll_out_pressure_rr",
                       "planning_tag",
                       "track", "driver", "car", "outing_number", "session_number"):
            if field in data:
                setattr(session, field, data[field])

        if "bleed_events" in data:
            val = data["bleed_events"]
            if isinstance(val, list):
                session.bleed_events = val

        if "car_driver_id" in data and data["car_driver_id"]:
            cd = store.get_car_driver(data["car_driver_id"])
            if cd:
                session.driver = cd.driver_name
                session.car = cd.car_identifier

        if "target_pressure_psi" in data:
            new_target = data["target_pressure_psi"]
            if (new_target is not None
                    and session.parsed_data
                    and isinstance(session.parsed_data, dict)
                    and session.parsed_data.get("version") == 2):
                patch_pressure_summaries(session.parsed_data, float(new_target))

        store.update_session(session)
        return jsonify(out)

    @app.route("/api/sessions/<sid>/excluded-laps", methods=["PATCH"])
    def api_session_excluded_laps(sid: str):
        session = store.get_session(sid)
        if not session:
            return jsonify({"error": "Not found"}), 404
        data = request.get_json(silent=True) or {}
        laps = data.get("excluded_laps")
        if not isinstance(laps, list):
            return jsonify({"error": "excluded_laps must be a list"}), 400
        try:
            excluded = _apply_excluded_laps_to_session(session, laps)
        except ValueError as e:
            if str(e) != "invalid_lap_indices":
                raise
            return jsonify({"error": "invalid lap indices"}), 400
        store.update_session(session)
        return jsonify({"excluded_laps": excluded})

    @app.route("/api/sessions/<sid>/reference-lap", methods=["POST"])
    def api_session_reference_lap(sid: str):
        session = store.get_session(sid)
        if not session:
            return jsonify({"error": "Not found"}), 404
        data = request.get_json(silent=True) or {}
        if data.get("lap_index") is None:
            return jsonify({"error": "lap_index required"}), 400
        try:
            lap_index = int(data["lap_index"])
        except (TypeError, ValueError):
            return jsonify({"error": "invalid lap_index"}), 400
        try:
            payload = _apply_reference_lap_to_session(session, lap_index)
        except ValueError as e:
            code = str(e)
            if code == "no_processed_data":
                return jsonify({"error": "Session has no processed data"}), 400
            if code == "bad_lap_index":
                return jsonify({"error": "Cannot build reference lap for that lap index"}), 400
            raise
        store.update_session(session)
        return jsonify(payload)

    @app.route("/api/sessions-full")
    def api_sessions_full():
        """Full session list with metadata for the SPA sessions page."""
        sessions = store.list_sessions()
        car_drivers = store.list_car_drivers()
        out = []
        for s in sessions:
            pd = s.parsed_data or {}
            lap_count = len(pd.get("lap_split_times", [])) if pd else 0
            out.append({
                "id": s.id,
                "car_driver_id": s.car_driver_id,
                "session_type": s.session_type,
                "track": s.track,
                "driver": s.driver,
                "car": s.car,
                "outing_number": s.outing_number,
                "session_number": s.session_number,
                "ambient_temp_c": s.ambient_temp_c,
                "track_temp_c": s.track_temp_c,
                "weather_condition": s.weather_condition,
                "lap_count": lap_count,
                "created_at": s.created_at,
            })
        return jsonify({
            "sessions": out,
            "car_drivers": [cd.to_dict() for cd in car_drivers],
        })

    @app.route("/api/sessions/<sid>", methods=["DELETE"])
    def api_session_delete(sid: str):
        s = store.get_session(sid)
        if not s:
            return jsonify({"error": "Not found"}), 404
        for resolved in store.resolve_file_paths(s.file_path):
            try:
                canon = resolved.resolve()
                uploads_canon = store.uploads_dir.resolve()
                if canon.is_file() and canon.is_relative_to(uploads_canon):
                    canon.unlink()
            except OSError:
                log.warning("Failed to delete upload file %s for session %s", resolved, sid, exc_info=True)
        affected_plans = store.delete_session(sid)
        return jsonify({"ok": True, "affected_plans": affected_plans})

    @app.route("/api/sessions/<sid>/reprocess", methods=["POST"])
    def api_session_reprocess(sid: str):
        """Re-run processing from the original export file(s); stream SSE progress."""
        session = store.get_session(sid)
        if not session:
            return jsonify({"error": "Not found"}), 404
        if not _all_source_files_exist(session):
            return jsonify({"error": "Source file(s) not found"}), 400

        def generate():
            try:
                existing = session.parsed_data if isinstance(session.parsed_data, dict) else None
                _stale = stale_stages(existing) if existing else []
                can_incremental = existing and "core" not in _stale and len(_stale) > 0
                yield f"data: {json.dumps({'event': 'progress', 'pct': 0, 'stage': 'Loading export'})}\n\n"
                parsed = _load_session_files(session)
                if parsed is None:
                    yield f"data: {json.dumps({'event': 'error', 'message': 'Failed to load source files'})}\n\n"
                    return
                yield f"data: {json.dumps({'event': 'progress', 'pct': 5, 'stage': 'Parsing'})}\n\n"

                processed = None
                if can_incremental:
                    gen = process_session_incremental(
                        parsed,
                        existing,
                        target_psi=_session_target_psi(session),
                    )
                else:
                    gen = process_session_streaming(
                        parsed,
                        target_psi=_session_target_psi(session),
                        existing_blob=existing,
                    )
                for pct, stage_label, data in gen:
                    yield f"data: {json.dumps({'event': 'progress', 'pct': pct, 'stage': stage_label or 'Processing'})}\n\n"
                    if data is not None:
                        processed = data

                if processed is None:
                    yield f"data: {json.dumps({'event': 'error', 'message': 'Processing failed'})}\n\n"
                    return
                session.parsed_data = sanitize_for_json(processed)
                store.update_session(session)
                yield f"data: {json.dumps({'event': 'complete', 'pct': 100})}\n\n"
            except Exception as e:
                log.exception("Session reprocess failed")
                yield f"data: {json.dumps({'event': 'error', 'message': str(e)})}\n\n"

        return Response(
            stream_with_context(generate()),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.route("/api/track-layouts")
    def api_track_layouts_list():
        layouts = store.list_track_layouts()
        sessions = store.list_sessions()
        session_map = {}
        for s in sessions:
            if s.track_layout_id:
                session_map[s.track_layout_id] = f"{s.car} / {s.track} / {s.session_type}"
        return jsonify({
            "layouts": [tl.to_dict() for tl in layouts],
            "session_map": session_map,
        })

    @app.route("/api/settings")
    def api_settings_get():
        prefs = _get_preferences()
        user = get_current_user()
        return jsonify({
            "preferences": prefs,
            "data_root": str(store.data_root),
            "user": user,
            "oauth_enabled": app.config.get("OAUTH_ENABLED", False),
        })

    @app.route("/api/settings", methods=["PATCH"])
    def api_settings_update():
        data = request.get_json(silent=True) or {}
        prefs = _get_preferences()
        prefs.update(data)
        PREFERENCES_PATH.parent.mkdir(parents=True, exist_ok=True)
        PREFERENCES_PATH.write_text(json.dumps(prefs, indent=2), encoding="utf-8")
        return jsonify({"ok": True})

    @app.route("/api/maintenance/cleanup-uploads", methods=["POST"])
    def api_cleanup_uploads():
        removed = store.cleanup_orphan_uploads()
        return jsonify({"ok": True, "removed": removed, "count": len(removed)})

    # ---- Auth user API (for SPA) ----

    @app.route("/api/auth/user")
    def api_auth_user():
        user = get_current_user()
        return jsonify({
            "user": user,
            "oauth_enabled": app.config.get("OAUTH_ENABLED", False),
        })

    return app


# Module-level app for backward compat: flask --app LapForge.app run
app = create_app()


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    parser = argparse.ArgumentParser(description="LapForge")
    parser.add_argument("--production", action="store_true",
                        help="Run in production mode (no debug, no reloader)")
    parser.add_argument("--port", type=int, default=5000,
                        help="Port to listen on (0 = auto-select free port)")
    args = parser.parse_args()

    port = args.port if args.port != 0 else _find_free_port()

    if args.production:
        print(f"FLASK_READY:port={port}", flush=True)
        app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)
    else:
        app.run(
            host="127.0.0.1",
            port=port,
            debug=True,
            use_reloader=True,
            reloader_type="stat",
        )


if __name__ == "__main__":
    main()
