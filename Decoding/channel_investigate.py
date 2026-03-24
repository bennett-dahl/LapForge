#!/usr/bin/env python3
"""
Investigate PDS/CSV channels by value ranges to suggest what each channel might be.

Reads time-series data (from .pds or .csv), computes per-channel statistics,
and matches against known telemetry signatures (Time, RPM, Speed, GPS, etc.).
"""

from __future__ import annotations

import argparse
import csv
import math
import sys
from pathlib import Path

# Optional: use pds_reader for .pds files
try:
    from pds_reader import load_pds
except ImportError:
    load_pds = None  # type: ignore


# -----------------------------------------------------------------------------
# Channel signatures: (name, min_val, max_val, description)
# Values in typical units (seconds, RPM, km/h, degrees, %, G, etc.)
# A channel is suggested if its observed range fits inside or strongly overlaps.
# -----------------------------------------------------------------------------
CHANNEL_SIGNATURES: list[tuple[str, float, float, str]] = [
    ("Time", 0.0, 1e7, "Monotonic time (s); often 0 to session length"),
    ("RPM", 0.0, 12000.0, "Engine RPM (0–12k typical for GT3)"),
    ("Speed_kmh", 0.0, 400.0, "Speed (km/h)"),
    ("Speed_mph", 0.0, 250.0, "Speed (mph)"),
    ("GPS_Lat_deg", -90.0, 90.0, "GPS latitude (degrees)"),
    ("GPS_Lon_deg", -180.0, 180.0, "GPS longitude (degrees)"),
    ("GPS_Lat_rad", -1.6, 1.6, "GPS latitude (radians)"),
    ("GPS_Lon_rad", -3.2, 3.2, "GPS longitude (radians)"),
    ("GPS_Altitude_m", -500.0, 5000.0, "GPS altitude (m)"),
    ("Throttle_pct", 0.0, 100.0, "Throttle (%)"),
    ("Brake_pct", 0.0, 100.0, "Brake (%)"),
    ("Steer_deg", -540.0, 540.0, "Steering angle (degrees)"),
    ("Lateral_G", -3.0, 3.0, "Lateral acceleration (G)"),
    ("Longitudinal_G", -3.0, 3.0, "Longitudinal acceleration (G)"),
    ("Gear", 0.0, 8.0, "Gear (integer-like 0–8)"),
    ("Lap_Count", 0.0, 1000.0, "Lap counter"),
    ("Voltage", 0.0, 20.0, "Electrical voltage (V)"),
    ("Temp_C", -40.0, 150.0, "Temperature (°C)"),
    ("Pressure_bar", 0.0, 20.0, "Pressure (bar)"),
    ("Angle_deg", -180.0, 180.0, "Generic angle (degrees)"),
    ("Percent_0_1", 0.0, 1.0, "Normalized 0–1 (could be throttle/brake in 0–1)"),
    ("Percent_0_100", 0.0, 100.0, "Percent 0–100"),
    ("Small_Angle_rad", -0.1, 0.1, "Small angle (rad) or rate"),
    ("Bool_like", 0.0, 1.0, "Boolean-like (0/1)"),
]

# Default: values with |v| > this are excluded from range stats (telemetry typically smaller)
DEFAULT_INVALID_THRESHOLD = 1e8
INVALID_NAN_INF = True


def is_valid(v: float, threshold: float = DEFAULT_INVALID_THRESHOLD) -> bool:
    if INVALID_NAN_INF and (math.isnan(v) or math.isinf(v)):
        return False
    if abs(v) > threshold:
        return False
    return True


