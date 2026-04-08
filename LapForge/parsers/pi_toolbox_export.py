#!/usr/bin/env python3
"""
Pi Toolbox Versioned ASCII export parser.

Parses vehicle dynamics export files (e.g. 992 Cup TPMS data) from Pi Toolbox:
- Detects PiToolboxVersionedASCIIDataSet format
- Parses {OutingInformation} metadata
- Parses {ChannelBlock} tab-separated data with canonical column names
- Supports both single-block (all channels in one header) and multi-block
  (one {ChannelBlock} per channel) export formats
- Lap detection from laptime resets
- TPMS pressure: bar columns stored as bar; `[psi]` headers keep bar storage + *_psi (avoids double conversion)
- Multi-outing merge: ``merge_parsed_outings`` stitches several parsed dicts into one continuous session
"""

from __future__ import annotations

import bisect
import json
import math
import re
from pathlib import Path
from typing import Any


BAR_TO_PSI = 14.5038
DEFAULT_LAP_RESET_THRESHOLD_S = 5.0
MERGE_GAP_S = 1.0


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


# ---------------------------------------------------------------------------
# Columnar helpers for multi-block files
# ---------------------------------------------------------------------------

def _detect_laps_columnar(
    times: list[float],
    series: dict[str, list[float | None]],
    columns: list[str],
    lap_reset_threshold: float = DEFAULT_LAP_RESET_THRESHOLD_S,
) -> tuple[list[float], list[int]]:
    """Detect lap boundaries on columnar data.

    Returns ``(lap_split_times, lap_index_array)``.
    """
    all_keys = set(columns) | {"Time"}
    laptime_col = "laptime" if "laptime" in all_keys else next(
        (c for c in all_keys if "laptime" in c.lower()), None
    )

    n = len(times)
    lap_split_times: list[float] = []
    lap_indices: list[int] = [0] * n

    if not laptime_col or laptime_col not in series or n == 0:
        if n > 0:
            lap_split_times.append(times[0])
        return lap_split_times, lap_indices

    lt_arr = series[laptime_col]
    lap_split_times.append(times[0])

    prev_lt: float | None = None
    for i in range(n):
        lt = lt_arr[i]
        if lt is not None and prev_lt is not None and (prev_lt - lt) >= lap_reset_threshold:
            lap_split_times.append(times[i])
        if lt is not None:
            prev_lt = lt

    current_lap = 0
    prev_lt = None
    for i in range(n):
        lt = lt_arr[i]
        if lt is not None and prev_lt is not None and (prev_lt - lt) >= lap_reset_threshold:
            current_lap += 1
        lap_indices[i] = current_lap
        if lt is not None:
            prev_lt = lt

    return lap_split_times, lap_indices


def _apply_psi_conversion_columnar(
    series: dict[str, list[float | None]],
    columns: list[str],
    raw_headers_map: dict[str, str],
) -> list[str]:
    """Apply TPMS PSI conversion on columnar series. Returns ``pressure_columns`` list.

    Modifies *series* in-place (adds ``*_psi`` arrays, converts bar columns).
    """
    for channel_name, raw_header in raw_headers_map.items():
        if not _tpms_press_header_is_psi(raw_header):
            continue
        base = _canonical_name(raw_header)
        if base not in series:
            continue
        arr = series[base]
        psi_arr: list[float | None] = [None] * len(arr)
        bar_arr: list[float | None] = [None] * len(arr)
        for i, v in enumerate(arr):
            if v is not None and not math.isnan(v):
                psi_arr[i] = round(v, 4)
                bar_arr[i] = round(v / BAR_TO_PSI, 4)
        series[f"{base}_psi"] = psi_arr
        series[base] = bar_arr

    pressure_cols = [
        c for c in columns
        if "tpms_press" in c.lower() and "temp" not in c.lower() and not c.lower().endswith("_psi")
    ]
    for col in pressure_cols:
        psi_key = col + "_psi"
        if psi_key in series:
            continue
        if col not in series:
            continue
        arr = series[col]
        psi_arr = [None] * len(arr)
        for i, v in enumerate(arr):
            if v is not None and not math.isnan(v):
                psi_arr[i] = round(v * BAR_TO_PSI, 4)
        series[psi_key] = psi_arr

    return pressure_cols


