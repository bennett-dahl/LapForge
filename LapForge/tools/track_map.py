"""
Analysis tool: Track Map.

Renders a Leaflet map from the fastest-lap GPS polyline. Cursor-linked
with charts via CursorSync.
"""

from __future__ import annotations

from typing import Any

TOOL_NAME = "track_map"
DISPLAY_NAME = "Track Map"
REQUIRED_CHANNELS = ["lat", "lon"]
OPTIONAL_CHANNELS = ["heading", "alt"]
TEMPLATE = "partials/track_map.html"
SORT_ORDER = 20


def prepare_data(session_data: dict, options: dict | None = None) -> dict[str, Any]:
    """Build polyline and metadata for the Leaflet map."""
    ref = session_data.get("reference_lap")
    if not ref or not ref.get("lat") or not ref.get("lon"):
        return {"has_data": False}

    lats = ref["lat"]
    lons = ref["lon"]
    polyline = [
        [lat, lon]
        for lat, lon in zip(lats, lons)
        if lat is not None and lon is not None
    ]

    if len(polyline) < 2:
        return {"has_data": False}

    return {
        "has_data": True,
        "polyline": polyline,
        "heading": ref.get("heading") or [],
        "distances": ref.get("distance") or [],
        "lap_time": ref.get("lap_time"),
        "lap_index": ref.get("lap_index"),
    }
