#!/usr/bin/env python3
"""
Pi Toolbox Versioned ASCII export parser.

Parses vehicle dynamics export files (e.g. 992 Cup TPMS data) from Pi Toolbox:
- Detects PiToolboxVersionedASCIIDataSet format
- Parses {OutingInformation} metadata
- Parses {ChannelBlock} tab-separated data with canonical column names
- Lap detection from laptime resets
- TPMS pressure: bar columns stored as bar; `[psi]` headers keep bar storage + *_psi (avoids double conversion)
"""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any


BAR_TO_PSI = 14.5038
DEFAULT_LAP_RESET_THRESHOLD_S = 5.0


def _canonical_name(raw: str) -> str:
    """Strip leading * and trailing [unit] for canonical column name."""
    s = raw.strip()
    if s.startswith("*"):
        s = s[1:]
    bracket = s.find("[")
    if bracket >= 0:
        s = s[:bracket].strip()
    return s


def _bracket_unit_token(raw_header: str) -> str | None:
    """Return lowercased unit text inside [...] if present, else None."""
    s = raw_header.strip()
    if s.startswith("*"):
        s = s[1:]
    lb = s.find("[")
    if lb < 0:
        return None
    rb = s.find("]", lb)
    if rb < 0:
        return None
    return s[lb + 1 : rb].strip().lower()


def _tpms_press_header_is_psi(raw_header: str) -> bool:
    """True if this column is TPMS pressure (not temp) and header declares PSI."""
    base = _canonical_name(raw_header)
    if "tpms_press" not in base.lower() or "temp" in base.lower():
        return False
    token = _bracket_unit_token(raw_header)
    if not token:
        return False
    return token.startswith("psi")


def _parse_float(value: str) -> float | None:
    """Parse float; return None for empty, -nan(ind), nan, inf, etc."""
    value = value.strip()
    if not value:
        return None
    vlower = value.lower()
    if vlower in ("", "nan", "-nan(ind)", "nan(ind)", "inf", "-inf", "infinity"):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def parse_outing_information(lines: list[str]) -> dict[str, str]:
    """Parse {OutingInformation} block: key\tvalue lines until next block or empty."""
    result: dict[str, str] = {}
    for line in lines:
        line = line.rstrip("\n\r")
        if not line or line.startswith("{"):
            continue
        if "\t" in line:
            key, _, value = line.partition("\t")
            key, value = key.strip(), value.strip()
            if key:
                result[key] = value
    return result


def read_file_metadata(path: str | Path) -> dict[str, str]:
    """Read only the {OutingInformation} header from a file (fast, no data parsing)."""
    path = Path(path)
    lines: list[str] = []
    outing_start: int | None = None
    with path.open(encoding="utf-8", errors="replace") as f:
        for i, line in enumerate(f):
            lines.append(line)
            if "{OutingInformation}" in line:
                outing_start = i + 1
            if "{ChannelBlock}" in line:
                break
            if i > 50:
                break
    if outing_start is None:
        return {}
    return parse_outing_information(lines[outing_start:])


def parse_channel_block(
    header_line: str,
    data_lines: list[str],
    lap_reset_threshold: float = DEFAULT_LAP_RESET_THRESHOLD_S,
) -> tuple[list[str], list[dict[str, Any]], list[float]]:
    """
    Parse ChannelBlock: one header row (tab-separated), then data rows.
    Returns (column_names, list of row dicts with float/None values, lap_split_times).
    """
    raw_headers = [h.strip() for h in header_line.split("\t")]
    columns = [_canonical_name(h) for h in raw_headers]
    # Build list of rows
    rows: list[dict[str, Any]] = []
    for line in data_lines:
        line = line.rstrip("\n\r")
        if not line:
            continue
        parts = line.split("\t")
        row: dict[str, Any] = {}
        for i, col in enumerate(columns):
            if i < len(parts):
                val = _parse_float(parts[i])
                row[col] = val
            else:
                row[col] = None
        # Ensure we have at least time and laptime for lap detection
        if "Time" in row or "time" in row:
            rows.append(row)
    # Detect lap boundaries from laptime reset
    lap_split_times: list[float] = []
    time_col = "Time" if "Time" in columns else next((c for c in columns if c.lower() == "time"), None)
    laptime_col = "laptime" if "laptime" in columns else next((c for c in columns if "laptime" in c.lower()), None)
    if time_col and laptime_col and rows:
        # First lap starts at first row time
        t0 = rows[0].get(time_col)
        if t0 is not None:
            lap_split_times.append(float(t0))
        prev_lt: float | None = None
        for r in rows:
            t = r.get(time_col)
            lt = r.get(laptime_col)
            if t is None:
                continue
            if lt is not None and prev_lt is not None and (prev_lt - float(lt)) >= lap_reset_threshold:
                lap_split_times.append(float(t))
            if lt is not None:
                prev_lt = float(lt)
        # Assign lap_index to each row
        current_lap = 0
        prev_lt = None
        for r in rows:
            lt = r.get(laptime_col)
            if lt is not None and prev_lt is not None and (prev_lt - float(lt)) >= lap_reset_threshold:
                current_lap += 1
            r["lap_index"] = current_lap
            if lt is not None:
                prev_lt = float(lt)
    else:
        for r in rows:
            r["lap_index"] = 0
        if rows and time_col and rows[0].get(time_col) is not None:
            lap_split_times.append(float(rows[0][time_col]))
    return columns, rows, lap_split_times


