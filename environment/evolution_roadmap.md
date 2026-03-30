# LapForge Evolution Roadmap (Revised)

> Source of truth. Mirrors Cursor plan at `C:\Users\benne\.cursor\plans\lapforge_evolution_roadmap_9c3d6f45.plan.md` but kept up-to-date manually.

## Current State

- **Phase 1: COMPLETE** -- Electron shell wrapping Flask backend, PyInstaller freezing, NSIS installer, data migration to `%APPDATA%/LapForge/`
- **Phase 2: COMPLETE** -- electron-updater, GitHub Actions CI on `v*` tags, GitHub Releases with `releaseType: release`, auto-update notification bar (gold, fixed bottom), Help > About dialog, native menu bar (File/Edit/View/Help)
- **Phase 2b: COMPLETE** -- Brand identity applied (icons, splash, sidebar symbol, favicon, gold accent palette), OAuth credentials extracted from source into CI-injected `_build_defaults.json`
- **Phase 3: COMPLETE** -- 186 tests (174 unit/integration + 12 Playwright e2e), pytest + pytest-cov, CI pytest step with `--cov-fail-under=50`
- **Phase 4: COMPLETE** -- SPA Frontend Migration: React + TypeScript + Vite replacing all 21 Jinja2 templates; Flask is now a pure JSON API server
- **Current version: v1.5.3** -- published, auto-update pipeline verified end-to-end
- **Codebase:** 23 Python files (~6,700 lines), Flask routes now API-only, React SPA (frontend/ — ~30 TSX components), SQLite, Google Drive sync, OAuth
- **Test suite:** 186 tests, 53% overall coverage; core modules: models 100%, channels 100%, config 95%, parser 88%, processing 83%, session_store 86%, bundle 97%

---

## Phase 3: Comprehensive Testing -- COMPLETE

**Goal:** Establish a test foundation before the SPA migration changes the API surface.

### 3a: Backend Unit Tests
- Framework: `pytest` + `pytest-cov`
- **Models** ([LapForge/models.py](LapForge/models.py)): 17 tests -- dataclass construction, `to_dict`/`from_dict` round-trips, defaults, edge cases
- **Config** ([LapForge/config.py](LapForge/config.py)): 12 tests -- persistence, device_id, Google creds (env/config/build-defaults/none), corrupt files
- **Channels** ([LapForge/channels.py](LapForge/channels.py)): 13 tests -- `detect_channels`, `categorize_channels`, GPS aliases, unknown columns
- **Parser** ([LapForge/parsers/pi_toolbox_export.py](LapForge/parsers/pi_toolbox_export.py)): 18 tests -- canonical name, parse float, outing info, channel block, lap detection, PSI conversion, error cases
- **Processing** ([LapForge/processing.py](LapForge/processing.py)): 18 tests -- each pipeline step, full pipeline, sanitize, stale stages, patch summaries
- **Session Store** ([LapForge/session_store.py](LapForge/session_store.py)): 37 tests -- CRUD for all 8 entity types, dashboard layouts, resolve_file_path
- **Sync bundle** ([LapForge/sync/bundle.py](LapForge/sync/bundle.py)): 9 tests -- manifest, build/restore round-trip, hash skip, progress callbacks

### 3b: API / Integration Tests
- 35 tests via Flask test client (`app.test_client()`)
- Covers: index, settings, car-drivers CRUD, tire sets, sessions (list/detail/edit/delete/unit toggle), upload (form + file + extension check), sections API, track layouts API, compare (CRUD + dashboard), dashboard templates, dashboard layouts, session list API, sync status

### 3c: Frontend Smoke Tests
- 12 Playwright tests (headless Chromium) against real Flask server
- Navigation, car-driver flow, session flow, upload + parse, compare, track layouts

### 3d: CI Integration
- `pytest` step in [.github/workflows/build.yml](.github/workflows/build.yml) runs before PyInstaller freeze
- `--cov-fail-under=50` coverage gate
- E2e tests excluded from CI (no Playwright browsers on runner)

**Files:** `pytest.ini`, `tests/conftest.py`, `tests/fixtures/sample_export.txt`, `tests/test_models.py`, `tests/test_config.py`, `tests/test_channels.py`, `tests/test_parser.py`, `tests/test_processing.py`, `tests/test_session_store.py`, `tests/test_sync_bundle.py`, `tests/test_api.py`, `tests/e2e/conftest.py`, `tests/e2e/test_smoke.py`

