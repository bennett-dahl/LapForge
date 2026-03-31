---
description: Architecture reference for the LapForge platform. Read before making structural changes, adding tools, channels, or pipeline steps.
globs:
  - LapForge/**
  - frontend/**
---

# Architecture Reference

## Project Layout

```
LapForge/                              # Python backend (Flask JSON API)
  __init__.py                          # exports create_app
  app.py                               # create_app() factory, all API routes
  channels.py                          # channel registry: CHANNEL_SIGNATURES, detect_channels()
  processing.py                        # pipeline steps + process_session()
  session_store.py                     # SQLite: sessions, car_drivers, tire_sets, track_sections, comparisons
  models.py                            # dataclasses: Session, CarDriver, TireSet, TrackSection, etc.
  config.py                            # AppConfig, appdata path helpers
  parsers/
    __init__.py
    pi_toolbox_export.py               # Pi Toolbox .txt parser
  auth/
    oauth.py                           # OAuth blueprint, keyring token persistence
  sync/
    bundle.py                          # backup bundle creation/restore
    engine.py                          # sync state machine
    secrets.py                         # keyring helpers for sync tokens
    cloud_google.py                    # Google Drive client
  tools/                               # analysis tool plugins (auto-discovered)
    __init__.py                        # TOOL_REGISTRY, get_available_tools()
    tire_pressure.py                   # pressure chart tool
    track_map.py                       # GPS map tool (requires lat, lon)
    channel_chart.py                   # multi-channel chart tool
  static/
    style.css                          # shared CSS (legacy + SPA overrides)
    spa/                               # Vite build output (served by Flask)
      index.html
      assets/

frontend/                              # React + TypeScript SPA (Vite)
  src/
    main.tsx                           # entry point, BrowserRouter (dynamic basename)
    App.tsx                            # route definitions
    api/
      client.ts                        # apiGet, apiPost, apiPatch, apiDelete, apiUploadWithProgress
    types/
      api.ts                           # TypeScript interfaces for API responses
      models.ts                        # TypeScript interfaces mirroring Python models
      electron-api.d.ts                # Electron IPC type declarations
    contexts/
      CursorSyncContext.tsx            # shared cursor state (distance/time/zoom)
      UploadProgressContext.tsx         # upload progress tracking
    utils/
      units.ts                         # distance unit conversion helpers
    layouts/
      AppLayout.tsx                    # sidebar, nav, toast, global layout
    pages/
      IndexPage.tsx                    # home / dashboard
      SessionsPage.tsx                 # session list
      SessionDetailPage.tsx            # session detail with tabs (Analysis, Track Map)
      UploadPage.tsx                   # file upload + parse
      CarDriversPage.tsx               # car/driver management
      TireSetsPage.tsx                 # tire set management
      TrackLayoutsPage.tsx             # track layout management
      SettingsPage.tsx                 # app settings
      ComparePage.tsx                  # session comparison setup
      CompareDashboardPage.tsx         # comparison dashboard
    components/
      charts/
        TelemetryChart.tsx             # imperative Chart.js wrapper (zoom, crosshair, boundary drag)
        TirePressureChart.tsx          # tire pressure specific chart
      maps/
        TrackMap.tsx                    # Leaflet track map with cursor marker
      dashboard/
        Dashboard.tsx                  # dashboard grid with drag-resize modules
        LapBar.tsx                     # lap selection bar
        ChannelPickerModal.tsx         # channel/Y-axis picker modal
        DashboardTemplateModal.tsx     # save/load dashboard templates
        modules/
          ChartModule.tsx              # telemetry chart dashboard module
          MapModule.tsx                # map dashboard module
          ReadoutModule.tsx            # readout values module
          LapTimesModule.tsx           # lap times table module
          TireSummaryModule.tsx        # tire summary module
      tools/
        SectionEditor.tsx              # track section boundary editor (map + chart + table)
        TrackMapTool.tsx               # track map tool wrapper
        TirePressureTool.tsx           # tire pressure tool wrapper
        TirePressureChart.tsx          # tire pressure chart component
        ChannelChart.tsx               # multi-channel chart component
        SectionMetrics.tsx             # section timing/metrics display
      ui/
        Modal.tsx                      # reusable modal
        Button.tsx                     # reusable button
        ElectronUpdateToast.tsx        # auto-update notification
        GlobalUploadBar.tsx            # upload progress bar
      SyncPanel.tsx                    # Google Drive sync UI
      BackgroundTaskBar.tsx            # background task progress

electron/                              # Electron desktop shell
  main.js                              # main process: spawns Flask backend, loads SPA
  package.json                         # Electron + electron-builder config
  icons/                               # app icons
```

## Frontend Architecture

### Routing
- `BrowserRouter` with dynamic `basename` (dev: `/static/spa`, prod: empty)
- Flask serves `index.html` for all non-API routes; React Router handles client-side navigation
- Dev: Vite dev server proxies `/api/*`, `/upload` to Flask on port 5000

### State Management
- `CursorSyncContext` — shared cursor position (distance, time) and zoom range across all charts
  - `useCursorSync()` — subscribe to cursor updates (re-renders on cursor move)
  - `useCursorZoom()` — subscribe to zoom range changes only
  - `useCursorStore()` — direct store access for imperative reads (no re-render)
  - Pin/unpin cursor on chart click
- `UploadProgressContext` — SSE-based upload progress tracking
- `@tanstack/react-query` — for API data fetching and caching

### Chart System (`TelemetryChart.tsx`)
- Imperative Chart.js creation (not react-chartjs-2) to avoid React re-render loops
- Chart instance managed via `useRef`, data/options updated via separate `useEffect` hooks
- Plugins: `chartjs-plugin-zoom` (Hammer.js-based pan/zoom), `chartjs-plugin-annotation` (lap lines, section bands)
- Custom plugins: `cursorCrosshair` (crosshair line), `sectionBoundaryDrag` (section edge drag)
- Boundary drag uses native `pointerdown`/`pointermove`/`pointerup` listeners registered BEFORE Hammer.js to `stopImmediatePropagation()` and prevent pan conflicts

### Dashboard System
- `Dashboard.tsx` renders a configurable grid of modules (Chart, Map, Readout, LapTimes, TireSummary)
- Modules support drag-resize, channel selection, Y-axis grouping, custom colors
- Templates can be saved/loaded via `DashboardTemplateModal`

### Session Detail Page
- Two main tabs: **Analysis** (dashboard) and **Track Map** (section editor)
- `SessionInfoPanel` displays all session metadata including raw file metadata
- `SectionEditor` provides: Leaflet map with colored section overlay, telemetry chart with draggable section boundaries, scrollable sections table, auto-detect and regenerate controls

## Backend API Routes (Flask)

All API routes are under `/api/` prefix. Flask serves the SPA `index.html` for all non-API page routes.

Key endpoints:
- `GET /api/sessions/list` — session list with summaries
- `GET /api/sessions/<id>/detail` — full session data (channels, laps, dashboard data, summary)
- `POST /upload` — file upload with background processing
- `GET /api/task-status/<id>` — SSE stream for upload progress
- `PATCH /api/sessions/<id>/track-layout` — assign track layout
- `GET /api/sections/<track>/auto-detect` — auto-generate track sections
- CRUD routes for car-drivers, tire-sets, track-layouts, comparisons, dashboard-layouts, settings

## How to Add a Derived Channel

1. Write a pipeline step function in `processing.py`:
   ```python
   def compute_your_channel(ctx: dict) -> None:
       series = ctx["full_series"]
       speed = series.get("speed", [])
       derived = [...]
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
    "file_metadata": {...},              # raw Pi Toolbox OutingInformation
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

## Build & Deployment

- **Dev:** `npm run dev` (Vite on 5173+) + `python -m LapForge.app --port 5000` (Flask)
- **SPA build:** `cd frontend && npm run build` → outputs to `LapForge/static/spa/`
- **Production:** PyInstaller freezes Flask + SPA into a single executable; Electron shell loads it
- **CI:** GitHub Actions on `v*` tags — pytest, SPA build, PyInstaller, electron-builder, GitHub Release
- **Auto-update:** `electron-updater` checks GitHub Releases, gold notification toast

## Conventions

- Python: snake_case, type hints, dataclasses for models
- TypeScript/React: camelCase, functional components, hooks, strict mode
- CSS: shared styles in `static/style.css`, inline styles for component-specific layout
- Channel names: lowercase snake_case matching Pi Toolbox canonical names
- API responses: JSON, TypeScript interfaces in `frontend/src/types/`

## Anti-patterns

- Do NOT put processing/computation logic in route handlers — use `processing.py` pipeline steps
- Do NOT hardcode channel names in components — use `channelMeta` from the API
- Do NOT use `react-chartjs-2` — use imperative Chart.js via `useRef` to avoid re-render loops
- Do NOT load full parsed_data_json for list views — use session_summary_json
- Do NOT use `window.location.href` for navigation — use React Router's `useNavigate`
- Do NOT modify `tools/__init__.py` when adding a new tool — just create the module file
