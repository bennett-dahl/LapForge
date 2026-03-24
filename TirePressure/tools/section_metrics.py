"""
Analysis tool: Section Metrics.

Per-lap per-section performance table: duration, entry/min/exit speed,
max brake pressure, throttle integral, peak G. Delta vs reference lap.
Virtual best row = sum of per-section bests.
"""

from __future__ import annotations

import bisect
from typing import Any

TOOL_NAME = "section_metrics"
DISPLAY_NAME = "Section Metrics"
REQUIRED_CHANNELS = ["speed"]
OPTIONAL_CHANNELS = ["aps", "pbrake_f", "accx", "accy"]
TEMPLATE = "partials/section_metrics.html"
SORT_ORDER = 60


def _resolve_channel(canonical: str, channel_meta: dict) -> str | None:
    """Find the raw series key whose canonical channel name matches *canonical*.

    Checks: exact raw key match, case-insensitive raw key match,
    then falls back to matching the display name from the registry.
    """
    from TirePressure.channels import CHANNEL_SIGNATURES
    if canonical in channel_meta:
        return canonical
    canon_lower = canonical.lower()
    for raw_name in channel_meta:
        if raw_name.lower() == canon_lower:
            return raw_name
    sig = CHANNEL_SIGNATURES.get(canonical)
    if sig:
        target_display = sig.get("display", "").lower()
        for raw_name, meta in channel_meta.items():
            if meta.get("display", "").lower() == target_display:
                return raw_name
    return None


def _interpolate_value_at(
    target_x: float,
    x_array: list[float],
    y_array: list[float | None],
) -> float | None:
    """Linear interpolation in x_array -> y_array at target_x."""
    if not x_array or not y_array:
        return None
    n = len(x_array)
    if target_x <= x_array[0]:
        return y_array[0]
    if target_x >= x_array[-1]:
        return y_array[-1]
    idx = bisect.bisect_right(x_array, target_x) - 1
    idx = max(0, min(idx, n - 2))
    x0, x1 = x_array[idx], x_array[idx + 1]
    y0, y1 = y_array[idx], y_array[idx + 1]
    if y0 is None or y1 is None:
        return y0 if y0 is not None else y1
    dx = x1 - x0
    frac = (target_x - x0) / dx if dx > 0 else 0.0
    return y0 + frac * (y1 - y0)


def _slice_stats(
    times: list[float],
    distances: list[float],
    series: dict[str, list[float | None]],
    start_d: float,
    end_d: float,
    ch_keys: dict[str, str | None],
) -> dict[str, Any]:
    """Compute stats for a track section defined by distance range.

    *ch_keys* maps canonical names (speed, aps, ...) to actual series keys.
    """
    i_start = bisect.bisect_left(distances, start_d)
    i_end = bisect.bisect_right(distances, end_d)
    if i_end <= i_start or i_start >= len(times):
        return {}

    i_end = min(i_end, len(times))
    t_start = times[i_start]
    t_end = times[i_end - 1]
    duration = t_end - t_start
    if duration <= 0:
        return {}

    def _get(canonical: str) -> list:
        key = ch_keys.get(canonical)
        return series.get(key, []) if key else []

    speed = _get("speed")
    aps = _get("aps")
    pbrake_f = _get("pbrake_f")
    accx = _get("accx")
    accy = _get("accy")

    def _vals(arr, i0, i1):
        return [arr[i] for i in range(i0, min(i1, len(arr))) if i < len(arr) and arr[i] is not None]

    slice_speed = _vals(speed, i_start, i_end)
    entry_speed = _interpolate_value_at(start_d, distances, speed) if speed else None
    exit_speed = _interpolate_value_at(end_d, distances, speed) if speed else None
    min_speed = min(slice_speed) if slice_speed else None
    max_speed = max(slice_speed) if slice_speed else None

    slice_brake = _vals(pbrake_f, i_start, i_end)
    max_brake = max(slice_brake) if slice_brake else None

    slice_aps = _vals(aps, i_start, i_end)
    avg_throttle = sum(slice_aps) / len(slice_aps) if slice_aps else None

    slice_accx = _vals(accx, i_start, i_end)
    slice_accy = _vals(accy, i_start, i_end)
    peak_lon_g = max(abs(v) for v in slice_accx) if slice_accx else None
    peak_lat_g = max(abs(v) for v in slice_accy) if slice_accy else None

    return {
        "duration": round(duration, 3) if duration else None,
        "entry_speed": round(entry_speed, 1) if entry_speed is not None else None,
        "exit_speed": round(exit_speed, 1) if exit_speed is not None else None,
        "min_speed": round(min_speed, 1) if min_speed is not None else None,
        "max_speed": round(max_speed, 1) if max_speed is not None else None,
        "max_brake": round(max_brake, 2) if max_brake is not None else None,
        "avg_throttle": round(avg_throttle, 1) if avg_throttle is not None else None,
        "peak_lon_g": round(peak_lon_g, 2) if peak_lon_g is not None else None,
        "peak_lat_g": round(peak_lat_g, 2) if peak_lat_g is not None else None,
    }


