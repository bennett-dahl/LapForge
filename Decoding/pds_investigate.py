#!/usr/bin/env python3
"""
Investigation script for Pi Data Series (.pds) files from Porsche 992.1 GT3 Cup
(Cosworth / Pi Research logger format).

PDS = Pi Data Series — native binary from Pi Sigma/Delta/Omega, Cosworth ICD/ICD-Lite.
No public binary spec; this script helps reverse-engineer structure from your files.

Known channel IDs (from Brake Point / community):
  - 502: GPS Latitude (radians → degrees)
  - 532: GPS Longitude (radians → degrees)
  - 213: Engine RPM (rad/s → RPM × 9.549)
  - ECU speed: 199, 168, 721, 112
  - GPS speed: 281, 305, 304, 119
  - GPS altitude: 185, 151, 152
  - Acceleration: 718, 712
  - Lap counter: 224
"""

import struct
import sys
from pathlib import Path


def read_pds_header(path: Path, max_bytes: int = 0x5000) -> bytes:
    with open(path, "rb") as f:
        return f.read(max_bytes)


def find_utf16_strings(data: bytes, min_len: int = 4) -> list[tuple[int, str]]:
    """Find UTF-16 LE null-terminated strings (e.g. 'C.o.s.w.o.r.t.h.')."""
    found = []
    i = 0
    while i < len(data) - 2:
        if data[i + 1] == 0 and 0x20 <= data[i] <= 0x7E:
            start = i
            chars = []
            while i < len(data) - 1 and data[i + 1] == 0 and 0x20 <= data[i] <= 0x7E:
                chars.append(chr(data[i]))
                i += 2
            if len(chars) >= min_len:
                found.append((start, "".join(chars)))
        else:
            i += 1
    return found


def find_ascii_strings(data: bytes, min_len: int = 6) -> list[tuple[int, str]]:
    """Find ASCII printable strings."""
    found = []
    i = 0
    while i < len(data):
        if 0x20 <= data[i] <= 0x7E:
            start = i
            chars = []
            while i < len(data) and 0x20 <= data[i] <= 0x7E:
                chars.append(chr(data[i]))
                i += 1
            if len(chars) >= min_len:
                found.append((start, "".join(chars)))
        else:
            i += 1
    return found


def analyze_header(data: bytes) -> None:
    print("=== First 32 bytes (hex) ===")
    chunk = data[:32]
    for i in range(0, len(chunk), 16):
        hexpart = " ".join(f"{b:02x}" for b in chunk[i : i + 16])
        print(f"  {i:04x}: {hexpart}")

    print("\n=== Possible header fields (little-endian) ===")
    if len(data) >= 4:
        v = struct.unpack_from("<I", data, 0)[0]
        print(f"  Offset 0x00: uint32 = {v} (version or magic?)")
    if len(data) >= 8:
        v = struct.unpack_from("<Q", data, 0)[0]
        print(f"  Offset 0x00: uint64 = {v}")
    if len(data) >= 0x24:
        # Around 0x20 we see: 15 00 2a 00 27 00 6f 02 ... (repeated)
        for off in (0x20, 0x24, 0x28):
            u16 = struct.unpack_from("<H", data, off)[0]
            print(f"  Offset 0x{off:02x}: uint16 = {u16}")

    print("\n=== UTF-16 LE strings (likely labels) ===")
    utf16 = find_utf16_strings(data, min_len=3)
    for offset, s in utf16[:40]:
        print(f"  0x{offset:04x}: {s!r}")

    print("\n=== ASCII strings ===")
    ascii_strs = find_ascii_strings(data, min_len=4)
    for offset, s in ascii_strs[:30]:
        print(f"  0x{offset:04x}: {s!r}")


def scan_full_file_for_strings(path: Path, sample_step: int = 50000) -> None:
    """Sample the file for UTF-16 and ASCII strings to find channel names."""
    size = path.stat().st_size
    print(f"\n=== File size: {size:,} bytes ({size / 1024 / 1024:.1f} MB) ===")
    # Read first 100k and a middle chunk
    with open(path, "rb") as f:
        head = f.read(100_000)
        f.seek(size // 2)
        mid = f.read(50_000)
    for name, data in [("head", head), ("mid", mid)]:
        utf16 = find_utf16_strings(data, min_len=4)
        unique = {s for _, s in utf16}
        print(f"\n  {name}: {len(utf16)} UTF-16 strings, {len(unique)} unique")
        for s in sorted(unique)[:25]:
            print(f"    {s!r}")


def look_for_channel_id_patterns(data: bytes) -> None:
    """Search for known channel IDs (213, 502, 532) as 16- or 32-bit."""
    print("\n=== Searching for known channel IDs (213, 502, 532) in first 2KB ===")
    chunk = data[:2048]
    for ch_id in (213, 502, 532):
        # as uint16 LE
        b2 = struct.pack("<H", ch_id)
        pos = chunk.find(b2)
        if pos >= 0:
            print(f"  ch_id {ch_id} (uint16): first at 0x{pos:04x}")
        # as uint32 LE
        b4 = struct.pack("<I", ch_id)
        pos = chunk.find(b4)
        if pos >= 0:
            print(f"  ch_id {ch_id} (uint32): first at 0x{pos:04x}")


def main() -> None:
    datasets = Path(__file__).parent / "Datasets"
    pds_files = list(datasets.glob("*.pds")) if datasets.exists() else []
    if not pds_files:
        print("No .pds files found in Datasets/")
        sys.exit(1)

    path = pds_files[0]
    print(f"Using: {path.name}\n")

    header = read_pds_header(path)
    analyze_header(header)
    look_for_channel_id_patterns(header)
    scan_full_file_for_strings(path)

    # Estimate where metadata ends (last long UTF-16 string in first 64K)
    data_64k = read_pds_header(path, max_bytes=0x10000)
    utf16_all = find_utf16_strings(data_64k, min_len=10)
    if utf16_all:
        last_str_offset = utf16_all[-1][0]
        last_str_len = len(utf16_all[-1][1]) * 2  # UTF-16
        meta_end_guess = last_str_offset + last_str_len + 0x100  # padding
        print(f"\n=== Metadata block guess ===")
        print(f"  Last long UTF-16 string ends around 0x{last_str_offset + last_str_len:04x}")
        print(f"  Data block may start around 0x{meta_end_guess:04x} ({meta_end_guess})")

    print("\n--- Next steps ---")
    print("1. Compare multiple .pds files to find fixed header vs session-specific blocks.")
    print("2. Look for repeated record length (e.g. fixed-size time-sliced records).")
    print("3. Map channel table: offset/length of channel descriptors after 'Cosworth'/'Diagnostic'.")
    print("4. Decode sample rate and data block start; then parse channels by ch_id.")


if __name__ == "__main__":
    main()
