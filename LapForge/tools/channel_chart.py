"""
Analysis tool: Multi-channel telemetry chart.

Always available. Lets the user pick which channels to overlay on a
distance- or time-indexed chart.
"""

from __future__ import annotations

from typing import Any

TOOL_NAME = "channel_chart"
DISPLAY_NAME = "Channel Charts"
REQUIRED_CHANNELS: list[str] = []  # always available
OPTIONAL_CHANNELS: list[str] = []  # uses whatever is present
TEMPLATE = "partials/channel_chart.html"
SORT_ORDER = 30


CATEGORY_PRESETS: dict[str, list[str]] = {
    "driver": ["speed", "aps", "pbrake_f", "gear"],
    "accel": ["accx", "accy", "yaw"],
}


def prepare_data(session_data: dict, options: dict | None = None) -> dict[str, Any]:
    """Build channel list grouped by category for the selector UI."""
    options = options or {}
    channel_meta = session_data.get("channel_meta") or {}
    series = session_data.get("series") or {}
    times = session_data.get("times") or []
    distances = session_data.get("distances") or []
    lap_splits = session_data.get("lap_splits") or []

    skip_categories = {"timing", "gps"}
    available_channels = []
    for name, meta in channel_meta.items():
        if meta.get("category") in skip_categories:
            continue
        if name not in series:
            continue
        available_channels.append({
            "name": name,
            "display": meta.get("display", name),
            "category": meta.get("category", "unknown"),
            "unit": meta.get("unit", ""),
            "color": meta.get("color", "#888"),
        })

    selected = options.get("selected_channels")
    if not selected:
        selected = CATEGORY_PRESETS.get("driver", [])
        selected = [c for c in selected if c in series]

    channels_data = []
    for name in selected:
        if name not in series:
            continue
        meta = channel_meta.get(name, {})
        channels_data.append({
            "name": name,
            "label": meta.get("display", name),
            "values": series[name],
            "color": meta.get("color", "#888"),
            "unit": meta.get("unit", ""),
        })

    return {
        "has_data": bool(channels_data),
        "available_channels": available_channels,
        "selected_channels": selected,
        "channels_data": channels_data,
        "times": times,
        "distances": distances,
        "lap_splits": lap_splits,
        "has_distance": bool(distances) and len(distances) == len(times),
    }
