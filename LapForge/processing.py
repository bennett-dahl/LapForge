"""
Processing pipeline for Pi Toolbox telemetry exports.

Replaces the monolithic ``_process_parsed_to_stored`` in *app.py* with a series
of composable pipeline steps that operate on a shared context dict.  Processes
**all** channels (not just pressure).
"""

from __future__ import annotations

import bisect
import math
from typing import Any, Callable, Generator

from LapForge.channels import categorize_channels, detect_channels

# ---------------------------------------------------------------------------
# Constants (moved from app.py)
# ---------------------------------------------------------------------------

PIPELINE_VERSION: int = 7  # Bump when channel registry or pipeline logic changes

CHART_SMOOTH_WINDOW_S: float = 10.0
CHART_SAMPLE_RATE_HZ: int = 50
CHART_MAX_POINTS: int = 2000
CHART_Y_MIN_PSI: float = 15.0
CHART_Y_MAX_PSI: float = 32.0
DEFAULT_TARGET_PSI: float = 27.0
BAR_TO_PSI: float = 14.5038

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _smooth_linear_regression(
    values: list[float | None], half_window: int
) -> list[float | None]:
    """Smooth using local linear regression (y = a*x + b per window)."""
    n = len(values)
    out: list[float | None] = []
    for i in range(n):
        lo = max(0, i - half_window)
        hi = min(n, i + half_window + 1)
        points = [(j, values[j]) for j in range(lo, hi) if values[j] is not None]
        if len(points) < 2:
            out.append(values[i] if values[i] is not None else None)
            continue
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        mean_x = sum(xs) / len(xs)
        mean_y = sum(ys) / len(ys)
        var_x = sum((x - mean_x) ** 2 for x in xs) / len(xs)
        if var_x < 1e-10:
            out.append(mean_y)
        else:
            cov = sum(
                (x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)
            ) / len(points)
            a = cov / var_x
            b = mean_y - a * mean_x
            out.append(a * i + b)
    return out


def _is_nan(v: Any) -> bool:
    return isinstance(v, float) and v != v


def _safe_float(v: Any) -> float | None:
    if v is None or _is_nan(v):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _detect_time_column(keys: list[str]) -> str:
    return (
        next((c for c in ["Time", "time"] if c in keys), None)
        or next((c for c in keys if c and c.lower() == "time"), None)
        or next((c for c in keys if c and "time" in c.lower()), None)
        or (keys[0] if keys else "time")
    )


def _interpolate_time_to_distance(
    t: float,
    full_times: list[float],
    full_distances: list[float],
) -> float:
    """Linearly interpolate a time value into the distance domain."""
    if not full_times:
        return 0.0
    if t <= full_times[0]:
        return full_distances[0] if full_distances else 0.0
    if t >= full_times[-1]:
        return full_distances[-1] if full_distances else 0.0
    idx = bisect.bisect_right(full_times, t) - 1
    idx = max(0, min(idx, len(full_times) - 2))
    dt = full_times[idx + 1] - full_times[idx]
    frac = (t - full_times[idx]) / dt if dt else 0.0
    return full_distances[idx] + frac * (full_distances[idx + 1] - full_distances[idx])


def _lap_index_at(t: float, lap_splits: list[float]) -> int:
    """Return 0-based lap index for a given session time."""
    if not lap_splits:
        return 0
    return bisect.bisect_right(lap_splits, t)


# ---------------------------------------------------------------------------
# Pipeline steps
# ---------------------------------------------------------------------------


def normalize_channels(ctx: dict) -> None:
    """Extract columnar arrays from parsed rows for every channel."""
    parsed: dict = ctx["parsed"]
    rows: list[dict] = parsed.get("rows") or []
    if not rows:
        ctx["time_col"] = "time"
        ctx["columns"] = []
        ctx["full_times"] = []
        ctx["full_series"] = {}
        ctx["channel_meta"] = {}
        return

    row0_keys = list(rows[0].keys())
    time_col = _detect_time_column(row0_keys)
    ctx["time_col"] = time_col

    data_cols = [k for k in row0_keys if k != time_col]
    ctx["columns"] = data_cols

    full_times: list[float] = []
    full_series: dict[str, list[float | None]] = {c: [] for c in data_cols}

    for r in rows:
        t = r.get(time_col)
        if t is None:
            continue
        full_times.append(round(float(t), 4))
        for c in data_cols:
            v = r.get(c)
            fv = _safe_float(v)
            full_series[c].append(round(fv, 4) if fv is not None else None)

    ctx["full_times"] = full_times
    ctx["full_series"] = full_series
    ctx["channel_meta"] = detect_channels(data_cols)


def compute_distance(ctx: dict) -> None:
    """Build full-resolution distance array and lap-split distances."""
    full_times: list[float] = ctx["full_times"]
    full_series: dict[str, list[float | None]] = ctx["full_series"]
    lap_splits: list[float] = ctx["parsed"].get("lap_split_times") or []
    n = len(full_times)

    # Prefer explicit log_distance channel
    dist_key: str | None = None
    for candidate in ("log_distance", "Log_Distance", "distance"):
        if candidate in full_series:
            dist_key = candidate
            break

    if dist_key is not None:
        raw = full_series[dist_key]
        full_distances: list[float] = []
        for i, v in enumerate(raw):
            if v is not None:
                full_distances.append(v)
            else:
                full_distances.append(full_distances[i - 1] if i > 0 else 0.0)
    else:
        # Integrate from speed channel
        speed_key: str | None = None
        for candidate in ("speed", "Speed", "GPS_Speed", "gps_speed"):
            if candidate in full_series:
                speed_key = candidate
                break

        full_distances: list[float] = []  # type: ignore[no-redef]
        if speed_key is not None and n > 0:
            speeds = full_series[speed_key]
            cum = 0.0
            lap_set = set(lap_splits)
            for i in range(n):
                if i == 0:
                    full_distances.append(0.0)
                    continue
                dt = full_times[i] - full_times[i - 1]
                spd = speeds[i] if speeds[i] is not None else 0.0
                cum += spd / 3.6 * dt
                # Reset at lap boundaries
                for ls in lap_splits:
                    if full_times[i - 1] < ls <= full_times[i]:
                        cum = 0.0
                        break
                full_distances.append(round(cum, 2))
        else:
            full_distances = [0.0] * n

    ctx["full_distances"] = full_distances

    lap_split_distances: list[float] = []
    if full_distances and full_times and lap_splits:
        for t in lap_splits:
            lap_split_distances.append(
                _interpolate_time_to_distance(t, full_times, full_distances)
            )
    ctx["lap_split_distances"] = lap_split_distances