---

## Phase 4: SPA Frontend Migration (React + TypeScript) -- COMPLETE

**Goal:** Replace Jinja2 templates with a React SPA for better UX, code splitting, and dev tooling.

**Completed:**
- Initialized React 18 + TypeScript project (Vite) in `frontend/`
- Dev proxy to Flask backend (Vite `server.proxy` -> `localhost:5000`)
- TypeScript interfaces mirroring all Python models in `frontend/src/types/`
- Typed API client (`apiGet`, `apiPost`, `apiPatch`, `apiDelete`) in `frontend/src/api/client.ts`
- All 10 pages migrated: Index, CarDrivers, TireSets, TrackLayouts, Sessions, Upload, Settings, SessionDetail, Compare, CompareDashboard
- `react-chartjs-2` + Chart.js 4 for telemetry charts with crosshair sync
- `react-leaflet` for track maps with cursor marker sync
- CursorSync global state ported to React context (`useSyncExternalStore`)
- Dashboard widget system ported to React (5 module types: Chart, Map, Readout, LapTimes, TireSummary)
- Dashboard template save/load modal
- SyncPanel component (SSE push/pull)
- BackgroundTaskBar for upload progress
- Vite builds to `LapForge/static/spa/`, Flask serves SPA on all page routes
- All 21 Jinja2 templates deleted, `render_template` removed from Flask
- Old vanilla JS files deleted (`cursor-sync.js`, `dashboard.js`, `telemetry-chart.js`, `map-widget.js`)
- CI updated to build SPA before PyInstaller freeze
- PyInstaller spec updated to exclude deleted templates dir
- New CRUD API routes: car-drivers, tire-sets, track-layouts, sessions-full, session detail, settings, comparisons list, compare dashboard data

**Key files:** `frontend/` directory, `LapForge/app.py` is now a pure API server, `LapForge/static/spa/` contains the built SPA

---

## Phase 5: Rust Processing Modules (napi-rs)

**Goal:** Replace Python processing pipeline with Rust for 10-50x speedup on heavy computation.

**Prerequisites:** Phase 3 processing tests provide correctness baselines.

- Profile Python processing to identify bottlenecks (likely `normalize_channels`, `compute_distance`, `smooth_pressure`, `downsample_for_charts`)
- Set up Rust workspace with napi-rs for Node.js native addon
- Port pipeline steps one at a time, comparing output against Python test fixtures
- Expose same `process_session(raw_data) -> processed_blob` interface
- Initially called from Python via subprocess; after Phase 6, called directly from Node.js
- Port parser (`pi_toolbox_export.py`) to Rust for faster file ingestion

**New files:** `native/` Rust workspace, `native/src/processing.rs`, `native/src/parser.rs`

---

## Phase 6: Node.js Backend Migration + Drop Python

**Goal:** Eliminate Python dependency entirely. Single-language stack (TypeScript/Rust).

- Replace Flask routes with Express or Fastify (TypeScript)
- Replace `session_store.py` SQLite access with `better-sqlite3`
- Replace Google Drive sync with `googleapis` npm package
- Replace keyring with `keytar` or Electron's `safeStorage`
- Integrate Rust napi-rs modules directly (no subprocess)
- Remove PyInstaller from build pipeline
- Electron main process spawns nothing -- Node.js backend runs in-process or as worker thread
- Significantly smaller installer size (no frozen Python runtime)

**Key changes:** New `backend/` TypeScript directory replaces `LapForge/` Python package, `build.py` replaced by npm scripts

---

## Phase Summary

- Phase 1: Electron Shell + Flask Backend -- **DONE**
- Phase 2: Auto-Updates + CI -- **DONE** (v1.5.0, update bar verified)
- Phase 2b: Apply Brand Guide + Secrets Extraction -- **DONE**
- Phase 3: Comprehensive Testing -- **DONE** (186 tests, 53% coverage)
- Phase 4: SPA Frontend (React + TypeScript) -- **next up**
- Phase 5: Rust Processing (napi-rs)
- Phase 6: Node.js Backend + Drop Python
