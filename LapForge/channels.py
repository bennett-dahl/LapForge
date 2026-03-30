"""
Registry of known telemetry channels from Pi Toolbox text exports.

Maps canonical (and common alias) column names to display metadata: category, unit,
human-oriented display label, and chart color. Use :func:`detect_channels` to attach
metadata to whatever column names appear in a parsed file, and
:func:`categorize_channels` to group columns for UI or plotting.
"""

from __future__ import annotations

# Corner colors aligned with LapForge UI (compare/session charts).
_CORNER_FL = "#3b82f6"
_CORNER_FR = "#22c55e"
_CORNER_RL = "#eab308"
_CORNER_RR = "#ef4444"

# Default palette for logical channels without a per-corner mapping.
_PALETTE = {
    "violet": "#8b5cf6",
    "cyan": "#06b6d4",
    "orange": "#f97316",
    "pink": "#ec4899",
    "teal": "#14b8a6",
    "indigo": "#6366f1",
    "rose": "#f43f5e",
    "sky": "#0ea5e9",
    "amber": "#f59e0b",
    "slate": "#64748b",
    "emerald": "#10b981",
    "fuchsia": "#d946ef",
}

CHANNEL_SIGNATURES: dict[str, dict[str, str]] = {
    # --- Pressure (bar) ---
    "tpms_press_fl": {
        "category": "pressure",
        "unit": "bar",
        "display": "TPMS pressure FL",
        "color": _CORNER_FL,
    },
    "tpms_press_fr": {
        "category": "pressure",
        "unit": "bar",
        "display": "TPMS pressure FR",
        "color": _CORNER_FR,
    },
    "tpms_press_rl": {
        "category": "pressure",
        "unit": "bar",
        "display": "TPMS pressure RL",
        "color": _CORNER_RL,
    },
    "tpms_press_rr": {
        "category": "pressure",
        "unit": "bar",
        "display": "TPMS pressure RR",
        "color": _CORNER_RR,
    },
    # --- Pressure (PSI variant) ---
    "tpms_press_fl_psi": {
        "category": "pressure",
        "unit": "psi",
        "display": "TPMS pressure FL",
        "color": _CORNER_FL,
    },
    "tpms_press_fr_psi": {
        "category": "pressure",
        "unit": "psi",
        "display": "TPMS pressure FR",
        "color": _CORNER_FR,
    },
    "tpms_press_rl_psi": {
        "category": "pressure",
        "unit": "psi",
        "display": "TPMS pressure RL",
        "color": _CORNER_RL,
    },
    "tpms_press_rr_psi": {
        "category": "pressure",
        "unit": "psi",
        "display": "TPMS pressure RR",
        "color": _CORNER_RR,
    },
    # --- TPMS temperatures (°C), same corner colors as pressure ---
    "tpms_temp_fl": {
        "category": "pressure",
        "unit": "°C",
        "display": "TPMS temp FL",
        "color": _CORNER_FL,
    },
    "tpms_temp_fr": {
        "category": "pressure",
        "unit": "°C",
        "display": "TPMS temp FR",
        "color": _CORNER_FR,
    },
    "tpms_temp_rl": {
        "category": "pressure",
        "unit": "°C",
        "display": "TPMS temp RL",
        "color": _CORNER_RL,
    },
    "tpms_temp_rr": {
        "category": "pressure",
        "unit": "°C",
        "display": "TPMS temp RR",
        "color": _CORNER_RR,
    },
    # --- Driver / vehicle ---
    "speed": {
        "category": "driver",
        "unit": "km/h",
        "display": "Speed",
        "color": _PALETTE["sky"],
    },
    "aps": {
        "category": "driver",
        "unit": "%",
        "display": "Throttle (APS)",
        "color": _PALETTE["emerald"],
    },
    "pbrake_f": {
        "category": "driver",
        "unit": "bar",
        "display": "Brake pressure front",
        "color": _PALETTE["rose"],
    },
    "pbrake_r": {
        "category": "driver",
        "unit": "bar",
        "display": "Brake pressure rear",
        "color": _PALETTE["orange"],
    },
    "gear": {
        "category": "driver",
        "unit": "",
        "display": "Gear",
        "color": _PALETTE["slate"],
    },
    "nmot": {
        "category": "driver",
        "unit": "rpm",
        "display": "Engine speed",
        "color": _PALETTE["violet"],
    },
    "speed_fl": {
        "category": "driver",
        "unit": "km/h",
        "display": "Wheel speed FL",
        "color": _CORNER_FL,
    },
    "speed_fr": {
        "category": "driver",
        "unit": "km/h",
        "display": "Wheel speed FR",
        "color": _CORNER_FR,
    },
    "speed_rl": {
        "category": "driver",
        "unit": "km/h",
        "display": "Wheel speed RL",
        "color": _CORNER_RL,
    },
    "speed_rr": {
        "category": "driver",
        "unit": "km/h",
        "display": "Wheel speed RR",
        "color": _CORNER_RR,
    },
    "brake_balance": {
        "category": "driver",
        "unit": "%",
        "display": "Brake balance",
        "color": _PALETTE["amber"],
    },
    "asteer": {
        "category": "driver",
        "unit": "deg",
        "display": "Steering angle",
        "color": _PALETTE["teal"],
    },
    # --- Acceleration / yaw ---
    "accx": {
        "category": "accel",
        "unit": "G",
        "display": "Longitudinal accel",
        "color": _PALETTE["rose"],
    },
    "accy": {
        "category": "accel",
        "unit": "G",
        "display": "Lateral accel",
        "color": _PALETTE["cyan"],
    },
    "accz": {
        "category": "accel",
        "unit": "G",
        "display": "Vertical accel",
        "color": _PALETTE["violet"],
    },
    "accz absolute": {
        "category": "accel",
        "unit": "G",
        "display": "Vertical accel (abs)",
        "color": _PALETTE["violet"],
    },
    "yaw": {
        "category": "accel",
        "unit": "deg/s",
        "display": "Yaw rate",
        "color": _PALETTE["fuchsia"],
    },
    # --- GPS (degrees / m); multiple aliases for Pi / export naming ---
    "lat": {
        "category": "gps",
        "unit": "deg",
        "display": "Latitude",
        "color": _PALETTE["emerald"],
    },
    "latitude": {
        "category": "gps",
        "unit": "deg",
        "display": "Latitude",
        "color": _PALETTE["emerald"],
    },
    "gps_lat": {
        "category": "gps",
        "unit": "deg",
        "display": "Latitude",
        "color": _PALETTE["emerald"],
    },
    "gps_latitude": {
        "category": "gps",
        "unit": "deg",
        "display": "Latitude",
        "color": _PALETTE["emerald"],
    },
    "nmea_lat": {
        "category": "gps",
        "unit": "deg",
        "display": "Latitude",
        "color": _PALETTE["emerald"],
    },
    "nmea_latitude": {
        "category": "gps",
        "unit": "deg",
        "display": "Latitude",
        "color": _PALETTE["emerald"],
    },
    "lon": {
        "category": "gps",
        "unit": "deg",
        "display": "Longitude",
        "color": _PALETTE["cyan"],
    },
    "long": {
        "category": "gps",
        "unit": "deg",
        "display": "Longitude",
        "color": _PALETTE["cyan"],
    },
    "longitude": {
        "category": "gps",
        "unit": "deg",
        "display": "Longitude",
        "color": _PALETTE["cyan"],
    },
    "lng": {
        "category": "gps",
        "unit": "deg",
        "display": "Longitude",
        "color": _PALETTE["cyan"],
    },
    "gps_lon": {
        "category": "gps",
        "unit": "deg",
        "display": "Longitude",
        "color": _PALETTE["cyan"],
    },
    "gps_long": {
        "category": "gps",
        "unit": "deg",
        "display": "Longitude",
        "color": _PALETTE["cyan"],
    },
    "gps_longitude": {
        "category": "gps",
        "unit": "deg",
        "display": "Longitude",
        "color": _PALETTE["cyan"],
    },
    "nmea_long": {
        "category": "gps",
        "unit": "deg",
        "display": "Longitude",
        "color": _PALETTE["cyan"],
    },
    "nmea_lon": {
        "category": "gps",
        "unit": "deg",
        "display": "Longitude",
        "color": _PALETTE["cyan"],
    },
    "nmea_longitude": {
        "category": "gps",
        "unit": "deg",
        "display": "Longitude",
        "color": _PALETTE["cyan"],
    },
    "heading": {
        "category": "gps",
        "unit": "deg",
        "display": "Heading",
        "color": _PALETTE["orange"],
    },
    "gps_heading": {
        "category": "gps",
        "unit": "deg",
        "display": "Heading",
        "color": _PALETTE["orange"],
    },
    "course": {
        "category": "gps",
        "unit": "deg",
        "display": "Heading",
        "color": _PALETTE["orange"],
    },
    "bearing": {
        "category": "gps",
        "unit": "deg",
        "display": "Heading",
        "color": _PALETTE["orange"],
    },
    "alt": {
        "category": "gps",
        "unit": "m",
        "display": "Altitude",
        "color": _PALETTE["sky"],
    },
    "altitude": {
        "category": "gps",
        "unit": "m",
        "display": "Altitude",
        "color": _PALETTE["sky"],
    },
    "gps_alt": {
        "category": "gps",
        "unit": "m",
        "display": "Altitude",
        "color": _PALETTE["sky"],
    },
    "gps_altitude": {
        "category": "gps",
        "unit": "m",
        "display": "Altitude",
        "color": _PALETTE["sky"],
    },
    "elevation": {
        "category": "gps",
        "unit": "m",
        "display": "Altitude",
        "color": _PALETTE["sky"],
    },
    # --- Timing ---
    "time": {
        "category": "timing",
        "unit": "s",
        "display": "Time",
        "color": _PALETTE["indigo"],
    },
    "laptime": {
        "category": "timing",
        "unit": "s",
        "display": "Lap time",
        "color": _PALETTE["pink"],
    },
    "lap_index": {
        "category": "timing",
        "unit": "",
        "display": "Lap index",
        "color": _PALETTE["slate"],
    },
    "time_diff": {
        "category": "timing",
        "unit": "s",
        "display": "Time delta",
        "color": _PALETTE["amber"],
    },
    "time_diff_rate": {
        "category": "timing",
        "unit": "s/s",
        "display": "Time delta rate",
        "color": _PALETTE["amber"],
    },
    # --- Derived / track geometry ---
    "log_distance": {
        "category": "derived",
        "unit": "m",
        "display": "Logged distance",
        "color": _PALETTE["slate"],
    },
    "distance_along_lap": {
        "category": "derived",
        "unit": "m",
        "display": "Distance along lap",
        "color": _PALETTE["teal"],
    },
    "curvature": {
        "category": "derived",
        "unit": "1/m",
        "display": "Curvature",
        "color": _PALETTE["violet"],
    },
    "corner_radius": {
        "category": "derived",
        "unit": "m",
        "display": "Corner radius",
        "color": _PALETTE["fuchsia"],
    },
    "corner_radius_filtered": {
        "category": "derived",
        "unit": "m",
        "display": "Corner radius (filtered)",
        "color": _PALETTE["rose"],
    },
}