def _load_multiblock(
    lines: list[str],
    block_positions: list[int],
    lap_reset_threshold: float,
) -> tuple[list[str], list[float], dict[str, list[float | None]], list[float], list[int], list[str], dict[str, str]]:
    """Parse a multi-{ChannelBlock} file using columnar storage (no row-dicts).

    Returns ``(columns, master_times, series, lap_split_times, lap_indices,
    pressure_cols, raw_headers_map)``.
    """
    channel_times: dict[str, list[float]] = {}
    channel_values: dict[str, list[float | None]] = {}
    raw_headers_map: dict[str, str] = {}
    channel_order: list[str] = []

    for idx, start in enumerate(block_positions):
        header_line = lines[start + 1].strip() if start + 1 < len(lines) else ""
        raw_parts = [h.strip() for h in header_line.split("\t")]
        if len(raw_parts) < 2:
            continue

        channel_raw = raw_parts[1]
        channel_name = _canonical_name(channel_raw)
        raw_headers_map[channel_name] = channel_raw
        if channel_name not in channel_times:
            channel_order.append(channel_name)

        data_start = start + 2
        data_end = block_positions[idx + 1] if idx + 1 < len(block_positions) else len(lines)

        c_times: list[float] = []
        c_vals: list[float | None] = []
        for li in range(data_start, data_end):
            raw = lines[li]
            if not raw or raw.startswith("{"):
                continue
            tab = raw.find("\t")
            t_str = raw[:tab] if tab >= 0 else raw
            v_str = raw[tab + 1:].rstrip() if tab >= 0 else ""
            t = _parse_float(t_str)
            if t is None:
                continue
            c_times.append(t)
            c_vals.append(_parse_float(v_str))

        channel_times[channel_name] = c_times
        channel_values[channel_name] = c_vals

    # Build sorted, de-duped master time array
    all_times_set: set[float] = set()
    for ct in channel_times.values():
        all_times_set.update(ct)
    master_times = sorted(all_times_set)
    n = len(master_times)

    # Forward-fill join – columnar (one list per channel)
    series: dict[str, list[float | None]] = {}
    for ch in channel_order:
        ct = channel_times[ch]
        cv = channel_values[ch]
        out: list[float | None] = [None] * n
        if not ct:
            series[ch] = out
            continue
        ptr = 0
        current: float | None = None
        for i in range(n):
            t = master_times[i]
            while ptr < len(ct) and ct[ptr] <= t + 1e-8:
                current = cv[ptr]
                ptr += 1
            out[i] = current
        series[ch] = out

    # Free raw channel data
    del channel_times, channel_values

    columns = list(channel_order)
    lap_split_times, lap_indices = _detect_laps_columnar(
        master_times, series, columns, lap_reset_threshold
    )
    pressure_cols = _apply_psi_conversion_columnar(series, columns, raw_headers_map)

    return columns, master_times, series, lap_split_times, lap_indices, pressure_cols, raw_headers_map


# ---------------------------------------------------------------------------
# Row-based helpers (legacy, used by single-block path)
# ---------------------------------------------------------------------------