def prepare_data(session_data: dict, options: dict | None = None) -> dict[str, Any]:
    """Build per-section per-lap metrics table."""
    options = options or {}
    # Prefer full-resolution data for accurate metrics; fall back to downsampled
    times = session_data.get("raw_times") or session_data.get("times") or []
    distances = session_data.get("raw_distances") or session_data.get("distances") or []
    series = session_data.get("raw_series") or session_data.get("series") or {}
    channel_meta = session_data.get("channel_meta") or {}
    lap_splits = session_data.get("lap_splits") or []
    lap_split_distances = session_data.get("lap_split_distances") or []
    summary = session_data.get("summary") or {}

    if not times or not distances or len(distances) != len(times):
        return {"has_data": False}

    # Resolve canonical channel names to actual series keys
    ch_keys: dict[str, str | None] = {}
    for canonical in ("speed", "aps", "pbrake_f", "accx", "accy"):
        ch_keys[canonical] = _resolve_channel(canonical, channel_meta)

    sections = options.get("sections") or []
    if not sections:
        try:
            from TirePressure.tools.section_generator import prepare_data as gen_data
            gen_result = gen_data(session_data, options)
            if gen_result.get("has_data"):
                sections = gen_result.get("sections", [])
        except Exception:
            pass

    if not sections:
        return {"has_data": False, "reason": "No sections defined. Generate sections first."}

    # Section boundaries are in GPS-haversine distance domain.
    # Compute the actual haversine total from the reference lap's lat/lon
    # so we can scale sections onto the speed-integrated distance domain.
    ref_lap = session_data.get("reference_lap") or {}
    gps_total = 0.0
    ref_lats = [v for v in (ref_lap.get("lat") or []) if v is not None]
    ref_lons = [v for v in (ref_lap.get("lon") or []) if v is not None]
    if ref_lats and ref_lons and len(ref_lats) == len(ref_lons) and len(ref_lats) >= 2:
        from TirePressure.tools.section_generator import _haversine_distance
        cum = 0.0
        gps_dists = [0.0]
        for i in range(1, len(ref_lats)):
            cum += _haversine_distance(ref_lats[i-1], ref_lons[i-1], ref_lats[i], ref_lons[i])
            gps_dists.append(cum)
        gps_total = gps_dists[-1] if gps_dists else 0.0
    if gps_total <= 0:
        sec_max = max((s.get("end_distance", 0) for s in sections), default=0)
        gps_total = sec_max if sec_max > 0 else 1.0

    # Determine the reference lap index: prefer the reference_lap object,
    # then the summary, then compute from lap splits — never use lap 0 (out-lap).
    ref_lap_idx = ref_lap.get("lap_index") if ref_lap else None
    if ref_lap_idx is None:
        ref_lap_idx = summary.get("fastest_lap_index")
    if ref_lap_idx is None or ref_lap_idx == 0:
        best_dt = None
        for i in range(len(lap_splits) - 1):
            if i == 0:
                continue
            dt = lap_splits[i + 1] - lap_splits[i]
            if dt > 0 and (best_dt is None or dt < best_dt):
                best_dt = dt
                ref_lap_idx = i
    if ref_lap_idx == 0:
        ref_lap_idx = 1 if len(lap_split_distances) > 2 else None
    n_laps = max(1, len(lap_split_distances) - 1) if lap_split_distances else 1

    lap_ranges: list[tuple[float, float]] = []
    if len(lap_split_distances) >= 2:
        for i in range(len(lap_split_distances) - 1):
            lap_ranges.append((lap_split_distances[i], lap_split_distances[i + 1]))
    else:
        lap_ranges.append((distances[0] if distances else 0.0, distances[-1] if distances else 0.0))

    section_names = [s["name"] for s in sections]
    metric_keys = ["duration", "entry_speed", "min_speed", "exit_speed", "max_speed",
                    "max_brake", "avg_throttle", "peak_lon_g", "peak_lat_g"]

    all_lap_metrics: list[list[dict]] = []
    for lap_i, (lap_d_start, lap_d_end) in enumerate(lap_ranges):
        lap_length = lap_d_end - lap_d_start
        scale = lap_length / gps_total if gps_total > 0 else 1.0

        lap_section_metrics = []
        for sec in sections:
            sec_start = lap_d_start + sec["start_distance"] * scale
            sec_end = lap_d_start + sec["end_distance"] * scale
            sec_end = min(sec_end, lap_d_end)
            stats = _slice_stats(times, distances, series, sec_start, sec_end, ch_keys)
            lap_section_metrics.append(stats)
        all_lap_metrics.append(lap_section_metrics)

    ref_metrics = all_lap_metrics[ref_lap_idx] if ref_lap_idx is not None and ref_lap_idx < len(all_lap_metrics) else None

    virtual_best: list[dict] = []
    for sec_i in range(len(sections)):
        best: dict[str, Any] = {}
        for key in metric_keys:
            values = []
            for lap_i, lap_metrics in enumerate(all_lap_metrics):
                if lap_i == 0:
                    continue
                if sec_i < len(lap_metrics):
                    v = lap_metrics[sec_i].get(key)
                    if v is not None:
                        values.append(v)
            if values:
                if key == "duration":
                    best[key] = min(values)
                else:
                    best[key] = max(values)
        virtual_best.append(best)

    # Per-lap totals (sum of section durations)
    lap_totals: list[dict[str, Any]] = []
    for lap_i, lap_metrics in enumerate(all_lap_metrics):
        durations = [m.get("duration") for m in lap_metrics if m.get("duration") is not None]
        total = round(sum(durations), 3) if durations else None
        lap_totals.append({"total_time": total, "section_count": len(durations)})

    # Virtual best total
    vb_durations = [vb.get("duration") for vb in virtual_best if vb.get("duration") is not None]
    virtual_best_total = round(sum(vb_durations), 3) if vb_durations else None

    # Fastest actual lap (excluding lap 0)
    fastest_actual_idx: int | None = None
    fastest_actual_time: float | None = None
    for lap_i, lt in enumerate(lap_totals):
        if lap_i == 0:
            continue
        t = lt.get("total_time")
        if t is not None and (fastest_actual_time is None or t < fastest_actual_time):
            fastest_actual_time = t
            fastest_actual_idx = lap_i

    # Per-section improvement potential: for each section, how much time the
    # fastest actual lap lost vs. the virtual best in that section
    improvement_sections: list[dict[str, Any]] = []
    for sec_i, sec in enumerate(sections):
        vb_dur = virtual_best[sec_i].get("duration") if sec_i < len(virtual_best) else None
        if vb_dur is None:
            continue

        # Collect per-lap deltas (skip lap 0)
        deltas: list[tuple[int, float]] = []
        for lap_i, lap_metrics in enumerate(all_lap_metrics):
            if lap_i == 0:
                continue
            if sec_i < len(lap_metrics):
                d = lap_metrics[sec_i].get("duration")
                if d is not None:
                    deltas.append((lap_i, round(d - vb_dur, 3)))

        if not deltas:
            continue

        avg_delta = round(sum(d for _, d in deltas) / len(deltas), 3)
        best_delta = min(deltas, key=lambda x: x[1])
        worst_delta = max(deltas, key=lambda x: x[1])

        # Fastest actual lap's delta in this section
        ref_delta = None
        if fastest_actual_idx is not None:
            fm = all_lap_metrics[fastest_actual_idx]
            if sec_i < len(fm):
                fd = fm[sec_i].get("duration")
                if fd is not None:
                    ref_delta = round(fd - vb_dur, 3)

        improvement_sections.append({
            "index": sec_i,
            "name": sec["name"],
            "vb_duration": vb_dur,
            "avg_delta": avg_delta,
            "best_lap": best_delta[0],
            "best_delta": best_delta[1],
            "worst_lap": worst_delta[0],
            "worst_delta": worst_delta[1],
            "fastest_lap_delta": ref_delta,
        })

    # Sort by average delta descending — biggest time losses first
    improvement_sections.sort(key=lambda x: x["avg_delta"], reverse=True)

    return {
        "has_data": True,
        "sections": sections,
        "section_names": section_names,
        "metric_keys": metric_keys,
        "lap_count": len(lap_ranges),
        "all_lap_metrics": all_lap_metrics,
        "ref_lap_index": ref_lap_idx,
        "ref_metrics": ref_metrics,
        "virtual_best": virtual_best,
        "lap_totals": lap_totals,
        "virtual_best_total": virtual_best_total,
        "fastest_actual_idx": fastest_actual_idx,
        "fastest_actual_time": fastest_actual_time,
        "improvement_sections": improvement_sections,
    }
