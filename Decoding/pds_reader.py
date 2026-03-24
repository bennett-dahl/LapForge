#!/usr/bin/env python3
"""
Pi Data Series (.pds) file reader and CSV exporter.

Decodes Cosworth/Pi Research PDS files (e.g. Porsche 992.1 GT3 Cup / CUP992)
and exports time-series data to CSV. No public binary spec; layout inferred
from reverse-engineering.
"""

from __future__ import annotations

import argparse
import csv
import struct
import sys
from pathlib import Path
from typing import BinaryIO


# Header layout (little-endian)
MAGIC_OFFSET = 0x00
DATA_SIZE_OFFSET = 0x80  # uint32: number of bytes of time-series data
RECORD_SIZE = 320       # bytes per record (80 × float32); some slots may be unused
CHANNELS_PER_RECORD = 80


def read_uint32(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def read_float32(data: bytes, offset: int) -> float:
    return struct.unpack_from("<f", data, offset)[0]


def parse_header(f: BinaryIO, file_size: int) -> tuple[int, int, dict]:
    """
    Parse PDS header. Returns (header_size, data_size, metadata_dict).
    """
    # First read enough to get data size
    block = f.read(0x90)
    if len(block) < 0x84:
        raise ValueError("File too small for PDS header")
    magic = read_uint32(block, MAGIC_OFFSET)
    if magic != 1:
        raise ValueError(f"Unexpected PDS magic: {magic} (expected 1)")
    data_size = read_uint32(block, DATA_SIZE_OFFSET)
    header_size = file_size - data_size
    if header_size < 0 or data_size <= 0:
        raise ValueError(
            f"Invalid sizes: data_size={data_size}, file_size={file_size}, header_size={header_size}"
        )
    metadata: dict[str, str] = {}
    # Read full header for string extraction
    f.seek(0)
    header = f.read(header_size)
    if len(header) < header_size:
        raise ValueError(f"Could not read full header: got {len(header)}, need {header_size}")
    # Extract known UTF-16 LE strings (track, driver, comment)
    for label, needle_utf16 in [
        ("track", "TTMS Speedway"),  # will be overwritten by actual
        ("driver", "A.Clark"),
        ("comment", "Testing for electrical error"),
    ]:
        needle = needle_utf16.encode("utf-16-le")
        pos = header.find(needle)
        if pos >= 0:
            end = pos
            while end < len(header) - 1 and header[end + 1] == 0 and header[end] >= 0x20:
                end += 2
            s = header[pos:end].decode("utf-16-le", errors="ignore").rstrip("\x00")
            if len(s) < 500:  # avoid giant event text blocks
                metadata[label] = s
    # Prefer first occurrence of track-like string (between 0x11f0 and 0x1400)
    if len(header) > 0x1200:
        chunk = header[0x11f0:0x1400].decode("utf-16-le", errors="ignore")
        for part in chunk.split("\x00"):
            part = part.strip()
            if 3 < len(part) < 80 and part.isprintable() and " " in part:
                metadata["track"] = part
                break
    return header_size, data_size, metadata


def extract_channel_names(header: bytes, max_channels: int = 64) -> list[str] | None:
    """
    Try to extract a list of channel names from the header.
    Returns list of names if a plausible sequence is found, else None.
    """
    # Look for "Time" as start of channel list (standalone UTF-16)
    time_utf16 = "Time".encode("utf-16-le") + b"\x00\x00"
    pos = header.find(time_utf16)
    if pos < 0:
        return None
    names: list[str] = []
    i = pos
    while i < len(header) - 2 and len(names) < max_channels:
        if header[i + 1] != 0 or header[i] < 0x20:
            i += 1
            continue
        s = []
        j = i
        while j < len(header) - 1 and header[j + 1] == 0:
            c = header[j]
            if 32 <= c <= 126 or c in (9, 10, 13):
                s.append(chr(c))
                j += 2
            else:
                break
        name = "".join(s).strip("\x00").strip()
        if not name:
            i += 2
            continue
        if len(name) > 80 or "This event" in name or "Applet" in name:
            break
        names.append(name)
        i = j
    if len(names) >= 2 and names[0] == "Time":
        return names
    return None


def read_data_block(
    f: BinaryIO,
    header_size: int,
    data_size: int,
    record_size: int = RECORD_SIZE,
    channels_per_record: int = CHANNELS_PER_RECORD,
) -> tuple[list[list[float]], int]:
    """
    Read time-series data as list of records (each record = list of float32).
    Returns (records, actual_record_count). Drops partial last record if any.
    """
    f.seek(header_size)
    bytes_per_value = 4  # float32
    expected_per_record = channels_per_record * bytes_per_value
    if record_size != expected_per_record:
        channels_per_record = record_size // bytes_per_value
    full_records = data_size // record_size
    records: list[list[float]] = []
    n = record_size // bytes_per_value
    for _ in range(full_records):
        raw = f.read(record_size)
        if len(raw) < record_size:
            break
        row = [
            read_float32(raw, i * 4)
            for i in range(n)
        ]
        records.append(row)
    return records, full_records


def load_pds(path: Path) -> tuple[list[list[float]], list[str], dict]:
    """
    Load a PDS file. Returns (data_rows, column_names, metadata).
    column_names are either parsed from file or generic Channel_0, ...
    """
    path = Path(path)
    file_size = path.stat().st_size
    with open(path, "rb") as f:
        header_size, data_size, metadata = parse_header(f, file_size)
        f.seek(0)
        header = f.read(header_size)
    channel_names = extract_channel_names(header)
    with open(path, "rb") as f:
        records, _ = read_data_block(f, header_size, data_size)
    n = len(records[0]) if records else CHANNELS_PER_RECORD
    if channel_names and len(channel_names) >= n:
        columns = channel_names[:n]
    else:
        columns = [f"Channel_{i}" for i in range(n)]
    return records, columns, metadata


def write_csv(
    path: Path,
    records: list[list[float]],
    column_names: list[str],
    *,
    delimiter: str = ",",
) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=delimiter)
        w.writerow(column_names)
        for row in records:
            w.writerow(row)
    print(f"Wrote {len(records)} rows to {path}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Decode PDS (Pi Data Series) telemetry and export to CSV"
    )
    parser.add_argument(
        "input",
        type=Path,
        help="Input .pds file",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output CSV path (default: input name with .csv)",
    )
    parser.add_argument(
        "--delimiter",
        type=str,
        default=",",
        help="CSV delimiter (default: comma)",
    )
    parser.add_argument(
        "--no-header",
        action="store_true",
        help="Do not write CSV header row",
    )
    args = parser.parse_args()
    if not args.input.exists():
        print(f"Error: file not found: {args.input}", file=sys.stderr)
        return 1
    out = args.output or args.input.with_suffix(".csv")
    try:
        records, column_names, metadata = load_pds(args.input)
    except Exception as e:
        print(f"Error reading PDS: {e}", file=sys.stderr)
        return 1
    if not records:
        print("No data records found.", file=sys.stderr)
        return 1
    if metadata:
        print("Session:", metadata)
    print(f"Channels: {len(column_names)}, Rows: {len(records)}")
    if args.no_header:
        with open(out, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f, delimiter=args.delimiter)
            for row in records:
                w.writerow(row)
        print(f"Wrote {len(records)} rows to {out} (no header)")
    else:
        write_csv(out, records, column_names, delimiter=args.delimiter)
    return 0


if __name__ == "__main__":
    sys.exit(main())