def channel_stats(
    series: list[float],
    *,
    sample_max: int | None = 100_000,
    invalid_threshold: float = DEFAULT_INVALID_THRESHOLD,
) -> dict:
    """Compute min, max, mean, std, unique_ratio, monotonic, integer_like, percent_valid."""
    if sample_max and len(series) > sample_max:
        # Sample: start, end, and middle
        step = max(1, (len(series) - 1) // max(1, sample_max // 3))
        indices = list(range(0, len(series), step))[: sample_max]
        if len(series) - 1 not in indices:
            indices.append(len(series) - 1)
        series = [series[i] for i in indices]
    total = len(series)
    valid = [v for v in series if is_valid(v, invalid_threshold)]
    n = len(valid)
    if n == 0:
        return {
            "min": float("nan"),
            "max": float("nan"),
            "mean": float("nan"),
            "std": float("nan"),
            "count": 0,
            "total": total,
            "percent_valid": (100.0 * 0 / total) if total else 0.0,
            "unique_ratio": 0.0,
            "monotonic": False,
            "integer_like": False,
        }
    min_v = min(valid)
    max_v = max(valid)
    mean_v = sum(valid) / n
    variance = sum((x - mean_v) ** 2 for x in valid) / n
    std_v = math.sqrt(variance) if variance >= 0 else 0.0
    unique_ratio = len(set(valid)) / n
    # Monotonic (non-decreasing) over the sampled series
    monotonic = all(valid[i] <= valid[i + 1] for i in range(len(valid) - 1))
    # Integer-like: most values close to integer
    rounded = [round(x) for x in valid]
    integer_like = sum(abs(x - r) < 0.01 for x, r in zip(valid, rounded)) / n > 0.95
    percent_valid = (100.0 * n / total) if total else 0.0
    return {
        "min": min_v,
        "max": max_v,
        "mean": mean_v,
        "std": std_v,
        "count": n,
        "total": total,
        "percent_valid": percent_valid,
        "unique_ratio": unique_ratio,
        "monotonic": monotonic,
        "integer_like": integer_like,
    }


def suggest_channel(stats: dict) -> list[tuple[str, float, str]]:
    """
    Return list of (signature_name, score, description) sorted by score (best first).
    Score 1.0 = perfect fit; 0 = no fit.
    """
    min_v, max_v = stats["min"], stats["max"]
    count = stats.get("count", 0)
    if count == 0:
        return [("Unused_or_invalid", 0.0, "No valid samples in range; channel may be unused or wrong type")]
    if math.isnan(min_v) or math.isnan(max_v):
        return []
    span = max_v - min_v
    results: list[tuple[str, float, str]] = []
    for name, sig_min, sig_max, desc in CHANNEL_SIGNATURES:
        # Require observed range to be mostly inside signature range (with margin)
        sig_span = sig_max - sig_min
        margin = max(0.1 * sig_span, 1e-6)
        # 0-1 style signatures: only match when data actually in 0-1 (avoid Time/Percent matching as Bool)
        if sig_span <= 1.5 and sig_max <= 1.5:
            if max_v > 1.5:  # e.g. Time 0-100 would not match Bool_like or Percent_0_1
                continue
            margin = min(margin, 0.05)
        elif sig_span <= 1.5:
            margin = min(margin, 0.05)
        low_ok = min_v >= sig_min - margin
        high_ok = max_v <= sig_max + margin
        if not (low_ok and high_ok):
            continue
        # Prefer tighter fit: score by how much of signature range we use
        if sig_span <= 0:
            continue
        overlap = max(0, min(max_v, sig_max) - max(min_v, sig_min))
        score = overlap / sig_span if sig_span > 0 else 0.0
        # Prefer Time when clearly monotonic and positive (session time)
        if name == "Time" and stats.get("monotonic") and min_v >= 0 and max_v < 1e7:
            score = 1.0
        # Bonus for integer-like when signature is discrete (Gear, Lap_Count, Bool)
        if name in ("Gear", "Lap_Count", "Bool_like") and stats.get("integer_like"):
            score = min(1.0, score + 0.2)
        if score > 0:
            results.append((name, score, desc))
    # If no signature matched, suggest "Unknown" with a hint from the range
    if not results:
        span = max_v - min_v
        if span > 1e6:
            results.append(("Unknown_large_range", 0.0, "Values outside typical telemetry; may be wrong type or unused"))
        else:
            results.append(("Unknown", 0.0, "No signature matched; check value ranges above"))
    results.sort(key=lambda x: -x[1])
    return results


def load_data(path: Path) -> tuple[list[list[float]], list[str]]:
    """Load from .pds or .csv. Returns (rows, column_names)."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(path)
    suf = path.suffix.lower()
    if suf == ".pds":
        if load_pds is None:
            raise RuntimeError("PDS support requires pds_reader.py")
        records, columns, _ = load_pds(path)
        return records, columns
    if suf == ".csv":
        with open(path, "r", encoding="utf-8", newline="") as f:
            r = csv.reader(f)
            columns = next(r, [])
            rows = []
            for row in r:
                if len(row) != len(columns):
                    continue
                try:
                    rows.append([float(x) for x in row])
                except ValueError:
                    continue
        return rows, columns
    raise ValueError(f"Unsupported format: {path.suffix}. Use .pds or .csv")


def run_investigation(
    path: Path,
    *,
    sample_max: int | None = 100_000,
    output_csv: Path | None = None,
    invalid_threshold: float = DEFAULT_INVALID_THRESHOLD,
) -> list[dict]:
    """Load data, compute per-channel stats and suggestions. Return list of row dicts."""
    records, column_names = load_data(path)
    if not records:
        return []
    n_channels = len(records[0])
    # Transpose to list of series per channel
    series_per_ch = [[] for _ in range(n_channels)]
    for row in records:
        for c, v in enumerate(row):
            if c < n_channels:
                series_per_ch[c].append(v)
    report = []
    for ch in range(n_channels):
        name = column_names[ch] if ch < len(column_names) else f"Channel_{ch}"
        stats = channel_stats(
            series_per_ch[ch],
            sample_max=sample_max,
            invalid_threshold=invalid_threshold,
        )
        suggestions = suggest_channel(stats)
        best = suggestions[0] if suggestions else ("?", 0.0, "")
        report.append({
            "channel_index": ch,
            "channel_name": name,
            "min": stats["min"],
            "max": stats["max"],
            "mean": stats["mean"],
            "std": stats["std"],
            "count": stats["count"],
            "total": stats.get("total", stats["count"]),
            "percent_valid": stats.get("percent_valid", 100.0 if stats["count"] else 0.0),
            "unique_ratio": stats["unique_ratio"],
            "monotonic": stats["monotonic"],
            "integer_like": stats["integer_like"],
            "suggested_type": best[0],
            "suggested_score": best[1],
            "suggested_desc": best[2],
            "all_matches": suggestions[:5],
        })
    if output_csv:
        with open(output_csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(
                f,
                fieldnames=[
                    "channel_index", "channel_name", "min", "max", "mean", "std",
                    "count", "total", "percent_valid", "unique_ratio", "monotonic", "integer_like",
                    "suggested_type", "suggested_score", "suggested_desc",
                ],
            )
            w.writeheader()
            for r in report:
                row = {k: r.get(k, "") for k in w.fieldnames}
                if "suggested_score" in row and isinstance(row["suggested_score"], (int, float)):
                    row["suggested_score"] = f"{row['suggested_score']:.3f}"
                w.writerow(row)
        print(f"Wrote report to {output_csv}", file=sys.stderr)
    return report


def print_report(report: list[dict], *, verbose: bool = False) -> None:
    """Print a human-readable table."""
    if not report:
        print("No channels.")
        return
    # Header
    print(f"{'Ch':>3} {'Min':>12} {'Max':>12} {'Mean':>10} {'Std':>10} {'%Val':>5} {'Monot':>5} {'Int':>3}  Suggested")
    print("-" * 92)
    for r in report:
        min_v, max_v = r["min"], r["max"]
        mean_v, std_v = r["mean"], r["std"]
        if math.isfinite(min_v) and math.isfinite(max_v):
            min_s = f"{min_v:12.4g}"
            max_s = f"{max_v:12.4g}"
        else:
            min_s = max_s = "         nan"
        mean_s = f"{mean_v:10.4g}" if math.isfinite(mean_v) else "       nan"
        std_s = f"{std_v:10.4g}" if math.isfinite(std_v) else "       nan"
        pct = r.get("percent_valid", 0)
        pct_s = f"{pct:5.1f}" if pct is not None and math.isfinite(pct) else "   - "
        mono = "  Y  " if r["monotonic"] else "  N  "
        int_l = " Y " if r["integer_like"] else " N "
        sug = f"{r['suggested_type']} ({r['suggested_score']:.2f})"
        if r["suggested_type"] in ("?", "Unused_or_invalid"):
            sug = r["suggested_type"]
        print(f"{r['channel_index']:>3} {min_s} {max_s} {mean_s} {std_s} {pct_s} {mono} {int_l}  {sug}")
        if verbose and r.get("all_matches"):
            for name, score, desc in r["all_matches"][:3]:
                print(f"      -> {name}: {score:.2f}  {desc}")
    print("-" * 92)
    print("%Val=percent of samples in valid range. Monot=monotonic. Int=integer-like. Suggested = best match by value range.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Investigate channel value ranges to suggest channel types (Time, RPM, Speed, etc.)"
    )
    parser.add_argument(
        "input",
        type=Path,
        help="Input .pds or .csv file",
    )
    parser.add_argument(
        "-o", "--output",
        type=Path,
        default=None,
        help="Write report to this CSV",
    )
    parser.add_argument(
        "--full-scan",
        action="store_true",
        help="Use all rows (slower; default is to sample up to 100k points per channel)",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Print up to 3 alternative suggestions per channel",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=DEFAULT_INVALID_THRESHOLD,
        metavar="N",
        help=f"Exclude values with |v| > N from stats (default: {DEFAULT_INVALID_THRESHOLD:.0e})",
    )
    args = parser.parse_args()
    if not args.input.exists():
        print(f"Error: not found: {args.input}", file=sys.stderr)
        return 1
    sample_max = None if args.full_scan else 100_000
    try:
        report = run_investigation(
            args.input,
            sample_max=sample_max,
            output_csv=args.output,
            invalid_threshold=args.threshold,
        )
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    if not report:
        print("No data to report.", file=sys.stderr)
        return 1
    print_report(report, verbose=args.verbose)
    return 0


if __name__ == "__main__":
    sys.exit(main())
