"""
Analysis tool: Tire Pressure chart and summary.

Always available — every Pi Toolbox export has TPMS pressure channels.
Falls back gracefully if specific corners are missing.
"""

from __future__ import annotations

from typing import Any

TOOL_NAME = "tire_pressure"
DISPLAY_NAME = "Tire Pressure"
REQUIRED_CHANNELS: list[str] = []  # always available
OPTIONAL_CHANNELS = [
    "tpms_press_fl", "tpms_press_fr", "tpms_press_rl", "tpms_press_rr",
    "tpms_temp_fl", "tpms_temp_fr", "tpms_temp_rl", "tpms_temp_rr",
]
TEMPLATE = "partials/tire_pressure.html"
SORT_ORDER = 10

BAR_TO_PSI = 14.5038
DEFAULT_CHART_Y_MIN_PSI = 15.0
DEFAULT_CHART_Y_MAX_PSI = 32.0

PRESSURE_KEYS = ["tpms_press_fl", "tpms_press_fr", "tpms_press_rl", "tpms_press_rr"]
PRESSURE_COLORS = {
    "tpms_press_fl": "#3b82f6",
    "tpms_press_fr": "#22c55e",
    "tpms_press_rl": "#eab308",
    "tpms_press_rr": "#ef4444",
}
PRESSURE_LABELS = {
    "tpms_press_fl": "FL",
    "tpms_press_fr": "FR",
    "tpms_press_rl": "RL",
    "tpms_press_rr": "RR",
}


def prepare_data(session_data: dict, options: dict | None = None) -> dict[str, Any]:
    """Build the data dict consumed by partials/tire_pressure.html."""
    options = options or {}
    use_psi = options.get("use_psi", True)
    target_psi = float(options.get("target_psi", 27.0))

    series_raw = session_data.get("series") or {}
    times = session_data.get("times") or []
    lap_splits = session_data.get("lap_splits") or []
    summary = session_data.get("summary") or {}

    pressure_summary = (
        summary.get("pressure_summary_psi") if use_psi
        else summary.get("pressure_summary_bar")
    ) or {}

    present_keys = [k for k in PRESSURE_KEYS if k in series_raw]
    if not present_keys:
        return {"has_data": False}

    multiplier = BAR_TO_PSI if use_psi else 1.0
    unit = "psi" if use_psi else "bar"

    series: dict[str, list[float | None]] = {}
    for k in present_keys:
        raw = series_raw[k]
        series[k] = [
            round(v * multiplier, 4) if v is not None else None
            for v in raw
        ]

    target = target_psi if use_psi else round(target_psi / BAR_TO_PSI, 4)

    if use_psi:
        y_min, y_max = DEFAULT_CHART_Y_MIN_PSI, DEFAULT_CHART_Y_MAX_PSI
    else:
        y_min = round(DEFAULT_CHART_Y_MIN_PSI / BAR_TO_PSI, 4)
        y_max = round(DEFAULT_CHART_Y_MAX_PSI / BAR_TO_PSI, 4)

    channels = []
    for k in present_keys:
        channels.append({
            "name": k,
            "label": PRESSURE_LABELS.get(k, k.upper()),
            "values": series[k],
            "color": PRESSURE_COLORS.get(k, "#888"),
            "unit": unit,
        })

    return {
        "has_data": True,
        "channels": channels,
        "times": times,
        "lap_splits": lap_splits,
        "target": target,
        "unit": unit,
        "y_min": y_min,
        "y_max": y_max,
        "pressure_summary": pressure_summary,
    }