def load_pi_toolbox_export(
    path: str | Path,
    lap_reset_threshold: float = DEFAULT_LAP_RESET_THRESHOLD_S,
) -> dict[str, Any]:
    """
    Load a Pi Toolbox Versioned ASCII export file.
    Returns dict with:
      - metadata: from {OutingInformation}
      - columns: list of canonical column names
      - rows: list of dicts (time, lap_index, tpms_press_*, tpms_temp_*, etc.; numeric as float or None)
      - lap_split_times: session times at each lap start (seconds)
      - pressure_columns: list of pressure channel names (bar)
    """
    path = Path(path)
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()

    if not lines or "PiToolboxVersionedASCIIDataSet" not in lines[0]:
        raise ValueError("Not a PiToolboxVersionedASCIIDataSet file")

    # Find blocks
    outing_start: int | None = None
    channel_start: int | None = None
    for i, line in enumerate(lines):
        if "{OutingInformation}" in line:
            outing_start = i + 1
        if "{ChannelBlock}" in line:
            channel_start = i + 1
            break

    metadata: dict[str, str] = {}
    if outing_start is not None and channel_start is not None:
        metadata = parse_outing_information(lines[outing_start : channel_start - 1])

    if channel_start is None:
        raise ValueError("No {ChannelBlock} found")

    # Channel block: first line is header, rest are data
    header_line = lines[channel_start].strip()
    data_lines = lines[channel_start + 1 :]
    columns, rows, lap_split_times = parse_channel_block(
        header_line, data_lines, lap_reset_threshold=lap_reset_threshold
    )

    # Headers like *tpms_press_fl [psi] strip to canonical tpms_press_fl but values are PSI.
    # Without this, we treat ~26 as bar and the UI multiplies again for PSI display (~377).
    raw_headers = [h.strip() for h in header_line.split("\t")]
    for raw_h in raw_headers:
        if not _tpms_press_header_is_psi(raw_h):
            continue
        base = _canonical_name(raw_h)
        for r in rows:
            pv = r.get(base)
            if pv is not None and not (isinstance(pv, float) and math.isnan(pv)):
                fpv = float(pv)
                r[f"{base}_psi"] = round(fpv, 4)
                r[base] = round(fpv / BAR_TO_PSI, 4)
            else:
                r[f"{base}_psi"] = None

    # TPMS pressure columns (bar storage in tpms_press_*); add *_psi if not already set
    pressure_cols = [
        c
        for c in columns
        if "tpms_press" in c.lower() and "temp" not in c.lower() and not c.lower().endswith("_psi")
    ]
    for r in rows:
        for col in pressure_cols:
            psi_key = col + "_psi"
            v = r.get(col)
            if psi_key in r and r.get(psi_key) is not None:
                continue
            if v is not None and not math.isnan(v):
                r[psi_key] = round(float(v) * BAR_TO_PSI, 4)
            else:
                r[psi_key] = None

    return {
        "metadata": metadata,
        "columns": columns,
        "rows": rows,
        "lap_split_times": lap_split_times,
        "pressure_columns": pressure_cols,
    }


def bar_to_psi(bar: float) -> float:
    """Convert bar to psi."""
    return bar * BAR_TO_PSI


def psi_to_bar(psi: float) -> float:
    """Convert psi to bar."""
    return psi / BAR_TO_PSI


if __name__ == "__main__":
    import sys
    p = sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "Datasets" / "DaveExport.txt"
    data = load_pi_toolbox_export(p)
    print("Metadata:", data["metadata"])
    print("Lap splits (first 5):", data["lap_split_times"][:5])
    print("Pressure columns:", data["pressure_columns"])
    print("Row count:", len(data["rows"]))
    if data["rows"]:
        print("First row keys:", list(data["rows"][0].keys())[:15])
