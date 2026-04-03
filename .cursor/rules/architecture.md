---
description: Architecture reference for the LapForge platform. Read before making structural changes, adding tools, channels, pipeline steps, or build configuration.
globs:
  - LapForge/**
  - frontend/**
  - electron/**
  - .github/**
---

# LapForge Architecture Reference

## Project Layout

```
LapForge/                              # Python backend (Flask JSON API)
  __main__.py                          # entry point for python -m LapForge and PyInstaller
  __init__.py                          # re-exports create_app
  app.py                               # create_app() factory, all API routes and helpers
  channels.py                          # channel registry: CHANNEL_SIGNATURES, detect_channels()
  config.py                            # AppConfig, appdata path, OAuth credential resolution
  models.py                            # dataclasses: Session, CarDriver, TireSet, TrackSection, etc.
  processing.py                        # pipeline steps, process_session(), v2 blob assembly
  session_store.py                     # SQLite CRUD, migrations, uploads folder layout
  parsers/
    pi_toolbox_export.py               # Pi Toolbox Versioned ASCII parser
  auth/
    oauth.py                           # Google OAuth blueprint, keyring token persistence
  sync/
    bundle.py                          # local zip backup with SHA256 manifest
    engine.py                          # sync state machine (dirty detection, push/pull)
    secrets.py                         # keyring helpers, build_google_credentials()
    cloud_google.py                    # Google Drive client, content-addressed blob storage
  tools/                               # analysis tool plugins (auto-discovered)
    __init__.py                        # TOOL_REGISTRY, get_available_tools()
    tire_pressure.py                   # pressure chart + summary tool
    track_map.py                       # GPS map tool (requires lat, lon)
    channel_chart.py                   # multi-channel chart tool
    section_generator.py               # curvature-based corner/section auto-detection
    section_metrics.py                 # per-section timing stats vs reference lap
  static/
    style.css                          # shared CSS (legacy + SPA overrides)
    spa/                               # Vite build output (served by Flask)
      index.html
      assets/

frontend/                              # React + TypeScript SPA (Vite)
  src/
    main.tsx                           # QueryClient, BrowserRouter (dynamic basename), mount
    App.tsx                            # route definitions, global providers
    api/
      client.ts                        # apiGet/Post/Patch/Put/Delete, apiUploadWithProgress
    types/
      api.ts                           # TypeScript interfaces for all API responses
      models.ts                        # TypeScript interfaces mirroring Python models
      electron-api.d.ts                # window.electronAPI type declarations
    contexts/
      CursorSyncContext.tsx            # shared cursor position, zoom, and map distance
      UploadProgressContext.tsx        # global upload/processing progress
    utils/
      units.ts                         # unit conversion helpers (pressure, temp, speed, distance)
    layouts/
      AppLayout.tsx                    # sidebar nav, auth snippet, Outlet
    pages/
      IndexPage.tsx                    # home / quick links
      SessionsPage.tsx                 # session list, filter, compare selection
      SessionDetailPage.tsx            # multi-tool analysis hub (dashboard, track map, metrics, info)
      UploadPage.tsx                   # file upload + parse flow
      CarDriversPage.tsx               # car/driver CRUD
      TireSetsPage.tsx                 # tire set CRUD
      TrackLayoutsPage.tsx             # track layout management
      SettingsPage.tsx                 # app settings, backup, sync
      ComparePage.tsx                  # comparison setup
      CompareDashboardPage.tsx         # multi-session comparison dashboard
    components/
      charts/
        TelemetryChart.tsx             # imperative Chart.js wrapper (zoom, crosshair, boundary drag)
        TirePressureChart.tsx          # tire pressure specific chart
      maps/
        TrackMap.tsx                   # Leaflet track map with cursor marker and section overlays
      dashboard/
        Dashboard.tsx                  # configurable module grid
        LapBar.tsx                     # proportional lap selection tabs
        ChannelPickerModal.tsx         # channel/Y-axis picker
        DashboardTemplateModal.tsx     # save/load dashboard templates
        modules/
          ChartModule.tsx              # telemetry chart module (multi-Y-axis, smoothing)
          MapModule.tsx                # map module
          ReadoutModule.tsx            # values-at-cursor module
          LapTimesModule.tsx           # lap times table + exclude lap checkboxes
          TireSummaryModule.tsx        # tire pressure summary module
      tools/
        SectionEditor.tsx              # section boundary editor (map + chart + table)
        SectionMetrics.tsx             # lap x section timing matrix, improvement ranking
        TrackMapTool.tsx               # thin wrapper around TrackMap
        TirePressureTool.tsx           # thin wrapper around TirePressureChart
        ChannelChart.tsx               # thin wrapper around TelemetryChart
      ui/
        Modal.tsx                      # reusable overlay modal
        Button.tsx                     # variant/size button primitive
        ElectronUpdateToast.tsx        # auto-update notification
        GlobalUploadBar.tsx            # upload progress bar
      SyncPanel.tsx                    # Google Drive sync UI (streaming SSE)
      BackgroundTaskBar.tsx            # background task progress (available, not currently mounted)

electron/                              # Electron desktop shell
  main.js                              # main process: backend spawn, windows, updater, IPC, menu
  preload.js                           # contextBridge: exposes window.electronAPI to renderer
  package.json                         # Electron + electron-builder config
  icons/                               # app icons (icon.ico used by PyInstaller + installer)
```

---

## Backend

### config.py

`AppConfig` lives in the OS app-data folder (not the data root), so it survives data-folder moves.

- **`_appdata_dir()`** resolves `%APPDATA%\LapForge` (Windows) or `$XDG_CONFIG_HOME/LapForge`; migrates legacy `RaceDataAnalysis` folder on first run.
- **`AppConfig`** fields: `device_id` (stable UUID), `flask_secret_key`, `data_root` (optional user-chosen DB/uploads folder; `None` = default), Google OAuth keys, profile registry.
- **OAuth credential resolution order:** environment variable → `config.json` → bundled `LapForge/_build_defaults.json` (injected at CI build time from GitHub secrets; gitignored locally).
- **Profile registry** (`get_profile` / `set_profile`): stores display metadata (email, name, picture) keyed by a stable SHA256 hash of `iss|sub`, so no PII is used as a primary key.

### models.py

All domain types as dataclasses (plus `SessionType` enum). Every type has `to_dict()` / `from_dict()` for JSON serialization.

| Type | Key Fields |
|------|-----------|
| `SessionType` | Enum: Practice 1-3, Qualifying, Race 1-2 |
| `CarDriver` | `id`, `car_identifier`, `driver_name` |
| `TireSet` | `id`, `name`, `car_driver_id`, four morning pressures (bar) |
| `Session` | Full session row + `parsed_data` (v2 blob), `file_path` to original export |
| `Weekend` | Named group of `session_ids` (race weekend ordering) |
| `TrackSection` | `name`, `start_distance`, `end_distance`, `section_type` (auto/manual), `corner_group` |
| `TrackLayout` | `id`, `name`, `track_name`, `reference_lap_json`, source provenance fields |
| `SavedComparison` | `id`, `name`, list of `session_ids` |

### session_store.py

SQLite persistence at `{data_root}/race_data.db`, uploads at `{data_root}/uploads/`.

**Default data root:** `%APPDATA%\LapForge\data` (or XDG equivalent). Overridden by `AppConfig.data_root`; the store is re-created when the user changes data location.

**Tables:**

| Table | Purpose |
|-------|---------|
| `car_drivers` | Car/driver identity records |
| `tire_sets` | Named tire sets with morning pressures |
| `sessions` | Full session metadata + `parsed_data_json` blob + `session_summary_json` (fast list queries) |
| `weekends` | Named weekend groupings of sessions |
| `saved_comparisons` | Named comparison sets with optional `dashboard_layout_json` |
| `track_sections` | Per-track section definitions (distance intervals) |
| `track_layouts` | Saved GPS map geometry (reference lap polylines) |
| `dashboard_templates` | Reusable dashboard layout templates |

**Migration system (`_migrate`):** Additive only -- adds missing columns and tables, normalizes legacy data. Notable migrations: add `session_summary_json` for fast list queries; add `target_pressure_psi`; normalize `file_path` from absolute to relative; expand `track_layouts` with source provenance columns; migrate `track_layouts` PK from `track_name` to a UUID `id`.

**Key helpers:**
- `resolve_file_path(session)` -- joins relative `file_path` to `data_root` for reading original exports.
- `normalize_track_key(name)` -- strip + casefold; used for section and layout lookup so "Sonoma" and "sonoma " match.
- Per-session and per-comparison `dashboard_layout_json` get/save for persistent layout state.

### channels.py

Canonical registry for telemetry channel names from Pi Toolbox exports.

- **`CHANNEL_SIGNATURES`** -- dict mapping canonical column names to `{category, unit, display, color}`.
- **`detect_channels(columns)`** -- for each parsed column, tries exact then case-insensitive match; unknown columns get `category="unknown"` with rotating colors and are still stored/available.
- **`categorize_channels(channel_meta)`** -- groups column names by category.
- **Categories:** `pressure`, `driver`, `accel`, `gps`, `timing`, `derived`, `unknown`.
- **`get_available_tools(session_data)`** -- marks each tool `available` if its `REQUIRED_CHANNELS` exist either by canonical name or by `(category, display)` alias match (handles `NMEA_Lat` vs `lat`, etc.).

### parsers/pi_toolbox_export.py

Parses Pi Toolbox **Versioned ASCII** export files (`.txt`).

- **File structure:** `{OutingInformation}` header block → channel header row → TSV data rows.
- **`load_pi_toolbox_export(path)`** -- full parse: validates format, reads metadata, builds per-row dicts with canonical names, extracts `lap_split_times` from laptime column resets, adds `lap_index` per row, appends `*_psi` columns for any TPMS bar columns.
- **`read_file_metadata(path)`** -- fast header-only read for upload preview (no data rows).
- **`_canonical_name(header)`** -- strips `*` prefix and `[unit]` suffix.

### processing.py

Replaces per-session monolithic processing with a **shared-context pipeline** producing reusable **v2 `parsed_data` blobs**.

**Constants:** `PIPELINE_VERSION` (bumped when output format changes), `CHART_MAX_POINTS` (downsampling target), `BAR_TO_PSI`.

**Pipeline steps (in order):**

| Step | What it does |
|------|-------------|
| `normalize_channels` | Extracts columnar arrays from `parsed["rows"]`; picks time column; builds `full_times`, `full_series`, `columns`, `channel_meta` via `detect_channels` |
| `compute_distance` | Prefers `log_distance` / variants; falls back to speed integration with lap-boundary resets; builds `lap_split_distances` |
| `compute_derived` | Placeholder (no-op currently) for future derived channels |
| `smooth_pressure` | Linear-regression smoothing on pressure category only; copies raw into `raw_pressure` for UI-controlled smoothing levels |
| `downsample_for_charts` | Caps `times`/`series`/`distances` at `CHART_MAX_POINTS`; preserves `raw_pressure_chart` for smoothing slider |
| `build_reference_lap` | Honors `map_lap_segment_index` if set; else selects fastest "valid" lap; applies `_smooth_gps_trace`, builds `reference_lap` dict |
| `build_summary` | Lap count, fastest lap, GPS flag, channel list, `pressure_summary_psi` / `pressure_summary_bar` |

**Stage groupings (`STAGES`):** `core` / `track_map` / `summary` -- weighted for progress UI; each stage has a version number stored in the blob for incremental reprocessing.

**Public API:**
- `process_session(parsed, ...)` -- full pipeline, returns v2 blob.
- `process_session_streaming(parsed, ...)` -- generator yielding `(pct, label, result)` for SSE progress.
- `process_session_incremental(session, ...)` -- if only non-core stages are stale, rebuilds context from existing blob and reruns from the first stale stage; triggers full streaming reprocess if core is stale.
- `stale_stages(blob)` / `needs_reprocess(blob)` -- compare stored `stage_versions` and `pipeline_version` against current constants.
- `sanitize_for_json(obj)` -- replaces `NaN`/`Inf` with `None` for safe JSON serialization.

**v2 blob shape** (stored in `sessions.parsed_data_json`):

```python
{
    "processed": True,
    "version": 2,
    "pipeline_version": 7,
    "stage_versions": {"core": ..., "track_map": ..., "summary": ...},
    "smoothing_level": 0,
    "columns": [...],
    "channel_meta": {"speed": {"category": "driver", "unit": "km/h", ...}, ...},
    "file_metadata": {...},          # raw Pi Toolbox OutingInformation
    "lap_splits": [...],             # session time at each lap boundary
    "lap_split_distances": [...],    # session distance at each lap boundary
    "times": [...],                  # downsampled time array
    "distances": [...],              # downsampled distance array
    "distances_raw": [...],          # raw (non-smoothed) distance array
    "series": {"speed": [...], ...}, # downsampled channel arrays
    "raw_pressure": {...},           # raw pressure per channel (for adjustable smoothing)
    "reference_lap": {
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

The `summary` is also extracted into `session_summary_json` for fast list queries without loading the full blob.

### auth/oauth.py

Google OAuth 2.0 with Authlib.

- **`init_oauth(app)`** -- if `GOOGLE_CLIENT_ID` is absent, sets `OAUTH_ENABLED = False` (app still works, sync disabled). Otherwise registers an Authlib Google client with OpenID Discovery, scopes `openid email profile drive.file`, PKCE S256.
- **Blueprint routes:** `/auth/login` (redirect to Google), `/auth/callback` (exchange code, store token, set session), `/auth/logout` (clear session + keyring).
- **`_derive_user_key(id_token_claims)`** -- SHA256 of `"{iss}|{sub}"` for a stable, opaque keyring key.
- **Token storage** -- via `keyring` service `"LapForge"`, account `"oauth:{user_key}"`. Stores the refresh token; access tokens are re-fetched on demand.
- **`AppConfig.set_profile`** -- persists display metadata (email, name, picture) from the id_token after login.

### sync/

**`bundle.py`** -- local zip backup (no Drive required):
- **`build_manifest(data_root)`** -- SHA256 inventory of `race_data.db`, `preferences.json`, all `uploads/*` files.
- **`build_bundle(data_root, dest_path)`** -- SQLite **online backup** API into zip + manifest JSON; optional progress callback.
- **`restore_bundle(zip_path, data_root)`** -- extract; skip files whose hash matches manifest (idempotent); restore DB via backup API into place.

**`engine.py`** -- sync state machine:
- **`sync_state.json`** in `data_root`: last manifest id/timestamp, local DB hash, upload hashes, preferences hash.
- **`detect_status()`** -- compares local hashes vs state vs remote `latest.json`; returns `SyncStatus` (CLEAN, LOCAL_AHEAD, REMOTE_AHEAD, DIVERGED).
- **`do_push(data_root, creds)` / `do_pull(data_root, creds)`** -- orchestrate `DriveClient` and update `sync_state.json`.

**`cloud_google.py` -- `DriveClient`:**
- **Drive folder tree:** `LapForgeBackup/` → `latest.json`, `manifests/`, `db/`, `uploads/`, `preferences/`.
- **Content-addressed storage:** files stored as `<sha256>.ext` -- only new blobs are uploaded; existing hashes are skipped.
- **`push_iter(data_root)`** -- yields progress events; skips already-uploaded files; writes new manifest; updates `latest.json`.
- **`pull_iter(data_root)`** -- downloads by manifest; DB restored via temp + SQLite backup; yields `manifest` event on completion.

**`secrets.py`** -- keyring helpers mirroring `auth/oauth.py`; `build_google_credentials()` constructs `google.oauth2.credentials.Credentials` from the stored refresh token + client id/secret for Drive API calls.

### tools/ plugin system

**Discovery (`__init__.py`):** `_discover_tools()` imports all sibling modules (excluding `_` prefix), requires each to export `TOOL_NAME`, `DISPLAY_NAME`, `REQUIRED_CHANNELS`, `TEMPLATE`, optional `SORT_ORDER`. Builds `TOOL_REGISTRY` sorted by `SORT_ORDER`.

**Tool contract:**
- `REQUIRED_CHANNELS` -- list of canonical channel names or `(category, display)` tuples; `get_available_tools()` uses this to mark tools available/unavailable per session.
- `prepare_data(session_data, options)` -- transforms v2 blob data into tool-specific shape.

**Tool modules:**

| Module | Tool | Required channels | Role |
|--------|------|-------------------|------|
| `tire_pressure.py` | Tire Pressure | none (optional TPMS) | Chart + summary from v2 series/summary; PSI vs bar toggle |
| `track_map.py` | Track Map | `lat`, `lon` | Leaflet polyline from `reference_lap` |
| `channel_chart.py` | Channel Charts | none | Multi-channel chart data, category presets |
| `section_generator.py` | Track Sections | `lat`, `lon` | Curvature-based corner detection → section list; powers auto-detect API |
| `section_metrics.py` | Section Metrics | `speed` | Per-section stats vs reference lap; needs distances + sections |

### app.py

Flask application factory and API surface.

**Factory (`create_app`):**
- Reads `AppConfig` for secret key, `data_root`, OAuth credentials.
- Creates `SessionStore` attached as `app.store`.
- Registers OAuth blueprint.
- Initializes thread-safe `_bg_tasks` dict for upload progress tracking.
- Sets up `PREFERENCES_PATH = {data_root}/preferences.json` with `_get_preferences()` / `_save_preferences()`.

**Context processors:**
- `inject_auth` -- `current_user`, `oauth_enabled` for templates.
- `inject_unit_defaults` -- query args override preferences for pressure/temp/distance units.

**Helper function clusters (all nested inside `create_app`):**

| Cluster | Key helpers |
|---------|------------|
| File resolution | `_resolve_fp`, `_get_parsed_for_session` (blob or re-parse from file) |
| Dashboard assembly | `_build_dashboard_data` (main detail blob for SPA: lap times, excluded laps, sections, GPS, raw pressure), `_build_chart_data_v2`, `_session_layout_meta` |
| GPS helpers | `_gps_points_from_reference_lap`, `_gps_points_with_session_distance`, `_reference_lap_has_geometry` |
| Session mutation | `_apply_excluded_laps_to_session`, `_apply_reference_lap_to_session` (updates blob + optional track_layouts row) |
| Preferences/units | `_session_target_psi`, `_safe_float`, temp helpers |

**Route groups:**

| Group | Routes |
|-------|--------|
| SPA catch-all | `/`, `/settings`, `/car-drivers`, `/sessions`, `/upload`, `/sessions/<id>`, `/compare`, `/compare/<id>`, `/track-layouts` -- all serve `static/spa/index.html` |
| Data location | `POST /api/data-location` -- move/switch `data_root`, recreate store |
| Backup | `POST /api/backup/export`, `POST /api/backup/restore` |
| Sync | `GET /api/sync/status`, `GET /api/sync/files`, `POST /api/sync/push` (SSE), `POST /api/sync/pull` (SSE) |
| Upload | `POST /upload` (phase 1: parse preview; phase 2 with `save=1`: background processing + persist), `GET /api/upload-status/<task_id>` (SSE), `GET /api/upload-tasks`, `POST /api/upload-dismiss/<task_id>` |
| Track sections | `GET/POST /api/sections/<track>`, `GET .../auto-detect?session_id=`, `DELETE .../<section_id>` |
| Track layouts | `POST /api/track-layouts`, `PATCH/DELETE /api/track-layouts/<id>`, `PATCH /api/sessions/<id>/track-layout`, `GET /api/track-layouts` |
| Comparisons | `GET/POST /api/comparisons`, `PATCH/DELETE /api/comparisons/<id>`, session add/remove, `GET /api/comparisons/<cid>/dashboard-data` |
| Dashboard | `GET/PUT /api/sessions/<id>/dashboard-layout`, `GET/PUT /api/comparisons/<id>/dashboard-layout` |
| Dashboard templates | CRUD `/api/dashboard-templates` |
| Session CRUD | `GET /api/sessions/list`, `GET /api/sessions-full`, `GET /api/sessions/<id>/detail`, `PATCH /api/sessions/<id>`, `DELETE /api/sessions/<id>`, `POST /api/sessions/<id>/reprocess` (SSE), `/api/sessions/<id>/excluded-laps`, `/api/sessions/<id>/reference-lap` |
| Config entities | CRUD for `/api/car-drivers`, `/api/tire-sets` |
| Settings / auth | `GET/PATCH /api/settings`, `GET /api/auth/user` |

---

## Frontend

### Routing

`BrowserRouter` with **dynamic `basename`**: `/static/spa` in dev (Vite serves under that path), empty string in production (Flask serves at `/`). All primary routes use `AppLayout` as a shell with `Outlet`.

Route table: `/` → Index, `/sessions` → Sessions, `/sessions/:id` → SessionDetail, `/upload` → Upload, `/settings` → Settings, `/compare` → Compare, `/compare/:id` → CompareDashboard, `/car-drivers` → CarDrivers, `/tire-sets` → TireSets, `/track-layouts` → TrackLayouts.

### API client (api/client.ts)

All helpers use same-origin relative paths (`BASE = ''`). All throw `Error` with the server's `error` field on non-2xx.

- `apiGet<T>`, `apiPost<T>`, `apiPatch<T>`, `apiPut<T>`, `apiDelete<T>`
- `apiUpload<T>(path, formData)` -- POST without Content-Type (browser sets multipart boundary).
- `apiUploadWithProgress<T>(path, formData, handlers?)` -- XHR-based with `xhr.upload` progress events; `handlers.onProgress(loaded, total)`, `handlers.onUploadComplete()`.

### Type system

**`types/models.ts`** -- domain entities: `CarDriver`, `TireSet`, `Session`, `Weekend`, `TrackSection`, `TrackLayout`, `SavedComparison`, `SessionType` enum, `DashboardTemplate`, `DashboardModule`, `UserInfo`, `Preferences`.

**`types/api.ts`** -- response DTOs for every API endpoint group.

**`types/electron-api.d.ts`** -- `ElectronAPI` interface; `declare global { window.electronAPI?: ElectronAPI }`. Available only when running inside Electron.

### CursorSyncContext

Synchronizes cursor X position, optional map distance, and shared X-axis zoom range across all charts and maps without causing re-renders everywhere.

**Implementation:** Module-scoped store (not React state) per `CursorSyncProvider`. Uses `subscribe` / `getSnapshot` pattern.

**State:** `distance`, `time`, `mapDistance`, `xMin`, `xMax`, `pinned`.

**Three hooks with different subscription granularity:**
- `useCursorSync()` -- full snapshot; re-renders on any state change. Use in components that display cursor values.
- `useCursorZoom()` -- subscribes only to `xMin`/`xMax`; re-renders only on zoom changes. Use in charts that need zoom sync but should not flicker on cursor hover.
- `useCursorStore()` -- no subscription; direct imperative access. Use for cursor set/get inside chart event handlers to avoid re-render loops.

**Pinning:** Chart click pins the cursor (locks position); double-click resets zoom and clears pin.

### UploadProgressContext

Global upload/processing state with `localStorage` persistence (key `bg_upload`) so progress survives page navigation.

Methods: `startUpload`, `updateProgress`, `completeUpload` (forces "Processing..." state), `failUpload`, `dismiss`.

### TelemetryChart (components/charts/TelemetryChart.tsx)

The primary chart component. Uses **imperative Chart.js** (not `react-chartjs-2`) to avoid React re-render loops caused by chart mutation.

- **Chart.js plugins registered once at module load:** `chartjs-plugin-zoom` (Hammer.js pan/zoom), `chartjs-plugin-annotation` (lap lines, section bands).
- **Custom plugins:** `cursorCrosshair` (vertical line at cursor position), `sectionBoundaryDrag` (drag section edges on chart).
- **Boundary drag uses native `pointerdown`/`pointermove`/`pointerup` listeners registered BEFORE Hammer.js** via `stopImmediatePropagation()` to prevent pan/drag conflicts.
- **Cursor integration:** hover → `setCursor(distance, time)`; chart click → `pinCursor` / `unpinCursor`; subscribes via `useCursorStore()` (no re-render).
- **Zoom/pan:** X-axis only; Ctrl+wheel to zoom; pan/zoom completion calls `setXRange(min, max)` to share zoom state via `useCursorZoom()`.
- **Props:** `xValues`, `channels` (`label`, `data`, `color?`, `yAxisID?`), `lapSplits`, `sections` (box annotations), `target` (horizontal line), `xRange`, `onBoundaryDrag`, `yOverrides`, `yScaleTitles`, `yAxisColors`, `distanceDisplayUnit`, `onUserZoom`, `disableClickPin`.

### TrackMap (components/maps/TrackMap.tsx)

- **Stack:** `react-leaflet` + Leaflet + `leaflet.css`.
- **Features:** OSM/satellite base layers; Chaikin smoothing on polyline; section polylines colored by section; lap split markers; `CursorMarker` component.
- **`CursorMarker`:** reads `distance` / `mapDistance` from `useCursorSync()`; interpolates lat/lng along `points`; supports **lap wrapping** via `lapSplitDistances` + `lapLength` (converts session-cumulative distance to local-within-lap distance). Map click → `setCursor` with nearest point's distance.

### Dashboard system (components/dashboard/)

**`Dashboard.tsx`** -- configurable module grid.
- Modules: `ChartModule`, `MapModule`, `ReadoutModule`, `LapTimesModule`, `TireSummaryModule`.
- Each module has configurable width (`full` / `half` / `third` / `quarter`), drag-resize handles, and a header with controls.
- Layout persisted to **`localStorage` key `dashboard_layout_{sessionId}`** and synced to server via `onLayoutChange` (parent calls `PUT /api/sessions/<id>/dashboard-layout`).
- LapBar zoom calls `setXRange(min, max)` on `useCursorStore()` to sync zoom across all charts.

**`ChartModule.tsx`** (most complex module):
- Maps channel keys → `TelemetryChart` with unit conversion.
- **Multi-Y-axis grouping:** channels assigned to Y-axis groups; each group has an independent scale, label, and color. Helpers: `normalizeYAxisGroups`, `groupsToChannelAxisIndex`, `addYAxisGroup`, `removeLastYAxisGroup`, `compactYAxisConfig`.
- **Moving-average pressure smoothing:** 5 levels (`SMOOTH_LEVELS`); uses `raw_pressure_series` from dashboard data so smoothing is purely client-side with no re-fetch.
- **`ChartYAxisHeaderButton`:** portal-based UI for axis assignment and scale override limits.

**`DashboardData` interface** (exported from `Dashboard.tsx`): the rich data shape passed from `SessionDetailPage` to `Dashboard`; includes `times`, `distances`, `series`, lap metadata, GPS points, `tire_summary`, `raw_times` / `raw_distances` for full-resolution section metrics, comparison `sessions`, etc.

### SectionEditor (components/tools/SectionEditor.tsx)

Edits track sections combining map, telemetry chart, and table.

- Local `sections` state derived from props.
- "Split at cursor" reads `useCursorStore().getSnapshot().distance`.
- **Save:** `POST /api/sections/:trackName` with `{ sections }`.
- **Auto-detect:** `GET /api/sections/:trackName/auto-detect?session_id=`.
- **Apply map lap:** calls parent `onApplyReferenceLap` which triggers `PATCH /api/sessions/<id>` with `apply_reference_lap_index`.
- Chart uses `disableClickPin` so clicking sets a split point rather than pinning the cursor.

### SectionMetrics (components/tools/SectionMetrics.tsx)

Client-only analysis -- no additional API calls after initial data load.

- Builds a lap × section matrix: for each lap, finds the time/distance sub-range within each section boundary, calculates duration and optional channel stats.
- **Virtual best:** minimum section time across all non-excluded laps, summed for a theoretical best lap.
- **Improvement opportunities:** sections with the largest average delta from fastest lap, ranked descending; shows "Avg. Δ +X.XXXs".
- Honors `excludedLaps` (segment indices) from parent state.

### Pages

| Page | Primary data | Key mutations |
|------|-------------|--------------|
| `SessionsPage` | `GET /api/sessions-full` | `DELETE /api/sessions/:id` |
| `SessionDetailPage` | `GET /api/sessions/:id/detail`, `GET /api/sessions/:id/dashboard-layout`, `GET /api/settings` | `PATCH /api/sessions/:id`, `PUT /api/sessions/:id/dashboard-layout`, `POST /api/sessions/:id/reprocess`, `POST /api/sections/:track` |
| `UploadPage` | `GET /api/car-drivers` | `POST /upload` (XHR with progress), `GET /api/upload-status/:taskId` (SSE polling) |
| `SettingsPage` | `GET /api/settings` | `PATCH /api/settings`, `POST /api/data-location`, `POST /api/backup/export`, `POST /api/backup/restore` |
| `ComparePage` | `GET /api/comparisons`, `GET /api/sessions/list` | `POST /api/comparisons`, `DELETE /api/comparisons/:id` |
| `CompareDashboardPage` | `GET /api/comparisons/:id/dashboard-data` | `DELETE /api/comparisons/:id/sessions/:sessionId`, `PUT .../dashboard-layout` |
| Other CRUD pages | Respective `GET /api/...` list | Create / PATCH / DELETE via respective endpoints |

### State management summary

| Pattern | Where used |
|---------|-----------|
| TanStack Query (`useQuery` / `useMutation`) | All server data; `staleTime: 30s`, `retry: 1` |
| Optimistic cache updates (`setQueryData`) | `excludeMut` in `SessionDetailPage` (excluded laps) |
| Query invalidation (`invalidateQueries`) | After mutations that change server data |
| `localStorage` | Sidebar collapse, per-session dashboard layout, upload progress recovery, unit preferences |
| `CursorSyncContext` external store | Cursor position, zoom range, map distance -- shared without re-render overhead |
| `UploadProgressContext` | Global upload/processing state |
| Local `useState` | Modals, drag indices, form state, template open state |

**Do not add a separate `useState` alongside a React Query cache entry for the same data.** Dual state causes synchronization races (the excluded-laps revert bug). Derive from the cache with `useMemo`, or update the cache directly with `setQueryData`.

---

## Electron Shell

### main.js

**Single-instance lock:** `app.requestSingleInstanceLock()` -- second instance quits immediately; first instance restores its window.

**Beta data directory:** if `package.json` `name === 'lapforge-beta'`, `app.setPath('userData', ...)` is called before `app.whenReady` so all Electron state (including the Flask data root default) lands in `%APPDATA%\LapForge Beta`.

**Backend spawning (`startBackend`):**
- Dev mode: no spawn; expects Flask already running on port 5000.
- Packaged: `process.resourcesPath/backend/LapForge.exe` (PyInstaller bundle placed by electron-builder `extraResources`).
- Source run: `../dist/backend/LapForge.exe`.
- Args: `--production --port 0` (port 0 = OS assigns a free port).
- Ready detection: watches stdout for `FLASK_READY:port=(\d+)`.
- Shutdown: `SIGTERM` → wait → `SIGKILL` after 5s.

**Windows:** frameless transparent splash window → hidden main window; main window shown on `ready-to-show`; splash destroyed simultaneously.

**Auto-updater (`electron-updater`):**
- `autoDownload: true`, `autoInstallOnAppQuit: true`.
- Skipped in dev or when not packaged.
- Events mapped to `mainWindow.webContents.send('update-status', payload)` for the renderer.
- `userInitiatedCheck` flag controls whether "no update" / error conditions show dialogs.

**IPC channels:**

| Channel | Direction | Action |
|---------|-----------|--------|
| `install-update` | renderer → main | `quitAndInstall` |
| `check-for-updates` | renderer → main | Triggers update check |
| `get-last-update-status` | renderer → main | Re-sends stored status |
| `show-about` | renderer → main | About dialog with version info |
| `update-status` | main → renderer | Push update state to UI |

### preload.js

Exposes `window.electronAPI` via `contextBridge` (no raw Node access in renderer):
`platform`, `isElectron`, `appVersion`, `onUpdateStatus(cb)`, `installUpdate()`, `checkForUpdates()`, `requestLastUpdateStatus()`, `showAbout()`.

---

## Build and Deployment

### Development workflow

```
Vite dev server (:5173) ──proxy /api*──► Flask (:5000)
                                          (python -m LapForge.app)
Electron (--dev) ──────────────────────► Flask (:5000)
```

Use `.\dev-restart.ps1` to rebuild the SPA and restart Flask in one step. Pass `-SkipBuild` for backend-only changes.

### Production build chain

```
1. npm run build:spa (Vite)
        │ outDir: LapForge/static/spa/
        │ base: /static/spa/
        ▼
2. python -m PyInstaller LapForge.spec
        │ bundles: __main__.py + all deps + LapForge/static/ + _build_defaults.json
        │ output: dist/backend/LapForge.exe
        ▼
3. electron-builder --win --publish always
        │ copies dist/backend → resources/backend (extraResources)
        │ NSIS installer → dist/electron/
        │ publishes to GitHub Release
```

### CI: Stable channel (`build.yml`)

- **Trigger:** `push` of tags matching `v*` (e.g. `v1.7.0`)
- **Steps:** checkout → Python 3.10 + Node 20 → `pip install -r requirements.txt` → `pytest` (≥50% coverage) → `npm run build:spa` → inject `_build_defaults.json` from secrets → PyInstaller → verify `dist/backend/LapForge.exe` → `npm ci` in `electron/` → `electron-builder --win --publish always`
- **Output:** Full **GitHub Release** with NSIS installer + `latest.yml` for electron-updater

### CI: Beta channel (`build-beta.yml`)

- **Trigger:** `push` of tags matching `v*-beta*` (e.g. `v2.0.0-beta.1`)
- **Same steps as stable, plus two extra steps after checkout:**
  1. **Patch `electron/package.json`** (PowerShell): sets `name` = `lapforge-beta`, `version` from tag, `build.appId` = `com.lapforge.beta`, `build.productName` = `LapForge Beta`, `build.nsis.shortcutName` = `LapForge Beta`, `build.publish[0].releaseType` = `prerelease`
  2. **Patch `LapForge.spec`**: replaces `name='LapForge'` → `name='LapForgeBeta'` so the process is distinguishable in Task Manager
- **Output:** **GitHub Pre-release** with separate NSIS installer; electron-updater on beta installs only tracks pre-releases

### Beta vs stable coexistence

| Aspect | Stable | Beta |
|--------|--------|------|
| `appId` | `com.lapforge.app` | `com.lapforge.beta` |
| `productName` | `LapForge` | `LapForge Beta` |
| User data directory | `%APPDATA%\LapForge` | `%APPDATA%\LapForge Beta` |
| Process name | `LapForge.exe` | `LapForgeBeta.exe` |
| Updater feed | GitHub Releases (full) | GitHub Releases (pre-releases only) |
| Start Menu shortcut | `LapForge` | `LapForge Beta` |

### Version numbering

| Channel | Tag pattern | Example | Semver in package.json |
|---------|------------|---------|------------------------|
| Stable | `v<major>.<minor>.<patch>` | `v1.7.0` | `1.7.0` |
| Beta | `v<major>.<minor>.<patch>-beta.<n>` | `v2.0.0-beta.1` | `2.0.0-beta.1` |

electron-updater uses semver: `2.0.0-beta.2 > 2.0.0-beta.1`, so beta users auto-update within the channel.

### Releasing

```powershell
# Stable
git checkout main
git tag v1.7.0
git push origin main --tags

# Beta (from beta branch)
git checkout beta
git tag v2.0.0-beta.1
git push origin beta --tags
```

---

## How to Add a Derived Channel

1. Write a pipeline step function in `processing.py`:
   ```python
   def compute_your_channel(ctx: dict) -> None:
       series = ctx["full_series"]
       speed = series.get("speed", [])
       series["your_channel"] = [x * 2 for x in speed]  # example
   ```

2. Insert it into `PIPELINE_STEPS` after `compute_derived`.

3. Add the channel signature to `channels.py` `CHANNEL_SIGNATURES`:
   ```python
   "your_channel": {"category": "derived", "unit": "m/s²", "display": "Your Channel", "color": "#abc123"},
   ```

4. The channel is now stored in every new (or reprocessed) session's blob, available to any tool and the dashboard.

---

## Conventions

- Python: snake_case, type hints, dataclasses for models
- TypeScript/React: camelCase, functional components, hooks, strict mode
- CSS: shared styles in `static/style.css`; component-specific layout via inline styles or scoped class names
- Channel names: lowercase snake_case matching Pi Toolbox canonical names
- API responses: JSON; TypeScript interfaces in `frontend/src/types/`
- All mutations that change server-side data should call `invalidateQueries` or update the cache via `setQueryData` on success

---

## Anti-patterns

- Do NOT put processing/computation logic in route handlers -- use `processing.py` pipeline steps
- Do NOT hardcode channel names in components -- use `channelMeta` from the API
- Do NOT use `react-chartjs-2` -- use imperative Chart.js via `useRef` to avoid re-render loops
- Do NOT load full `parsed_data_json` for list views -- use `session_summary_json`
- Do NOT use `window.location.href` for navigation -- use React Router's `useNavigate`
- Do NOT modify `tools/__init__.py` when adding a new tool -- just create the module file
- Do NOT maintain a separate `useState` for data that already lives in the React Query cache -- derive it with `useMemo` or update the cache directly; dual state causes synchronization races
- Do NOT call `invalidateQueries` immediately after `setQueryData` for the same key -- the refetch will overwrite your optimistic update before the server responds