def _detect_laps(
    rows: list[dict[str, Any]],
    columns: list[str],
    lap_reset_threshold: float = DEFAULT_LAP_RESET_THRESHOLD_S,
) -> list[float]:
    """Detect lap boundaries from ``laptime`` resets and assign ``lap_index`` to each row.

    Returns ``lap_split_times`` (session times at each lap start).
    Mutates rows in-place to add ``lap_index``.
    """
    all_keys = set(columns)
    if rows:
        all_keys.update(rows[0].keys())
    time_col = "Time" if "Time" in all_keys else next((c for c in all_keys if c.lower() == "time"), None)
    laptime_col = "laptime" if "laptime" in all_keys else next((c for c in all_keys if "laptime" in c.lower()), None)

    lap_split_times: list[float] = []
    if time_col and laptime_col and rows:
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

    return lap_split_times


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def load_pi_toolbox_export(
    path: str | Path,
    lap_reset_threshold: float = DEFAULT_LAP_RESET_THRESHOLD_S,
) -> dict[str, Any]:
    """
    Load a Pi Toolbox Versioned ASCII export file.

    Supports both **single-block** files (all channels in one header row) and
    **multi-block** files (one ``{ChannelBlock}`` per channel, common in real
    Pi Toolbox offloads).

    Returns dict with:
      - metadata: from {OutingInformation}
      - columns: list of canonical column names
      - rows: list of dicts (single-block only; empty for multi-block)
      - lap_split_times: session times at each lap start (seconds)
      - pressure_columns: list of pressure channel names (bar)
      - _columnar: (multi-block only) ``{"times": [...], "series": {...}, "lap_indices": [...]}``
    """
    path = Path(path)
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()

    if not lines or "PiToolboxVersionedASCIIDataSet" not in lines[0]:
        raise ValueError("Not a PiToolboxVersionedASCIIDataSet file")

    outing_start: int | None = None
    block_positions: list[int] = []
    for i, line in enumerate(lines):
        if "{OutingInformation}" in line:
            outing_start = i + 1
        if "{ChannelBlock}" in line:
            block_positions.append(i)

    metadata: dict[str, str] = {}
    if outing_start is not None and block_positions:
        metadata = parse_outing_information(lines[outing_start : block_positions[0]])

    if not block_positions:
        raise ValueError("No {ChannelBlock} found")

    # --- Single-block path (backward compat with all-in-one-header files) ---
    if len(block_positions) == 1:
        channel_start = block_positions[0] + 1
        header_line = lines[channel_start].strip()
        data_lines = lines[channel_start + 1 :]
        columns, rows, lap_split_times = parse_channel_block(
            header_line, data_lines, lap_reset_threshold=lap_reset_threshold
        )

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

        pressure_cols = [
            c for c in columns
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

    # --- Multi-block path (columnar, no row-dicts) ---
    columns, master_times, col_series, lap_split_times, lap_indices, pressure_cols, _ = (
        _load_multiblock(lines, block_positions, lap_reset_threshold)
    )

    return {
        "metadata": metadata,
        "columns": columns,
        "rows": [],
        "lap_split_times": lap_split_times,
        "pressure_columns": pressure_cols,
        "_columnar": {
            "times": master_times,
            "series": col_series,
            "lap_indices": lap_indices,
        },
    }


def merge_parsed_outings(parsed_list: list[dict[str, Any]]) -> dict[str, Any]:
    """Merge multiple parsed outing dicts into one time-continuous session.

    Each element must be the output of :func:`load_pi_toolbox_export`.
    The list should be pre-sorted by ``OutingNumber`` (ascending).

    Handles both row-based (single-block) and columnar (multi-block) parsed dicts.
    Always returns columnar output via ``_columnar`` for efficiency.
    """
    if not parsed_list:
        return {
            "metadata": {}, "columns": [], "rows": [],
            "lap_split_times": [], "pressure_columns": [],
            "_columnar": {"times": [], "series": {}, "lap_indices": []},
        }
    if len(parsed_list) == 1:
        return parsed_list[0]

    all_splits: list[float] = []
    all_pressure_set: set[str] = set()

    # Collect ordered column list across all outings
    all_columns: list[str] = []
    seen_cols: set[str] = set()
    for p in parsed_list:
        for c in (p.get("columns") or []):
            if c not in seen_cols:
                all_columns.append(c)
                seen_cols.add(c)
        all_pressure_set.update(p.get("pressure_columns") or [])

    merged_times: list[float] = []
    merged_series: dict[str, list[float | None]] = {c: [] for c in all_columns}
    merged_lap_indices: list[int] = []

    running_offset: float = 0.0
    lap_offset: int = 0

    for parsed in parsed_list:
        col_data = parsed.get("_columnar")
        if col_data:
            p_times = col_data["times"]
            p_series = col_data["series"]
            p_laps = col_data["lap_indices"]
        else:
            p_times, p_series, p_laps = _rows_to_columnar(parsed)

        if not p_times:
            continue

        first_time = p_times[0]
        time_delta = running_offset - first_time
        n = len(p_times)

        for i in range(n):
            merged_times.append(round(p_times[i] + time_delta, 4))

        max_lap = 0
        for i in range(n):
            li = p_laps[i] + lap_offset if i < len(p_laps) else lap_offset
            merged_lap_indices.append(li)
            if li > max_lap:
                max_lap = li

        for c in all_columns:
            src = p_series.get(c)
            if src:
                merged_series[c].extend(src)
            else:
                merged_series[c].extend([None] * n)

        for s in (parsed.get("lap_split_times") or []):
            all_splits.append(round(float(s) + time_delta, 4))

        running_offset = merged_times[-1] + MERGE_GAP_S
        lap_offset = max_lap + 1

    merged_meta = dict(parsed_list[0].get("metadata") or {})
    merged_meta["outing_file_count"] = str(len(parsed_list))
    outing_nums = [
        (p.get("metadata") or {}).get("OutingNumber", str(i))
        for i, p in enumerate(parsed_list)
    ]
    merged_meta["outing_numbers"] = ",".join(outing_nums)

    return {
        "metadata": merged_meta,
        "columns": all_columns,
        "rows": [],
        "lap_split_times": all_splits,
        "pressure_columns": sorted(all_pressure_set),
        "_columnar": {
            "times": merged_times,
            "series": merged_series,
            "lap_indices": merged_lap_indices,
        },
    }


def _rows_to_columnar(
    parsed: dict[str, Any],
) -> tuple[list[float], dict[str, list[float | None]], list[int]]:
    """Convert a row-based parsed dict to columnar arrays (for merge compat)."""
    rows = parsed.get("rows") or []
    columns = parsed.get("columns") or []
    if not rows:
        return [], {}, []
    time_col = "Time"
    times: list[float] = []
    series: dict[str, list[float | None]] = {c: [] for c in columns}
    lap_indices: list[int] = []
    for r in rows:
        t = r.get(time_col)
        if t is None:
            continue
        times.append(float(t))
        for c in columns:
            series[c].append(r.get(c))
        lap_indices.append(r.get("lap_index", 0))
    return times, series, lap_indices


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
    col = data.get("_columnar")
    if col:
        print("Columnar mode: {} timestamps, {} channels".format(
            len(col["times"]), len(col["series"])
        ))
        print("Lap index range:", min(col["lap_indices"]), "->", max(col["lap_indices"]))
    else:
        print("Row count:", len(data["rows"]))
        if data["rows"]:
            print("First row keys:", list(data["rows"][0].keys())[:15])
