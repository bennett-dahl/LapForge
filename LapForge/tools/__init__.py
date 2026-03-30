"""
Analysis tool auto-discovery and registry.

Each module in this package exposes a standard interface:
    TOOL_NAME, DISPLAY_NAME, REQUIRED_CHANNELS, OPTIONAL_CHANNELS,
    TEMPLATE, SORT_ORDER, prepare_data(session_data, options).

Import this package to get the ``TOOL_REGISTRY`` list (sorted by SORT_ORDER)
and ``get_available_tools(channel_list)`` helper.
"""

from __future__ import annotations

import importlib
import pkgutil
from pathlib import Path
from typing import Any, Callable

from LapForge.channels import detect_channels, resolve_channel_metadata

_TOOL_FIELDS = {
    "TOOL_NAME": str,
    "DISPLAY_NAME": str,
    "REQUIRED_CHANNELS": list,
    "TEMPLATE": str,
}

TOOL_REGISTRY: list[dict[str, Any]] = []


def _discover_tools() -> None:
    """Import every sibling module that has the required tool attributes."""
    package_dir = Path(__file__).resolve().parent
    for finder, name, is_pkg in pkgutil.iter_modules([str(package_dir)]):
        if name.startswith("_"):
            continue
        module = importlib.import_module(f".{name}", package=__package__)
        if not all(hasattr(module, f) for f in _TOOL_FIELDS):
            continue
        entry: dict[str, Any] = {
            "tool_name": module.TOOL_NAME,
            "display_name": module.DISPLAY_NAME,
            "required_channels": list(module.REQUIRED_CHANNELS),
            "optional_channels": list(getattr(module, "OPTIONAL_CHANNELS", [])),
            "template": module.TEMPLATE,
            "sort_order": int(getattr(module, "SORT_ORDER", 100)),
            "prepare_data": getattr(module, "prepare_data", None),
            "module": module,
        }
        TOOL_REGISTRY.append(entry)
    TOOL_REGISTRY.sort(key=lambda t: t["sort_order"])


def get_available_tools(
    channel_list: list[str],
    channel_meta: dict[str, dict[str, str]] | None = None,
) -> list[dict[str, Any]]:
    """Return tools whose required channels are all present, plus availability flag.

    Resolves required channels in two passes:
    1. Direct name match (case-insensitive).
    2. Canonical match: if the required channel name has a known display name in the
       registry (e.g. ``"lat"`` -> ``"Latitude"``), check whether *any* session
       channel resolves to the same (category, display) pair.  This handles data
       sources that use different column names for the same concept (e.g.
       ``NMEA_Lat`` for latitude).
    """
    if channel_meta is None:
        channel_meta = detect_channels(channel_list)

    ch_set = {c.lower() for c in channel_list}

    session_purposes: set[tuple[str, str]] = set()
    for meta in channel_meta.values():
        session_purposes.add((meta["category"], meta["display"]))

    result = []
    for tool in TOOL_REGISTRY:
        available = True
        for req in tool["required_channels"]:
            req_lower = req.lower()
            if req_lower in ch_set:
                continue
            req_meta = resolve_channel_metadata(req)
            if req_meta and (req_meta["category"], req_meta["display"]) in session_purposes:
                continue
            available = False
            break
        result.append({**tool, "available": available})
    return result


_discover_tools()
