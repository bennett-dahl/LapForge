---
description: Architecture reference for the LapForge platform. Read before making structural changes, adding tools, channels, or pipeline steps.
globs:
  - LapForge/**
---

# Architecture Reference

## Project Layout

```
LapForge/
  __init__.py                  # exports create_app
  app.py                       # create_app() factory, all routes, helpers
  channels.py                  # channel registry: CHANNEL_SIGNATURES, detect_channels()
  processing.py                # pipeline steps + process_session()
  session_store.py             # SQLite: sessions, car_drivers, tire_sets, track_sections, saved_comparisons
  models.py                    # dataclasses: Session, CarDriver, TireSet, TrackSection, etc.
  config.py                    # AppConfig, appdata path helpers
  parsers/
    __init__.py
    pi_toolbox_export.py       # Pi Toolbox .txt parser
  auth/
    oauth.py                   # OAuth blueprint, keyring token persistence
  sync/
    bundle.py                  # backup bundle creation/restore
    engine.py                  # sync state machine
    secrets.py                 # keyring helpers for sync tokens
    cloud_google.py            # Google Drive client
  blueprints/                  # reserved for future route extraction
  tools/                       # analysis tool plugins (auto-discovered)
    __init__.py                # TOOL_REGISTRY, get_available_tools()
    tire_pressure.py           # always-available pressure chart tool
    track_map.py               # GPS map (requires lat, lon)
    channel_chart.py           # multi-channel chart (always available)
  templates/
    base.html                  # shared layout, nav, links style.css
    session_detail.html        # tool sidebar + content area
    partials/                  # tool-specific template fragments
      tire_pressure.html
      track_map.html
      channel_chart.html
  static/
    style.css                  # all shared CSS (extracted from base.html)
    cursor-sync.js             # CursorSync: shared distance/time state
    telemetry-chart.js         # createTelemetryChart(): Chart.js wrapper
    map-widget.js              # createTrackMap(): Leaflet wrapper
```

## How to Add an Analysis Tool

1. Create `LapForge/tools/your_tool.py` with the required module-level attributes:
   ```python
   TOOL_NAME = "your_tool"            # URL parameter value
   DISPLAY_NAME = "Your Tool"         # sidebar display name
   REQUIRED_CHANNELS = ["speed"]      # tool hidden if any are missing
   OPTIONAL_CHANNELS = ["aps"]        # enhanced if present
   TEMPLATE = "partials/your_tool.html"
   SORT_ORDER = 40                    # sidebar display order

   def prepare_data(session_data: dict, options: dict) -> dict:
       # Transform session_data into what the template needs.
       # session_data is the full v2 stored blob.
       # options contains use_psi, target_psi, etc.
       return {"has_data": True, ...}
   ```

2. Create `LapForge/templates/partials/your_tool.html`:
   - Access `tool_data` (the dict from `prepare_data`) in the template.
   - Wrap in a `.card` div for consistent styling.

3. If the tool needs JS (chart, map, etc.), add a block in `session_detail.html`'s
   `{% block scripts %}` section, conditioned on `active_tool == 'your_tool'`.

4. Done. The tool auto-discovers via `tools/__init__.py`, appears in the sidebar
   for any session whose channels satisfy `REQUIRED_CHANNELS`.

## How to Add a Derived Channel

1. Write a pipeline step function in `processing.py`:
   ```python
   def compute_your_channel(ctx: dict) -> None:
       series = ctx["full_series"]
       # Read inputs
       speed = series.get("speed", [])
       # Compute derived values
       derived = [...]
       # Store result
       series["your_channel"] = derived
   ```

2. Insert it into `PIPELINE_STEPS` after `compute_derived`.

3. Add the channel signature to `channels.py` `CHANNEL_SIGNATURES`:
   ```python
   "your_channel": {"category": "derived", "unit": "m/s²", "display": "Your Channel", "color": "#..."},
   ```

4. The channel is now stored in every new session's blob, available to any tool.

## Channel Registry

- `channels.py` maps canonical column names to metadata: category, unit, display name, color.
- `detect_channels(columns)` matches parsed column names (case-insensitive) against known signatures.
- Unknown columns get `category="unknown"` with rotating colors — they are still stored and available.
- Categories: pressure, driver, accel, gps, timing, derived, unknown.

## Processing Pipeline

`processing.py` defines `PIPELINE_STEPS`, an ordered list of functions:

1. `normalize_channels` — extract columnar arrays from rows for ALL channels
2. `compute_distance` — from log_distance or speed integration
3. `compute_derived` — placeholder for curvature, brake zones, etc.
4. `smooth_pressure` — linear regression smoothing on pressure channels only
5. `downsample_for_charts` — reduce to ~2000 points
6. `build_reference_lap` — fastest lap GPS polyline
7. `build_summary` — lap count, fastest lap, channel inventory, pressure stats

Each step receives `ctx: dict` and mutates it in place. The context contains:
- `parsed` — raw parser output
- `smoothing_level` — 0 = default
- `full_times`, `full_series`, `full_distances` — full-resolution arrays
- `channel_meta` — from detect_channels
- After downsample: `times`, `series`, `distances`
- After summary: `summary`, `reference_lap`

## Stored Data Format (v2)

```python
{
    "processed": True,
    "version": 2,
    "smoothing_level": 0,
    "columns": [...],                    # all channel names
    "channel_meta": {...},               # name -> {category, unit, display, color}
    "lap_splits": [...],                 # session times at lap boundaries
    "lap_split_distances": [...],        # distances at lap boundaries
    "times": [...],                      # downsampled time array
    "distances": [...],                  # downsampled distance array
    "series": {"speed": [...], ...},     # downsampled channel arrays
    "reference_lap": {                   # fastest lap GPS (or null)
        "lap_index": 3,
        "lap_time": 98.4,
        "lat": [...], "lon": [...],
        "heading": [...], "distance": [...]
    },
    "summary": {
        "lap_count": 12,
        "fastest_lap_index": 3,
        "fastest_lap_time": 98.4,
        "has_gps": true,
        "available_categories": [...],
        "channel_list": [...],
        "pressure_summary_psi": {...},
        "pressure_summary_bar": {...}
    }
}
```

The `summary` is also stored in `session_summary_json` column for fast list queries.

## Client JS Modules

### CursorSync (`cursor-sync.js`)
- `window.CursorSync.subscribe(fn)` — fn receives `{distance, time}`
- `window.CursorSync.set({distance, time})` — update and notify
- `window.CursorSync.clear()` — reset to null

### createTelemetryChart (`telemetry-chart.js`)
- `window.createTelemetryChart(canvas, config)` returns Chart instance
- config: `{channels, xValues, xLabel, lapSplits, sections, target, yMin, yMax, onHover}`
- Auto-subscribes to CursorSync for crosshair sync

### createTrackMap (`map-widget.js`)
- `window.createTrackMap(container, config)` returns `{map, updateMarker, destroy}`
- config: `{polyline, heading, distances, lapSplits, sections}`
- Auto-subscribes to CursorSync for marker position

## Conventions

- Python: snake_case, type hints, dataclasses for models
- JavaScript: camelCase, globals on window (no bundler)
- Templates: partials in `templates/partials/`, one per tool
- Tools in `tools/`, one module per tool
- CSS: all shared styles in `static/style.css`, component-scoped inline only when necessary
- Channel names: lowercase snake_case matching Pi Toolbox canonical names

## Anti-patterns

- Do NOT put processing/computation logic in route handlers — use `processing.py` pipeline steps
- Do NOT hardcode channel names in templates — use channel_meta from the registry
- Do NOT duplicate Chart.js configuration — use `createTelemetryChart()` or the pattern in session_detail.html
- Do NOT load full parsed_data_json for list views — use session_summary_json
- Do NOT modify `tools/__init__.py` when adding a new tool — just create the module file
