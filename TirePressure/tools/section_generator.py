"""
Analysis tool: Auto Section Generator.

Detects corners from curvature of the GPS trace and generates track sections.
Sections are persisted per track name so they apply to all sessions at that track.
"""

from __future__ import annotations

import math
import uuid
from typing import Any

TOOL_NAME = "section_generator"
DISPLAY_NAME = "Track Sections"
REQUIRED_CHANNELS = ["lat", "lon"]
OPTIONAL_CHANNELS = ["heading"]
TEMPLATE = "partials/section_editor.html"
SORT_ORDER = 50


def _haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance in meters between two lat/lon points."""
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _compute_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Bearing in degrees from point 1 to point 2."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dlam = math.radians(lon2 - lon1)
    x = math.sin(dlam) * math.cos(phi2)
    y = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlam)
    return math.degrees(math.atan2(x, y)) % 360


def _angular_diff(a: float, b: float) -> float:
    """Signed angular difference in degrees, range [-180, 180]."""
    d = (b - a) % 360
    if d > 180:
        d -= 360
    return d


def _smooth_array(values: list[float], window: int) -> list[float]:
    """Simple moving average."""
    n = len(values)
    out = []
    hw = window // 2
    for i in range(n):
        lo = max(0, i - hw)
        hi = min(n, i + hw + 1)
        out.append(sum(values[lo:hi]) / (hi - lo))
    return out


def compute_curvature_from_gps(
    lats: list[float], lons: list[float],
    heading: list[float] | None = None,
    smooth_window: int = 25,
) -> tuple[list[float], list[float]]:
    """
    Compute curvature (1/m) and cumulative distance from GPS trace.
    Returns (curvature, distances).  Expects a pre-smoothed GPS trace
    (see ``_smooth_gps_trace`` in processing.py).
    """
    n = len(lats)
    if n < 3:
        return [0.0] * n, [0.0] * n

    distances = [0.0]
    for i in range(1, n):
        d = _haversine_distance(lats[i - 1], lons[i - 1], lats[i], lons[i])
        distances.append(distances[-1] + d)

    if heading and len(heading) == n:
        bearings = [h if h is not None else 0.0 for h in heading]
    else:
        bearings = [0.0]
        for i in range(1, n):
            bearings.append(_compute_bearing(lats[i - 1], lons[i - 1], lats[i], lons[i]))

    curvature = [0.0]
    for i in range(1, n):
        ds = distances[i] - distances[i - 1]
        if ds > 0.2:
            dtheta = math.radians(abs(_angular_diff(bearings[i - 1], bearings[i])))
            curvature.append(dtheta / ds)
        else:
            curvature.append(curvature[-1] if curvature else 0.0)

    curvature = _smooth_array(curvature, smooth_window)
    return curvature, distances


def _adaptive_threshold(curvature: list[float]) -> float:
    """Pick a curvature threshold that separates corners from straights.

    Strategy: use the 40th percentile of non-trivial curvature values.  This
    sits between the straight-line noise floor and the real-corner peak,
    clamped to [0.008, 0.035] (125 m to ~29 m radius).
    """
    valid = sorted(c for c in curvature if c > 0.0001)
    if len(valid) < 20:
        return 0.02
    p40 = valid[int(len(valid) * 0.40)]
    return max(0.008, min(0.035, p40))


def detect_corners(
    curvature: list[float],
    distances: list[float],
    threshold: float | None = None,
    min_corner_length_m: float = 30.0,
    merge_gap_m: float = 50.0,
) -> list[dict[str, Any]]:
    """
    Detect corners from curvature array. Returns list of section dicts:
    {name, start_distance, end_distance, section_type}.
    """
    if threshold is None:
        threshold = _adaptive_threshold(curvature)
    n = len(curvature)
    in_corner = False
    corner_start = 0
    raw_corners: list[tuple[int, int]] = []

    for i in range(n):
        if curvature[i] > threshold:
            if not in_corner:
                corner_start = i
                in_corner = True
        else:
            if in_corner:
                raw_corners.append((corner_start, i - 1))
                in_corner = False
    if in_corner:
        raw_corners.append((corner_start, n - 1))

    corners = [
        (s, e) for s, e in raw_corners
        if (distances[e] - distances[s]) >= min_corner_length_m
    ]

    merged: list[tuple[int, int]] = []
    for s, e in corners:
        if merged and (distances[s] - distances[merged[-1][1]]) < merge_gap_m:
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))

    sections = []
    corner_num = 0
    prev_end_d = 0.0

    for i, (s, e) in enumerate(merged):
        start_d = distances[s]
        end_d = distances[e]

        if start_d - prev_end_d > min_corner_length_m:
            sections.append({
                "name": f"Straight {len(sections) + 1}",
                "start_distance": round(prev_end_d, 1),
                "end_distance": round(start_d, 1),
                "section_type": "auto",
            })

        corner_num += 1
        sections.append({
            "name": f"Corner {corner_num}",
            "start_distance": round(start_d, 1),
            "end_distance": round(end_d, 1),
            "section_type": "auto",
        })
        prev_end_d = end_d

    total_d = distances[-1] if distances else 0
    if total_d - prev_end_d > min_corner_length_m:
        sections.append({
            "name": f"Straight {len(sections) + 1}",
            "start_distance": round(prev_end_d, 1),
            "end_distance": round(total_d, 1),
            "section_type": "auto",
        })

    for i, sec in enumerate(sections):
        sec["sort_order"] = i
        sec["id"] = str(uuid.uuid4())

    return sections


def _adaptive_lat_g_threshold(lat_g: list[float]) -> float:
    """Pick a lateral-G threshold that separates cornering from straights.

    Uses the 30th percentile of |lat_g| values above a noise floor (0.05 G),
    clamped to [0.15, 0.5] G.
    """
    valid = sorted(abs(v) for v in lat_g if abs(v) > 0.05)
    if len(valid) < 20:
        return 0.25
    p30 = valid[int(len(valid) * 0.30)]
    return max(0.15, min(0.50, p30))


def _split_at_sign_changes(
    s: int, e: int, lat_g: list[float], distances: list[float],
    min_corner_length_m: float,
) -> list[tuple[int, int]]:
    """Split a single corner span at zero-crossings of signed lateral G.

    In an S-turn the car switches direction (lat G flips sign) without going
    straight.  Each sign-consistent segment becomes its own corner.
    Segments shorter than *min_corner_length_m* are merged into their neighbour.
    """
    if e <= s:
        return [(s, e)]

    # Smooth lat_g locally to avoid splitting on noise
    hw = max(1, min(5, (e - s) // 10))
    def _local_avg(idx: int) -> float:
        lo = max(s, idx - hw)
        hi = min(e + 1, idx + hw + 1)
        return sum(lat_g[lo:hi]) / (hi - lo)

    # Find zero-crossing indices within [s, e]
    splits: list[int] = [s]
    prev_sign = 1 if _local_avg(s) >= 0 else -1
    for i in range(s + 1, e + 1):
        cur_sign = 1 if _local_avg(i) >= 0 else -1
        if cur_sign != prev_sign:
            splits.append(i)
            prev_sign = cur_sign
    splits.append(e + 1)

    parts: list[tuple[int, int]] = []
    for k in range(len(splits) - 1):
        ps, pe = splits[k], splits[k + 1] - 1
        if ps <= pe:
            parts.append((ps, pe))

    # Drop very short segments — merge them into the prior part
    merged: list[tuple[int, int]] = []
    for ps, pe in parts:
        seg_len = distances[min(pe, len(distances) - 1)] - distances[min(ps, len(distances) - 1)]
        if seg_len < min_corner_length_m and merged:
            merged[-1] = (merged[-1][0], pe)
        else:
            merged.append((ps, pe))

    return merged if merged else [(s, e)]


def detect_corners_from_lateral_g(
    lat_g: list[float],
    distances: list[float],
    threshold: float | None = None,
    min_corner_length_m: float = 30.0,
    merge_gap_m: float = 50.0,
) -> list[dict[str, Any]]:
    """Detect corners using lateral acceleration magnitude.

    Thresholds on |lat_g|, then splits merged corners at zero-crossings
    of the signed lateral G to separate S-turns into distinct corners.
    Returns section dicts ready for the editor.
    """
    if threshold is None:
        threshold = _adaptive_lat_g_threshold(lat_g)

    n = len(lat_g)
    nd = len(distances)
    in_corner = False
    corner_start = 0
    raw_corners: list[tuple[int, int]] = []

    for i in range(n):
        if abs(lat_g[i]) > threshold:
            if not in_corner:
                corner_start = i
                in_corner = True
        else:
            if in_corner:
                raw_corners.append((corner_start, i - 1))
                in_corner = False
    if in_corner:
        raw_corners.append((corner_start, n - 1))

    # Split at sign changes (S-turns) then filter by min length
    split_corners: list[tuple[int, int]] = []
    for s, e in raw_corners:
        for ps, pe in _split_at_sign_changes(s, e, lat_g, distances, min_corner_length_m):
            seg_len = distances[min(pe, nd - 1)] - distances[min(ps, nd - 1)]
            if seg_len >= min_corner_length_m:
                split_corners.append((ps, pe))

    # Merge nearby corners that share the same predominant sign
    def _predominant_sign(s: int, e: int) -> int:
        total = sum(lat_g[i] for i in range(s, min(e + 1, n)))
        return 1 if total >= 0 else -1

    merged: list[tuple[int, int]] = []
    for s, e in split_corners:
        if merged:
            prev_e_d = distances[min(merged[-1][1], nd - 1)]
            cur_s_d = distances[min(s, nd - 1)]
            gap = cur_s_d - prev_e_d
            same_dir = _predominant_sign(merged[-1][0], merged[-1][1]) == _predominant_sign(s, e)
            if gap < merge_gap_m and same_dir:
                merged[-1] = (merged[-1][0], e)
            else:
                merged.append((s, e))
        else:
            merged.append((s, e))

    # Build sections with straights between corners
    sections: list[dict[str, Any]] = []
    corner_num = 0
    prev_end_d = 0.0

    for s, e in merged:
        start_d = distances[min(s, nd - 1)]
        end_d = distances[min(e, nd - 1)]

        if start_d - prev_end_d > min_corner_length_m:
            sections.append({
                "name": f"Straight {len(sections) + 1}",
                "start_distance": round(prev_end_d, 1),
                "end_distance": round(start_d, 1),
                "section_type": "auto",
            })

        corner_num += 1
        sections.append({
            "name": f"Corner {corner_num}",
            "start_distance": round(start_d, 1),
            "end_distance": round(end_d, 1),
            "section_type": "auto",
        })
        prev_end_d = end_d

    total_d = distances[-1] if distances else 0
    if total_d - prev_end_d > min_corner_length_m:
        sections.append({
            "name": f"Straight {len(sections) + 1}",
            "start_distance": round(prev_end_d, 1),
            "end_distance": round(total_d, 1),
            "section_type": "auto",
        })

    for i, sec in enumerate(sections):
        sec["sort_order"] = i
        sec["id"] = str(uuid.uuid4())

    return sections


def _resample_to_distance(
    src_d: list[float], src_v: list[float | None], tgt_d: list[float],
) -> list[float]:
    """Linearly interpolate src_v(src_d) onto tgt_d, returning floats (None→0)."""
    out: list[float] = []
    j = 0
    n = len(src_d)
    for td in tgt_d:
        while j < n - 1 and src_d[j + 1] < td:
            j += 1
        if j >= n - 1:
            val = src_v[-1] if src_v else None
        elif src_d[j + 1] == src_d[j]:
            val = src_v[j]
        else:
            f = (td - src_d[j]) / (src_d[j + 1] - src_d[j])
            v0, v1 = src_v[j], src_v[j + 1]
            if v0 is None or v1 is None:
                val = v0 if v0 is not None else v1
            else:
                val = v0 + f * (v1 - v0)
        out.append(float(val) if val is not None else 0.0)
    return out


def prepare_data(session_data: dict, options: dict | None = None) -> dict[str, Any]:
    """Build section data for the template.

    If saved sections exist (passed via ``options["saved_sections"]`` or
    looked up by track name), those are used instead of auto-detecting.
    """
    ref = session_data.get("reference_lap")
    if not ref or not ref.get("lat") or not ref.get("lon"):
        return {"has_data": False}

    lats = [v for v in ref["lat"] if v is not None]
    lons = [v for v in ref["lon"] if v is not None]
    if len(lats) < 10:
        return {"has_data": False}

    heading = ref.get("heading") or None
    curvature, distances = compute_curvature_from_gps(lats, lons, heading)

    options = options or {}
    saved = options.get("saved_sections")

    # Read section-detection thresholds from options (populated from preferences)
    lat_g_thresh = options.get("section_lat_g_threshold")  # None = adaptive
    min_corner_m = float(options.get("section_min_corner_length_m", 30))
    merge_gap_m = float(options.get("section_merge_gap_m", 50))

    if saved:
        sections = []
        for i, s in enumerate(saved):
            sec: dict[str, Any] = {
                "id": s.get("id") or str(uuid.uuid4()),
                "name": s.get("name", ""),
                "start_distance": float(s.get("start_distance", 0)),
                "end_distance": float(s.get("end_distance", 0)),
                "section_type": s.get("section_type", "manual"),
                "sort_order": s.get("sort_order", i),
            }
            cg = s.get("corner_group") or s.get("cornerGroup")
            if cg is not None:
                sec["cornerGroup"] = int(cg)
            sections.append(sec)
    else:
        # Try lateral-G-based detection first (higher fidelity than GPS curvature)
        used_lat_g = False
        lat_g_resampled: list[float] | None = None

        raw_series = session_data.get("raw_series") or session_data.get("series") or {}
        raw_distances = session_data.get("raw_distances") or session_data.get("distances") or []
        channel_meta = session_data.get("channel_meta") or options.get("channel_meta") or {}

        from TirePressure.channels import CHANNEL_SIGNATURES
        accy_key: str | None = None
        for raw_name in raw_series:
            if raw_name.lower() == "accy":
                accy_key = raw_name
                break
        if accy_key is None:
            for raw_name, meta in channel_meta.items():
                if meta.get("display", "").lower() == "lateral accel":
                    accy_key = raw_name
                    break
        if accy_key is None:
            sig = CHANNEL_SIGNATURES.get("accy", {})
            target = sig.get("display", "").lower()
            if target:
                for raw_name, meta in channel_meta.items():
                    if meta.get("display", "").lower() == target:
                        accy_key = raw_name
                        break

        if accy_key and accy_key in raw_series and raw_distances:
            accy_vals = raw_series[accy_key]
            # Need the distance slice for the reference lap
            lap_splits = session_data.get("lap_splits") or []
            ref_idx = ref.get("lap_index", 0)
            if lap_splits and ref_idx < len(lap_splits) - 1:
                import bisect as _bisect
                raw_times = session_data.get("raw_times") or session_data.get("times") or []
                t_start = lap_splits[ref_idx]
                t_end = lap_splits[ref_idx + 1]
                si = _bisect.bisect_left(raw_times, t_start)
                ei = _bisect.bisect_right(raw_times, t_end)
                lap_accy = accy_vals[si:ei]
                lap_dists = raw_distances[si:ei]
                if lap_dists:
                    d0 = lap_dists[0]
                    lap_dists_rel = [d - d0 for d in lap_dists]
                else:
                    lap_dists_rel = []
                # Resample onto GPS distance domain
                if lap_dists_rel and len(lap_accy) == len(lap_dists_rel) and distances:
                    lat_g_resampled = _resample_to_distance(lap_dists_rel, lap_accy, distances)
                    non_zero = sum(1 for v in lat_g_resampled if abs(v) > 0.02)
                    if non_zero > len(lat_g_resampled) * 0.1:
                        thresh = float(lat_g_thresh) if lat_g_thresh is not None else None
                        sections = detect_corners_from_lateral_g(
                            lat_g_resampled, distances,
                            threshold=thresh,
                            min_corner_length_m=min_corner_m,
                            merge_gap_m=merge_gap_m,
                        )
                        used_lat_g = True

        if not used_lat_g:
            sections = detect_corners(
                curvature, distances,
                min_corner_length_m=min_corner_m,
                merge_gap_m=merge_gap_m,
            )

    polyline = [[lat, lon] for lat, lon in zip(lats, lons)]

    return {
        "has_data": True,
        "sections": sections,
        "polyline": polyline,
        "distances": distances,
        "curvature": curvature,
        "lap_index": ref.get("lap_index"),
        "lap_time": ref.get("lap_time"),
        "track_name": session_data.get("summary", {}).get("track_name", ""),
    }