def compute_derived(ctx: dict) -> None:
    """Placeholder for future derived channels (curvature, etc.)."""
    pass


def smooth_pressure(ctx: dict) -> None:
    """Apply linear-regression smoothing to pressure channels only.

    Before smoothing, a copy of the unsmoothed pressure arrays is saved into
    ctx["raw_pressure"] so the frontend can offer adjustable smoothing levels.
    """
    channel_meta: dict[str, dict] = ctx.get("channel_meta", {})
    full_series: dict[str, list[float | None]] = ctx["full_series"]
    smoothing_level: int = ctx.get("smoothing_level", 0)

    pressure_cols = [
        col for col, meta in channel_meta.items()
        if meta.get("category") == "pressure" and col in full_series
    ]
    ctx["raw_pressure"] = {col: list(full_series[col]) for col in pressure_cols}

    effective_window_s = CHART_SMOOTH_WINDOW_S * (1 + smoothing_level)
    half_win = int(effective_window_s * CHART_SAMPLE_RATE_HZ / 2)

    for col in pressure_cols:
        full_series[col] = _smooth_linear_regression(full_series[col], half_win)


def downsample_for_charts(ctx: dict) -> None:
    """Downsample full-resolution arrays to at most CHART_MAX_POINTS."""
    full_times: list[float] = ctx["full_times"]
    full_series: dict[str, list[float | None]] = ctx["full_series"]
    full_distances: list[float] = ctx.get("full_distances", [])
    raw_pressure: dict[str, list] = ctx.get("raw_pressure", {})

    n = len(full_times)
    step = max(1, n // CHART_MAX_POINTS)

    ctx["times"] = full_times[::step]
    ctx["series"] = {
        c: [vals[i] for i in range(0, n, step)] for c, vals in full_series.items()
    }
    ctx["distances"] = full_distances[::step] if full_distances else []
    ctx["raw_pressure_chart"] = {
        c: [vals[i] for i in range(0, len(vals), step)]
        for c, vals in raw_pressure.items()
    }


def _haversine_dist(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres between two lat/lon points."""
    R = 6_371_000.0
    rlat1, rlat2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _smooth_gps_trace(
    lats: list[float | None],
    lons: list[float | None],
    distances: list[float],
) -> tuple[list[float], list[float], list[float]]:
    """Smooth a GPS trace using distance-based interpolation.

    Low-rate GPS (1-10 Hz) in a high-rate logger (50 Hz) produces duplicate
    consecutive positions and quantisation steps.  This function:
    1. Extracts unique (distance, lat, lon) knots (skipping consecutive duplicates).
    2. Applies a moving average to the knots to remove quantisation noise.
    3. Linearly interpolates back to evenly-spaced distance samples.

    Returns (smoothed_lats, smoothed_lons, smoothed_distances) with uniformly
    spaced points every ~1 m.
    """
    # Build valid knots by removing consecutive duplicate GPS positions
    knot_d: list[float] = []
    knot_lat: list[float] = []
    knot_lon: list[float] = []

    prev_lat: float | None = None
    prev_lon: float | None = None
    for i, (la, lo) in enumerate(zip(lats, lons)):
        if la is None or lo is None:
            continue
        if la == prev_lat and lo == prev_lon:
            continue
        d = distances[i] if i < len(distances) else 0.0
        knot_d.append(d)
        knot_lat.append(la)
        knot_lon.append(lo)
        prev_lat, prev_lon = la, lo

    if len(knot_d) < 4:
        valid = [(la, lo, distances[i] if i < len(distances) else 0.0)
                 for i, (la, lo) in enumerate(zip(lats, lons))
                 if la is not None and lo is not None]
        if not valid:
            return [], [], []
        return [v[0] for v in valid], [v[1] for v in valid], [v[2] for v in valid]

    # Moving-average smooth the knots — two passes for stronger effect.
    # First pass: wide window (~50 m), second pass: narrower (~20 m).
    avg_spacing = (knot_d[-1] - knot_d[0]) / max(1, len(knot_d) - 1)
    n_knots = len(knot_d)

    def _ma_pass(src_lat: list[float], src_lon: list[float], radius_m: float):
        hw = max(1, int(radius_m / avg_spacing)) if avg_spacing > 0 else 3
        out_lat: list[float] = []
        out_lon: list[float] = []
        for i in range(n_knots):
            lo_i = max(0, i - hw)
            hi_i = min(n_knots, i + hw + 1)
            cnt = hi_i - lo_i
            out_lat.append(sum(src_lat[lo_i:hi_i]) / cnt)
            out_lon.append(sum(src_lon[lo_i:hi_i]) / cnt)
        return out_lat, out_lon

    smooth_lat, smooth_lon = _ma_pass(knot_lat, knot_lon, 25.0)
    smooth_lat, smooth_lon = _ma_pass(smooth_lat, smooth_lon, 10.0)

    # Resample at ~1 m intervals along distance
    total_d = knot_d[-1] - knot_d[0]
    n_out = max(int(total_d), 200)
    step = total_d / n_out if n_out > 0 else 1.0
    d_base = knot_d[0]

    out_d: list[float] = []
    out_lat: list[float] = []
    out_lon: list[float] = []
    ki = 0
    for si in range(n_out + 1):
        target_d = d_base + si * step
        while ki < n_knots - 2 and knot_d[ki + 1] < target_d:
            ki += 1
        d0 = knot_d[ki]
        d1 = knot_d[ki + 1] if ki + 1 < n_knots else d0
        frac = (target_d - d0) / (d1 - d0) if d1 > d0 else 0.0
        frac = max(0.0, min(1.0, frac))
        out_lat.append(smooth_lat[ki] + frac * (smooth_lat[min(ki + 1, n_knots - 1)] - smooth_lat[ki]))
        out_lon.append(smooth_lon[ki] + frac * (smooth_lon[min(ki + 1, n_knots - 1)] - smooth_lon[ki]))
        out_d.append(target_d)

    # Close the circuit: snap the last point to the first so the loop is seamless
    if out_lat and out_lon:
        close_d = _haversine_dist(out_lat[-1], out_lon[-1], out_lat[0], out_lon[0])
        if close_d < 200:  # only close if gap < 200 m (sanity check)
            out_lat.append(out_lat[0])
            out_lon.append(out_lon[0])
            out_d.append(out_d[-1] + close_d)

    # Re-zero distances so the trace starts at 0
    if out_d:
        d0 = out_d[0]
        out_d = [d - d0 for d in out_d]

    return out_lat, out_lon, out_d


def _build_reference_lap_at_index(
    lap_splits: list[float],
    lap_index: int,
    full_times: list[float],
    full_series: dict[str, list[float | None]],
    full_distances: list[float],
    channel_meta: dict[str, dict],
) -> dict | None:
    """Extract GPS trace for lap segment ``lap_index`` (0-based; segment i is splits[i]..splits[i+1])."""
    if len(lap_splits) < 2 or lap_index < 0 or lap_index >= len(lap_splits) - 1:
        return None
    lap_start = lap_splits[lap_index]
    lap_end = lap_splits[lap_index + 1]
    best_time = lap_end - lap_start
    if best_time <= 0:
        return None

    categories = categorize_channels(channel_meta)
    gps_cols = categories.get("gps", [])

    lat_col: str | None = None
    lon_col: str | None = None
    heading_col: str | None = None
    for col in gps_cols:
        lower = col.lower()
        meta = channel_meta.get(col, {})
        display = meta.get("display", "").lower()
        if "lat" in lower or "lat" in display:
            lat_col = lat_col or col
        elif "lon" in lower or "lon" in display:
            lon_col = lon_col or col
        elif "head" in lower or "head" in display or "course" in lower or "bearing" in lower:
            heading_col = heading_col or col

    if lat_col is None or lon_col is None:
        return None

    i_start = bisect.bisect_left(full_times, lap_start)
    i_end = bisect.bisect_right(full_times, lap_end)

    raw_lat = full_series.get(lat_col, [])[i_start:i_end]
    raw_lon = full_series.get(lon_col, [])[i_start:i_end]
    raw_heading = (
        full_series.get(heading_col, [])[i_start:i_end] if heading_col else []
    )
    raw_distance = full_distances[i_start:i_end] if full_distances else []

    if raw_distance:
        d0 = raw_distance[0]
        raw_distance = [d - d0 for d in raw_distance]

    if raw_distance and len(raw_distance) == len(raw_lat):
        sm_lat, sm_lon, sm_dist = _smooth_gps_trace(raw_lat, raw_lon, raw_distance)
    else:
        sm_lat = [v for v in raw_lat if v is not None]
        sm_lon = [v for v in raw_lon if v is not None]
        sm_dist = raw_distance

    gps_col_set = {lat_col, lon_col}
    if heading_col:
        gps_col_set.add(heading_col)

    lap_series: dict[str, list] = {}
    for ch_name, ch_vals in full_series.items():
        if ch_name in gps_col_set:
            continue
        sliced = ch_vals[i_start:i_end]
        if sliced:
            lap_series[ch_name] = sliced

    lap_times = full_times[i_start:i_end]
    t0 = lap_times[0] if lap_times else 0.0
    lap_times = [t - t0 for t in lap_times]

    return {
        "lap_index": lap_index,
        "lap_time": round(best_time, 4),
        "complete_lap": True,
        "lat": sm_lat,
        "lon": sm_lon,
        "heading": raw_heading,
        "distance": sm_dist,
        "distances_raw": raw_distance,
        "times": lap_times,
        "series": lap_series,
        "channel_meta": dict(channel_meta),
    }


def extract_reference_lap_from_session_blob(session_blob: dict, lap_index: int) -> dict | None:
    """Build ``reference_lap`` from a v2 stored session blob (``parsed_data``) for a chosen lap index."""
    lap_splits = session_blob.get("lap_splits") or session_blob.get("lap_split_times") or []
    full_times = session_blob.get("raw_times") or []
    full_series = session_blob.get("raw_series") or {}
    full_distances = session_blob.get("raw_distances") or []
    channel_meta = session_blob.get("channel_meta") or {}
    return _build_reference_lap_at_index(
        lap_splits,
        lap_index,
        full_times,
        full_series,
        full_distances,
        channel_meta,
    )


def _coerce_map_lap_segment_index(val: Any, n_segments: int) -> int | None:
    """Return a valid 0-based segment index or None."""
    if val is None:
        return None
    try:
        i = int(val)
    except (TypeError, ValueError):
        return None
    if i < 0 or i >= n_segments:
        return None
    return i


def _map_lap_pref_from_existing(existing_blob: dict | None) -> Any:
    """Read persisted user map-lap preference from a v2 blob (or None)."""
    if not existing_blob:
        return None
    v = existing_blob.get("map_lap_segment_index")
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return int(v)
    if isinstance(v, str) and v.strip().lstrip("-").isdigit():
        return int(v)
    return None


def build_reference_lap(ctx: dict) -> None:
    """Pick reference GPS: user ``map_lap_segment_index`` if set, else fastest valid lap."""
    lap_splits: list[float] = ctx["parsed"].get("lap_split_times") or []
    full_times: list[float] = ctx["full_times"]
    full_series: dict[str, list[float | None]] = ctx["full_series"]
    full_distances: list[float] = ctx.get("full_distances", [])
    channel_meta: dict[str, dict] = ctx.get("channel_meta", {})

    if len(lap_splits) < 2:
        ctx["reference_lap"] = None
        ctx["map_lap_segment_index"] = None
        return

    n_segments = len(lap_splits) - 1

    pref = _coerce_map_lap_segment_index(ctx.get("map_lap_segment_index"), n_segments)
    if pref is not None:
        dt = lap_splits[pref + 1] - lap_splits[pref]
        if dt > 0:
            ctx["reference_lap"] = _build_reference_lap_at_index(
                lap_splits,
                pref,
                full_times,
                full_series,
                full_distances,
                channel_meta,
            )
            ctx["map_lap_segment_index"] = pref
            return
    ctx["map_lap_segment_index"] = None

    candidate_times: list[tuple[int, float]] = []
    for i in range(n_segments):
        if i == 0:
            continue
        dt = lap_splits[i + 1] - lap_splits[i]
        if dt > 0:
            candidate_times.append((i, dt))

    if not candidate_times:
        for i in range(n_segments):
            dt = lap_splits[i + 1] - lap_splits[i]
            if dt > 0:
                candidate_times.append((i, dt))

    if not candidate_times:
        ctx["reference_lap"] = None
        ctx["map_lap_segment_index"] = None
        return

    times_only = [ct[1] for ct in candidate_times]
    times_only.sort()
    median_dt = times_only[len(times_only) // 2]

    valid = [(i, dt) for i, dt in candidate_times if dt >= 0.7 * median_dt]
    if not valid:
        valid = candidate_times

    best_idx, best_time = min(valid, key=lambda x: x[1])

    ctx["reference_lap"] = _build_reference_lap_at_index(
        lap_splits,
        best_idx,
        full_times,
        full_series,
        full_distances,
        channel_meta,
    )


def build_summary(ctx: dict) -> None:
    """Build session summary including pressure statistics."""
    full_times: list[float] = ctx["full_times"]
    full_series: dict[str, list[float | None]] = ctx["full_series"]
    channel_meta: dict[str, dict] = ctx.get("channel_meta", {})
    lap_splits: list[float] = ctx["parsed"].get("lap_split_times") or []
    categories = categorize_channels(channel_meta)
    target_psi: float = ctx.get("target_psi") or DEFAULT_TARGET_PSI

    has_gps = bool(categories.get("gps"))
    ref = ctx.get("reference_lap")

    lap_count = max(1, len(lap_splits))

    fastest_lap_index: int | None = None
    fastest_lap_time: float | None = None
    if len(lap_splits) >= 2:
        for i in range(len(lap_splits) - 1):
            if i == 0:
                continue
            dt = lap_splits[i + 1] - lap_splits[i]
            if dt > 0 and (fastest_lap_time is None or dt < fastest_lap_time):
                fastest_lap_time = round(dt, 4)
                fastest_lap_index = i

    pressure_cols = categories.get("pressure", [])
    bar_pressure_cols = [
        c for c in pressure_cols
        if channel_meta.get(c, {}).get("unit") == "bar"
    ]

    pressure_summary_psi = _pressure_summary(
        full_times, full_series, bar_pressure_cols, lap_splits,
        use_psi=True, target_psi=target_psi,
    )
    pressure_summary_bar = _pressure_summary(
        full_times, full_series, bar_pressure_cols, lap_splits,
        use_psi=False, target_psi=target_psi,
    )

    ctx["summary"] = {
        "lap_count": lap_count,
        "fastest_lap_index": fastest_lap_index,
        "fastest_lap_time": fastest_lap_time,
        "has_gps": has_gps,
        "available_categories": sorted(categories.keys()),
        "channel_list": list(channel_meta.keys()),
        "pressure_summary_psi": pressure_summary_psi,
        "pressure_summary_bar": pressure_summary_bar,
    }


_CORNER_MAP = {
    "tpms_press_fl": "fl", "tpms_press_fl_psi": "fl",
    "tpms_press_fr": "fr", "tpms_press_fr_psi": "fr",
    "tpms_press_rl": "rl", "tpms_press_rl_psi": "rl",
    "tpms_press_rr": "rr", "tpms_press_rr_psi": "rr",
}


def _pressure_summary(
    full_times: list[float],
    full_series: dict[str, list[float | None]],
    pressure_cols: list[str],
    lap_splits: list[float],
    use_psi: bool,
    target_psi: float = DEFAULT_TARGET_PSI,
) -> dict:
    """Compute per-corner and global pressure summary from columnar arrays."""
    if not pressure_cols or not full_times:
        return {}

    multiplier = BAR_TO_PSI if use_psi else 1.0
    target = target_psi if use_psi else round(target_psi / BAR_TO_PSI, 4)

    per_lap_vals: dict[int, list[float]] = {}
    all_vals: list[float] = []
    corner_vals: dict[str, list[float]] = {}
    corner_first: dict[str, float | None] = {}
    corner_last: dict[str, float | None] = {}

    for c in pressure_cols:
        corner = _CORNER_MAP.get(c.lower())
        series_data = full_series.get(c, [])
        for idx, t in enumerate(full_times):
            lap = _lap_index_at(t, lap_splits)
            raw = series_data[idx] if idx < len(series_data) else None
            if raw is None:
                continue
            val = raw * multiplier
            all_vals.append(val)
            per_lap_vals.setdefault(lap, []).append(val)
            if corner:
                corner_vals.setdefault(corner, []).append(val)
                if corner not in corner_first:
                    corner_first[corner] = val
                corner_last[corner] = val

    if not all_vals:
        return {}

    global_min = round(min(all_vals), 3)
    global_max = round(max(all_vals), 3)

    laps_over: list[int] = []
    for lap_idx, vals in per_lap_vals.items():
        if max(vals) > target:
            laps_over.append(lap_idx)

    result: dict = {
        "target": target,
        "unit": "psi" if use_psi else "bar",
        "global_min": global_min,
        "global_max": global_max,
        "laps_over_target": laps_over,
        "lap_count": len(per_lap_vals),
        "lap_splits": lap_splits,
        "qual_note": (
            "In range at lap start, slightly over at lap end."
            if not laps_over
            else "Some laps over target; consider lower starting pressure for qual."
        ),
        "race_note": (
            "Never over target; right pressure throughout."
            if not laps_over
            else "Laps over target — reduce starting pressure so steady-state stays at or just under target."
        ),
    }

    for corner in ("fl", "fr", "rl", "rr"):
        vals = corner_vals.get(corner, [])
        if not vals:
            result[corner] = {"avg": None, "min": None, "max": None, "start": None, "end": None}
        else:
            result[corner] = {
                "avg": round(sum(vals) / len(vals), 3),
                "min": round(min(vals), 3),
                "max": round(max(vals), 3),
                "start": round(corner_first.get(corner, vals[0]), 3),
                "end": round(corner_last.get(corner, vals[-1]), 3),
            }

    return result


def pressure_window_stats(
    full_times: list[float],
    full_series: dict[str, list[float | None]],
    pressure_cols: list[str],
    lap_splits: list[float],
    target_psi: float,
    lap_start: int,
    lap_end: int | None,
) -> dict:
    """Compute per-corner stats within a specific lap window.

    Returns {fl: {avg, min, max, lap_start_pressure, pct_in_band}, ...}
    where lap_start_pressure is the first reading of that corner in the window.
    """
    if not pressure_cols or not full_times:
        return {}

    seen_corners: set[str] = set()
    corner_vals: dict[str, list[float]] = {}
    corner_lap_start: dict[str, dict[int, float]] = {}

    for c in pressure_cols:
        corner = _CORNER_MAP.get(c.lower())
        if not corner or corner in seen_corners:
            continue
        seen_corners.add(corner)
        multiplier = 1.0 if c.lower().endswith("_psi") else BAR_TO_PSI
        series_data = full_series.get(c, [])
        for idx, t in enumerate(full_times):
            lap = _lap_index_at(t, lap_splits)
            if lap < lap_start:
                continue
            if lap_end is not None and lap > lap_end:
                continue
            raw = series_data[idx] if idx < len(series_data) else None
            if raw is None:
                continue
            val = raw * multiplier
            corner_vals.setdefault(corner, []).append(val)
            if corner not in corner_lap_start:
                corner_lap_start[corner] = {}
            if lap not in corner_lap_start[corner]:
                corner_lap_start[corner][lap] = val

    result: dict = {}
    for corner in ("fl", "fr", "rl", "rr"):
        vals = corner_vals.get(corner, [])
        if not vals:
            result[corner] = {"avg": None, "min": None, "max": None,
                              "lap_start_pressure": None, "pct_in_band": None,
                              "delta_from_target": None}
            continue
        avg = sum(vals) / len(vals)
        in_band = sum(1 for v in vals if abs(v - target_psi) <= 0.5) / len(vals) * 100
        lap_start_vals = corner_lap_start.get(corner, {})
        first_lap_start = lap_start_vals.get(lap_start)
        delta = (first_lap_start - target_psi) if first_lap_start is not None else None
        result[corner] = {
            "avg": round(avg, 2),
            "min": round(min(vals), 2),
            "max": round(max(vals), 2),
            "lap_start_pressure": round(first_lap_start, 2) if first_lap_start is not None else None,
            "pct_in_band": round(in_band, 1),
            "delta_from_target": round(delta, 2) if delta is not None else None,
        }

    all_vals = [v for vals in corner_vals.values() for v in vals]
    if all_vals:
        result["_summary"] = {
            "avg_delta": round(sum(v - target_psi for v in all_vals) / len(all_vals), 2),
            "pct_in_band": round(sum(1 for v in all_vals if abs(v - target_psi) <= 0.5) / len(all_vals) * 100, 1),
        }

    return result


def pressure_lap_band_summary(
    full_times: list[float],
    full_series: dict[str, list[float | None]],
    pressure_cols: list[str],
    lap_splits: list[float],
    target_psi: float,
    acceptable_psi: float,
    optimal_psi: float,
    lap_start: int,
    lap_end: int | None,
    *,
    acceptable_upper: float | None = None,
    acceptable_lower: float | None = None,
    optimal_upper: float | None = None,
    optimal_lower: float | None = None,
) -> dict:
    """Per-lap band summary using worst-corner rule.

    A lap is "in band" only when ALL four corners' mean pressure for that lap
    falls within the tolerance window around *target_psi*.  Tolerances can be
    asymmetric: ``_upper`` = allowed overshoot, ``_lower`` = allowed undershoot.
    When the split values are None the symmetric ``acceptable_psi`` /
    ``optimal_psi`` value is used for both directions.

    Lap numbers returned are window-relative (first lap in the range → 1).

    Returns dict with keys:
        first_acceptable_lap, last_acceptable_lap,
        first_optimal_lap, last_optimal_lap,
        laps_outside_optimal_after_entry  (None if never entered optimal),
        avg_first_acceptable_lap, avg_last_acceptable_lap,
        avg_first_optimal_lap, avg_last_optimal_lap,
        corner_delta_psi  ({fl, fr, rl, rr} mean delta from target)
    """
    _empty: dict = {
        "first_acceptable_lap": None, "last_acceptable_lap": None,
        "first_optimal_lap": None, "last_optimal_lap": None,
        "laps_outside_optimal_after_entry": None,
        "avg_first_acceptable_lap": None, "avg_last_acceptable_lap": None,
        "avg_first_optimal_lap": None, "avg_last_optimal_lap": None,
        "corner_delta_psi": None,
        "sustained_delta_psi": None,
        "max_delta_psi": None,
    }
    if not pressure_cols or not full_times:
        return _empty

    seen_corners: set[str] = set()
    corner_lap_vals: dict[str, dict[int, list[float]]] = {}
    for c in pressure_cols:
        corner = _CORNER_MAP.get(c.lower())
        if not corner or corner in seen_corners:
            continue
        seen_corners.add(corner)
        multiplier = 1.0 if c.lower().endswith("_psi") else BAR_TO_PSI
        series_data = full_series.get(c, [])
        for idx, t in enumerate(full_times):
            lap = _lap_index_at(t, lap_splits)
            if lap < lap_start:
                continue
            if lap_end is not None and lap > lap_end:
                continue
            raw = series_data[idx] if idx < len(series_data) else None
            if raw is None:
                continue
            val = raw * multiplier
            corner_lap_vals.setdefault(corner, {}).setdefault(lap, []).append(val)

    all_laps_in_window = sorted({
        lap for clv in corner_lap_vals.values() for lap in clv
    })
    if not all_laps_in_window:
        return _empty

    a_upper = acceptable_upper if acceptable_upper is not None else acceptable_psi
    a_lower = acceptable_lower if acceptable_lower is not None else acceptable_psi
    o_upper = optimal_upper if optimal_upper is not None else optimal_psi
    o_lower = optimal_lower if optimal_lower is not None else optimal_psi

    def _lap_in_band(lap: int, upper: float, lower: float) -> bool:
        for corner in ("fl", "fr", "rl", "rr"):
            vals = corner_lap_vals.get(corner, {}).get(lap)
            if not vals:
                return False
            mean = sum(vals) / len(vals)
            delta = mean - target_psi
            if delta > upper or delta < -lower:
                return False
        return True

    first_acceptable: int | None = None
    last_acceptable: int | None = None
    first_optimal: int | None = None
    last_optimal: int | None = None

    for lap in all_laps_in_window:
        rel = lap - lap_start + 1
        if _lap_in_band(lap, a_upper, a_lower):
            if first_acceptable is None:
                first_acceptable = rel
            last_acceptable = rel
        if _lap_in_band(lap, o_upper, o_lower):
            if first_optimal is None:
                first_optimal = rel
            last_optimal = rel

    laps_outside: int | None = None
    if first_optimal is not None:
        abs_first_optimal = first_optimal + lap_start - 1
        laps_outside = 0
        for lap in all_laps_in_window:
            if lap < abs_first_optimal:
                continue
            if not _lap_in_band(lap, o_upper, o_lower):
                laps_outside += 1

    # Average-of-4-corners band: uses the mean of all 4 corner means per lap
    avg_first_acceptable: int | None = None
    avg_last_acceptable: int | None = None
    avg_first_optimal: int | None = None
    avg_last_optimal: int | None = None
    avg_optimal_abs_lap: int | None = None
    best_avg_lap: int | None = None
    best_avg_abs_delta: float = float("inf")

    for lap in all_laps_in_window:
        corner_means = []
        for corner in ("fl", "fr", "rl", "rr"):
            vals = corner_lap_vals.get(corner, {}).get(lap)
            if vals:
                corner_means.append(sum(vals) / len(vals))
        if not corner_means:
            continue
        avg_delta = (sum(corner_means) / len(corner_means)) - target_psi
        rel = lap - lap_start + 1
        if -a_lower <= avg_delta <= a_upper:
            if avg_first_acceptable is None:
                avg_first_acceptable = rel
            avg_last_acceptable = rel
        if -o_lower <= avg_delta <= o_upper:
            if avg_first_optimal is None:
                avg_first_optimal = rel
                avg_optimal_abs_lap = lap
            avg_last_optimal = rel
        if abs(avg_delta) < best_avg_abs_delta:
            best_avg_abs_delta = abs(avg_delta)
            best_avg_lap = lap

    # Per-corner delta at the lap where the 4-tire average is closest to target
    corner_delta_psi: dict[str, float | None] = {}
    if best_avg_lap is not None:
        for corner in ("fl", "fr", "rl", "rr"):
            vals = corner_lap_vals.get(corner, {}).get(best_avg_lap)
            if vals:
                corner_delta_psi[corner] = round(
                    (sum(vals) / len(vals)) - target_psi, 2,
                )
            else:
                corner_delta_psi[corner] = None
    else:
        for corner in ("fl", "fr", "rl", "rr"):
            corner_delta_psi[corner] = None

    # Sustained per-corner delta: average from optimal entry through end of window
    sustained_delta_psi: dict[str, float | None] = {}
    if avg_optimal_abs_lap is not None:
        for corner in ("fl", "fr", "rl", "rr"):
            vals_after: list[float] = []
            for lap in all_laps_in_window:
                if lap < avg_optimal_abs_lap:
                    continue
                lv = corner_lap_vals.get(corner, {}).get(lap)
                if lv:
                    vals_after.extend(lv)
            if vals_after:
                sustained_delta_psi[corner] = round(
                    (sum(vals_after) / len(vals_after)) - target_psi, 2,
                )
            else:
                sustained_delta_psi[corner] = None
    else:
        for corner in ("fl", "fr", "rl", "rr"):
            sustained_delta_psi[corner] = None

    # Peak pressure per corner after the 4-tire avg reaches target, as delta from target
    max_delta_psi: dict[str, float | None] = {}
    if best_avg_lap is not None:
        for corner in ("fl", "fr", "rl", "rr"):
            peak: float | None = None
            for lap in all_laps_in_window:
                if lap < best_avg_lap:
                    continue
                lv = corner_lap_vals.get(corner, {}).get(lap)
                if lv:
                    for v in lv:
                        if peak is None or v > peak:
                            peak = v
            max_delta_psi[corner] = round(peak - target_psi, 2) if peak is not None else None
    else:
        for corner in ("fl", "fr", "rl", "rr"):
            max_delta_psi[corner] = None

    return {
        "first_acceptable_lap": first_acceptable,
        "last_acceptable_lap": last_acceptable,
        "first_optimal_lap": first_optimal,
        "last_optimal_lap": last_optimal,
        "laps_outside_optimal_after_entry": laps_outside,
        "avg_first_acceptable_lap": avg_first_acceptable,
        "avg_last_acceptable_lap": avg_last_acceptable,
        "avg_first_optimal_lap": avg_first_optimal,
        "avg_last_optimal_lap": avg_last_optimal,
        "corner_delta_psi": corner_delta_psi,
        "sustained_delta_psi": sustained_delta_psi,
        "max_delta_psi": max_delta_psi,
    }


# ---------------------------------------------------------------------------
# Pipeline definition
# ---------------------------------------------------------------------------

PIPELINE_STEPS: list[Callable[[dict], None]] = [
    normalize_channels,
    compute_distance,
    compute_derived,
    smooth_pressure,
    downsample_for_charts,
    build_reference_lap,
    build_summary,
]

# ---------------------------------------------------------------------------
# Staged pipeline
# ---------------------------------------------------------------------------

STAGES: list[dict[str, Any]] = [
    {
        "name": "core",
        "label": "Core data",
        "version": 1,
        "weight": 80,
        "steps": [normalize_channels, compute_distance, compute_derived,
                  smooth_pressure, downsample_for_charts],
    },
    {
        "name": "track_map",
        "label": "Track map",
        "version": 1,
        "weight": 10,
        "steps": [build_reference_lap],
    },
    {
        "name": "summary",
        "label": "Summary",
        "version": 1,
        "weight": 10,
        "steps": [build_summary],
    },
]


def get_stage_versions() -> dict[str, int]:
    """Return {stage_name: version} for all stages."""
    return {s["name"]: s["version"] for s in STAGES}


def _build_result_blob(ctx: dict, smoothing_level: int, parsed: dict) -> dict:
    """Assemble the v2 stored blob from pipeline context."""
    out: dict[str, Any] = {
        "processed": True,
        "version": 2,
        "pipeline_version": PIPELINE_VERSION,
        "stage_versions": get_stage_versions(),
        "smoothing_level": smoothing_level,
        "columns": ctx.get("columns", []),
        "channel_meta": ctx.get("channel_meta", {}),
        "lap_splits": parsed.get("lap_split_times") or [],
        "lap_split_distances": ctx.get("lap_split_distances", []),
        "times": ctx.get("times", []),
        "distances": ctx.get("distances", []),
        "series": ctx.get("series", {}),
        "raw_times": ctx.get("full_times", []),
        "raw_distances": ctx.get("full_distances", []),
        "raw_series": ctx.get("full_series", {}),
        "raw_pressure_chart": ctx.get("raw_pressure_chart", {}),
        "reference_lap": ctx.get("reference_lap"),
        "summary": ctx.get("summary", {}),
        "file_metadata": parsed.get("metadata") or {},
    }
    ml = ctx.get("map_lap_segment_index")
    if ml is not None:
        out["map_lap_segment_index"] = int(ml)
    return out


def stale_stages(existing_blob: dict | None) -> list[str]:
    """Return list of stage names that are stale (version mismatch) or missing."""
    if not existing_blob:
        return [s["name"] for s in STAGES]
    blob_sv = existing_blob.get("stage_versions") or {}
    out: list[str] = []
    for s in STAGES:
        if blob_sv.get(s["name"]) != s["version"]:
            out.append(s["name"])
    return out


def needs_reprocess(existing_blob: dict | None) -> bool:
    """True if any stage version is stale compared to current code."""
    if not existing_blob:
        return True
    if existing_blob.get("pipeline_version") != PIPELINE_VERSION:
        return True
    return len(stale_stages(existing_blob)) > 0


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def process_session(
    parsed: dict,
    smoothing_level: int = 0,
    progress_cb: Callable[[int], None] | None = None,
    target_psi: float | None = None,
    existing_blob: dict | None = None,
) -> dict:
    """Run the full pipeline and return a v2 stored blob."""
    ctx: dict[str, Any] = {
        "parsed": parsed,
        "smoothing_level": smoothing_level,
        "target_psi": target_psi or DEFAULT_TARGET_PSI,
        "map_lap_segment_index": _map_lap_pref_from_existing(existing_blob),
    }

    total = len(PIPELINE_STEPS)
    for i, step in enumerate(PIPELINE_STEPS):
        step(ctx)
        if progress_cb is not None:
            progress_cb(int((i + 1) / total * 100))

    return _build_result_blob(ctx, smoothing_level, parsed)


def sanitize_for_json(obj: Any) -> Any:
    """Replace float NaN / Infinity with None so ``json.dumps`` doesn't raise."""
    if isinstance(obj, dict):
        return {k: sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_for_json(v) for v in obj]
    if isinstance(obj, float) and (obj != obj or math.isinf(obj)):
        return None
    return obj


def process_session_streaming(
    parsed: dict,
    smoothing_level: int = 0,
    target_psi: float | None = None,
    existing_blob: dict | None = None,
) -> Generator[tuple[int, str | None, dict | None], None, None]:
    """Generator yielding ``(pct, stage_label, None)`` during work, then ``(100, None, result)``.

    Uses weighted stages so the progress bar reflects actual compute cost.
    When ``existing_blob`` is set (e.g. reprocess), ``map_lap_segment_index`` is preserved.
    """
    ctx: dict[str, Any] = {
        "parsed": parsed,
        "smoothing_level": smoothing_level,
        "target_psi": target_psi or DEFAULT_TARGET_PSI,
        "map_lap_segment_index": _map_lap_pref_from_existing(existing_blob),
    }

    total_weight = sum(s["weight"] for s in STAGES)
    cumulative_pct = 0.0

    for stage in STAGES:
        stage_steps = stage["steps"]
        stage_weight = stage["weight"]
        step_count = len(stage_steps)

        for step_i, step_fn in enumerate(stage_steps):
            step_fn(ctx)
            step_frac = (step_i + 1) / step_count
            pct = cumulative_pct + (stage_weight / total_weight * step_frac * 95)
            yield (int(pct), stage["label"], None)

        cumulative_pct += stage_weight / total_weight * 95

    result = _build_result_blob(ctx, smoothing_level, parsed)
    yield (100, None, result)


def process_session_incremental(
    parsed: dict,
    existing_blob: dict,
    smoothing_level: int = 0,
    target_psi: float | None = None,
) -> Generator[tuple[int, str | None, dict | None], None, None]:
    """Re-run only stale stages and their downstream dependents.

    Yields ``(pct, stage_label, None)`` during work, then ``(100, None, result)``.
    If the 'core' stage is stale, this falls back to a full reprocess.
    """
    stale = set(stale_stages(existing_blob))
    stage_names = [s["name"] for s in STAGES]

    # If core is stale, everything downstream must re-run → full reprocess
    if "core" in stale:
        yield from process_session_streaming(parsed, smoothing_level, target_psi, existing_blob)
        return

    # Rebuild ctx from existing blob so downstream stages can run
    ctx: dict[str, Any] = {
        "parsed": parsed,
        "smoothing_level": smoothing_level,
        "target_psi": target_psi or DEFAULT_TARGET_PSI,
        "columns": existing_blob.get("columns", []),
        "channel_meta": existing_blob.get("channel_meta", {}),
        "full_times": existing_blob.get("raw_times", []),
        "full_distances": existing_blob.get("raw_distances", []),
        "full_series": existing_blob.get("raw_series", {}),
        "times": existing_blob.get("times", []),
        "distances": existing_blob.get("distances", []),
        "series": existing_blob.get("series", {}),
        "lap_split_distances": existing_blob.get("lap_split_distances", []),
        "reference_lap": existing_blob.get("reference_lap"),
        "summary": existing_blob.get("summary", {}),
        "map_lap_segment_index": _map_lap_pref_from_existing(existing_blob),
    }

    # Mark stages downstream of any stale stage as needing re-run
    first_stale_idx = len(STAGES)
    for i, s in enumerate(STAGES):
        if s["name"] in stale:
            first_stale_idx = min(first_stale_idx, i)
    stages_to_run = STAGES[first_stale_idx:]

    total_weight = sum(s["weight"] for s in STAGES)
    skipped_weight = sum(s["weight"] for s in STAGES[:first_stale_idx])
    cumulative_pct = skipped_weight / total_weight * 95

    for stage in stages_to_run:
        stage_steps = stage["steps"]
        stage_weight = stage["weight"]
        step_count = len(stage_steps)

        for step_i, step_fn in enumerate(stage_steps):
            step_fn(ctx)
            step_frac = (step_i + 1) / step_count
            pct = cumulative_pct + (stage_weight / total_weight * step_frac * 95)
            yield (int(pct), stage["label"], None)

        cumulative_pct += stage_weight / total_weight * 95

    result = _build_result_blob(ctx, smoothing_level, parsed)
    yield (100, None, result)


def patch_pressure_summaries(blob: dict, target_psi: float) -> dict:
    """Re-compute pressure summaries in a v2 blob using downsampled data.

    This avoids a full reprocess when only the target pressure changes.
    """
    times = blob.get("times") or []
    series = blob.get("series") or {}
    channel_meta = blob.get("channel_meta") or {}
    lap_splits = blob.get("lap_splits") or []
    categories = categorize_channels(channel_meta)

    bar_pressure_cols = [
        c for c in categories.get("pressure", [])
        if channel_meta.get(c, {}).get("unit") == "bar"
    ]

    psi_summary = _pressure_summary(
        times, series, bar_pressure_cols, lap_splits,
        use_psi=True, target_psi=target_psi,
    )
    bar_summary = _pressure_summary(
        times, series, bar_pressure_cols, lap_splits,
        use_psi=False, target_psi=target_psi,
    )

    summary = dict(blob.get("summary") or {})
    summary["pressure_summary_psi"] = psi_summary
    summary["pressure_summary_bar"] = bar_summary
    blob["summary"] = summary
    return blob
