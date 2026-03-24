# Decoding Porsche 992.1 GT3 Cup .pds files

## What is .pds?

**PDS = Pi Data Series** — the native binary telemetry format from **Cosworth / Pi Research** data loggers. Your files come from hardware such as:

- **Badenia 3xx** (e.g. Badenia 320) — as seen in the file metadata  
- Project **CUP992** (Porsche 992 Cup)  
- Same family as Pi Sigma/Delta/Omega, Cosworth ICD/ICD-Lite  

There is **no public binary specification**. Decoding is done by reverse-engineering and by using known channel IDs published by third parties (e.g. Brake Point).

---

## What we know from your file

Running `python pds_investigate.py` on `A.Clark-001.056.000.pds` shows:

- **Header**: First 4 bytes `01 00 00 00` (likely version or format id). Then 8 bytes that look like a timestamp or double. At 0x20–0x28: values that could be date (e.g. 39, 2023).
- **Metadata** (UTF-16 LE strings in the first ~64 KB):
  - **Cosworth** / **Diagnostic** (vendor/app names)
  - **Track**: e.g. "TTMS Speedway"
  - **Driver**: e.g. "A.Clark"
  - **Session comment**: e.g. "Testing for electrical error parking lot"
  - **Timezone**: "Pacific Standard Time"
  - **Device**: Long string with "Badenia 320 - Dev", Toolset/DAE versions, **Project: CUP992**, etc.
- **Rest of file**: Largely binary; no UTF-16 strings in the middle → likely **time-series channel data** after a large metadata block.

---

## Known channel IDs (from Brake Point / community)

Stable across sessions:

| ch_id | Data           | Conversion              |
|-------|----------------|-------------------------|
| 502   | GPS Latitude   | Radians → degrees       |
| 532   | GPS Longitude  | Radians → degrees       |
| 213   | Engine RPM     | rad/s → RPM (× 9.549)   |

Content-detected (can vary by session):

- **ECU speed**: 199, 168, 721, 112  
- **GPS speed**: 281, 305, 304, 119  
- **GPS altitude**: 185, 151, 152  
- **Acceleration**: 718, 712  
- **Lap counter**: 224  

Throttle and braking are not direct channels; they are often **derived** (e.g. braking from longitudinal deceleration).

---

## How to start decoding

1. **Run the investigation script**
   ```bash
   python pds_investigate.py
   ```
   It dumps header hex, possible header fields, all UTF-16 and ASCII strings in the first 100 KB, and a guess where the metadata ends and data might start.

2. **Compare two .pds files**  
   Run the script on another file (e.g. `Dave Hollars-001.020.000.pds`) and diff:
   - Same header layout → fixed global header.
   - Same offset for “Cosworth”/“Diagnostic” but different track/driver → session block at a predictable offset.

3. **Find the channel table**  
   After “Cosworth”/“Diagnostic” there may be a table of channel descriptors (id, name, type, offset, rate). Search for the known ch_ids (213, 502, 532) as 16- or 32-bit in the first 50–100 KB to see if they appear in a table.

4. **Locate the data block**  
   - Use the “metadata end” guess from the script.
   - Look for alignment (e.g. data starting at 4 KB or 64 KB).
   - Check for a repeated record size (e.g. fixed bytes per time slice) by testing divisors of `(file_size - header_size)`.

5. **Use existing tools (if you only need extracted traces)**  
   - [Brake Point](https://www.brakepoint.io/en/guides/pi-pds/) can import .pds directly and extract GPS, speed, RPM, derived throttle/braking, etc., without a full spec.

6. **Optional: Pi Toolbox (MAT export)**  
   If you have access to Pi Toolbox Pro, exporting to MAT gives you documented channel names and often more reliable lap/accel data; you can then compare MAT layout to the .pds binary to infer .pds structure.

---

## Decoding and exporting to CSV

The **`pds_reader.py`** script decodes the binary time-series and exports to CSV (no file size limit).

### Usage

```bash
# Export to CSV (default: same name as .pds with .csv)
python pds_reader.py "Datasets/A.Clark-001.056.000.pds"

# Specify output path
python pds_reader.py "Datasets/A.Clark-001.056.000.pds" -o "output/session.csv"

# Custom delimiter (e.g. semicolon for Excel in some locales)
python pds_reader.py "Datasets/file.pds" --delimiter ";"
```

### What you get

- **Header**: Parsed from the file (magic, data size at offset 0x80). Header size = file size − data size.
- **Metadata**: Track, driver, and session comment when present (UTF-16 strings in header).
- **Time-series**: 320 bytes per record → **80 columns** of float32 values (`Channel_0` … `Channel_79`). Not every channel may be used; filter or ignore columns that are clearly invalid (e.g. huge or constant).
- **Rows**: One row per sample. Record count = data size ÷ 320 (partial last record is dropped).

Channel names are not yet mapped from the file (no public channel table); columns are named `Channel_0` … `Channel_79`. You can identify useful channels by value ranges (e.g. time, RPM, speed) and rename them in post-processing.

---

## Channel investigation (value ranges)

**`channel_investigate.py`** analyses each channel’s value range (min, max, mean, std, monotonic, integer-like) and suggests what the channel might be (Time, RPM, Speed, GPS, Throttle, etc.) using a built-in list of telemetry signatures.

### Usage

```bash
# From a PDS file (loads full data; can be slow on large files)
python channel_investigate.py "Datasets/A.Clark-001.056.000.pds"

# From an exported CSV (often faster)
python channel_investigate.py "Datasets/A.Clark-export.csv"

# Save report to CSV
python channel_investigate.py "Datasets/file.pds" -o report.csv

# Show alternative suggestions per channel
python channel_investigate.py "Datasets/file.csv" -v

# Exclude values with |v| > 1e6 from stats (default 1e8)
python channel_investigate.py "Datasets/file.pds" --threshold 1e6
```

### Output

- **Ch**: channel index  
- **Min / Max / Mean / Std**: computed on values with \|v\| ≤ threshold  
- **%Val**: percent of samples in that valid range  
- **Monot / Int**: monotonic (Y/N), integer-like (Y/N)  
- **Suggested**: best-matching signature (e.g. Time, RPM, GPS_Lat_deg) and score  

Signatures include: Time, RPM, Speed_kmh/mph, GPS_Lat/Lon (deg or rad), Throttle/Brake %, Lateral/Longitudinal_G, Gear, Lap_Count, Temp_C, Voltage, etc. Use `-o report.csv` to get a CSV of the same stats for further analysis.

---

## Files in this repo

- **`pds_reader.py`** — Decode .pds and export to CSV (all channels, no size limit).
- **`channel_investigate.py`** — Suggest channel types from value ranges (Time, RPM, Speed, GPS, etc.).
- **`pds_investigate.py`** — Inspect header, strings, and layout (debug/reverse-engineering).
- **`README_PDS.md`** — This file.
- **`Datasets/*.pds`** — Your Porsche 992.1 GT3 Cup session files.