# Case-insensitive lookup: normalized name -> metadata (shared object from CHANNEL_SIGNATURES).
_LOWER_INDEX: dict[str, dict[str, str]] = {}
for _sig_name, _meta in CHANNEL_SIGNATURES.items():
    _k = _sig_name.lower()
    if _k not in _LOWER_INDEX:
        _LOWER_INDEX[_k] = _meta

# Rotating colors for columns with no signature match.
_UNKNOWN_COLORS: list[str] = [
    "#6366f1",
    "#ec4899",
    "#14b8a6",
    "#f59e0b",
    "#8b5cf6",
    "#10b981",
    "#f43f5e",
    "#0ea5e9",
    "#d946ef",
    "#64748b",
    "#22d3ee",
    "#fb7185",
    "#a3e635",
    "#c084fc",
    "#2dd4bf",
]


def resolve_channel_metadata(column_name: str) -> dict[str, str] | None:
    """Look up registry metadata for a column name (exact, then case-insensitive)."""
    if column_name in CHANNEL_SIGNATURES:
        return CHANNEL_SIGNATURES[column_name]
    key = column_name.lower()
    return _LOWER_INDEX.get(key)


# Keep the old private name for internal use
_resolve_metadata = resolve_channel_metadata


def detect_channels(parsed_columns: list[str]) -> dict[str, dict[str, str]]:
    """
    Build a metadata dict for each parsed column name.

    Matching order per column:

    1. Exact match against :data:`CHANNEL_SIGNATURES` keys.
    2. Else case-insensitive match (normalized to lowercase).

    Unknown names get ``category="unknown"``, empty ``unit``, ``display`` equal to the
    original column string, and a distinct ``color`` from a fixed rotation.

    Returns:
        Mapping **original column name** -> metadata dict with keys
        ``category``, ``unit``, ``display``, ``color``.
    """
    out: dict[str, dict[str, str]] = {}
    unknown_i = 0
    for col in parsed_columns:
        meta = _resolve_metadata(col)
        if meta is not None:
            out[col] = {
                "category": meta["category"],
                "unit": meta["unit"],
                "display": meta["display"],
                "color": meta["color"],
            }
        else:
            color = _UNKNOWN_COLORS[unknown_i % len(_UNKNOWN_COLORS)]
            unknown_i += 1
            out[col] = {
                "category": "unknown",
                "unit": "",
                "display": col,
                "color": color,
            }
    return out


def categorize_channels(channel_meta: dict[str, dict[str, str]]) -> dict[str, list[str]]:
    """
    Group channel (column) names by their ``category`` field.

    Args:
        channel_meta: Output of :func:`detect_channels` or any dict with the same shape.

    Returns:
        Mapping category -> list of column names. Lists preserve first-seen order of
        keys in ``channel_meta`` (insertion order, Python 3.7+).
    """
    groups: dict[str, list[str]] = {}
    for name, meta in channel_meta.items():
        cat = meta.get("category", "unknown")
        groups.setdefault(cat, []).append(name)
    return groups
