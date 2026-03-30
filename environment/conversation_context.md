# LapForge Conversation Context

> Last updated: 2026-03-30
> Current app version: v1.6.0
> Phase 4 SPA migration complete, tests rewritten, build verified

---

## Project Overview

LapForge is a **motorsport telemetry analysis tool** for 992 Cup race data. It started as a Flask web app and has been converted into an Electron desktop application with auto-update capability. The app parses Pi Toolbox text exports, processes tire pressure and vehicle dynamics telemetry, and provides interactive dashboards for session analysis and comparison.

**Repository:** `bennett-dahl/LapForge` (GitHub, public)

---

## Architecture

```
LapForge/                  # Python package (Flask backend)
  app.py                   # 1,694 lines, 48 routes, create_app() factory
  models.py                # Dataclasses: CarDriver, Session, TireSet, Weekend, TrackSection, etc.
  session_store.py          # SQLite CRUD for all entities
  processing.py            # Telemetry pipeline: normalize -> distance -> smooth -> downsample -> summary
  channels.py              # Channel registry (TPMS, GPS, speed, etc.) with metadata
  config.py                # AppConfig persisted in %APPDATA%/LapForge/config.json
  parsers/
    pi_toolbox_export.py   # Pi Toolbox Versioned ASCII parser
  auth/
    oauth.py               # Google OAuth2 with PKCE, keyring token storage
  sync/
    bundle.py              # Zip backup/restore with manifest
    cloud_google.py        # Google Drive sync client
    engine.py              # Push/pull sync logic
    secrets.py             # Keyring credential management
  tools/                   # Session detail tool plugins
    __init__.py, channel_chart.py, section_generator.py, section_metrics.py,
    tire_pressure.py, track_map.py
  static/                  # CSS, favicon, brand images, SPA build output (static/spa/)

frontend/                  # React + TypeScript SPA (Vite)
  src/
    api/client.ts          # Typed fetch wrapper (apiGet, apiPost, apiPatch, apiDelete)
    types/models.ts        # TypeScript interfaces mirroring models.py
    types/api.ts           # Request/response types for all API endpoints
    layouts/AppLayout.tsx  # Sidebar + Outlet (ported from base.html)
    pages/                 # IndexPage, CarDriversPage, TireSetsPage, TrackLayoutsPage,
                           # SessionsPage, UploadPage, SettingsPage, SessionDetailPage,
                           # ComparePage, CompareDashboardPage
    components/
      ui/                  # Button, Modal
      charts/              # TelemetryChart (react-chartjs-2), TirePressureChart
      maps/                # TrackMap (react-leaflet)
      tools/               # ChannelChart, TrackMapTool, SectionEditor, SectionMetrics, TirePressureTool
      dashboard/           # Dashboard, DashboardTemplateModal, modules/*
    contexts/              # CursorSyncContext (replaces cursor-sync.js)

electron/                  # Electron shell
  main.js                  # Main process: spawns Flask, auto-updater, native menus
  preload.js               # Context bridge: appVersion, update IPC, about dialog
  splash.html              # Loading screen with brand logo
  package.json             # electron-builder config, publish to GitHub Releases
  icons/                   # icon.png, icon.ico

tests/                     # Test suite (192 tests, rewritten for SPA)
  conftest.py              # Shared fixtures (isolated DB, Flask test client, SPA stub, sample data)
  fixtures/sample_export.txt  # Synthetic Pi Toolbox export for deterministic tests
  test_models.py           # 17 tests
  test_config.py           # 12 tests
  test_channels.py         # 13 tests
  test_parser.py           # 18 tests
  test_processing.py       # 18 tests
  test_session_store.py    # 37 tests
  test_sync_bundle.py      # 9 tests
  test_api.py              # 52 tests (JSON API endpoints, SPA page routes, legacy routes)
  e2e/
    conftest.py            # Playwright fixtures (Flask server, SPA build check, seeded data)
    test_smoke.py          # 12 Playwright browser smoke tests (React SPA selectors)

.github/workflows/build.yml  # CI: pytest -> PyInstaller -> electron-builder -> GitHub Releases
build.py                   # Local build script (PyInstaller + electron-builder)
LapForge.spec              # PyInstaller spec file
pytest.ini                 # Pytest config with e2e marker
requirements.txt           # Flask, Authlib, keyring, google-*, pyinstaller, pytest, playwright
brand/                     # Original brand assets (PDF, PNGs)
```

---

## Key Technical Decisions

### Data Storage
- SQLite database at `%APPDATA%/LapForge/data/race_data.db`
- Session parsed data stored as JSON blob in DB (`parsed_data_json` column)
- Upload files stored in `%APPDATA%/LapForge/data/uploads/`
- App config (device_id, flask_secret_key, data_root, profiles, google creds) at `%APPDATA%/LapForge/config.json`

### Electron + Flask Integration
- Flask runs as a child process spawned by Electron main process
- Dynamic port allocation, `FLASK_READY:port=<N>` stdout signal
- `--production` flag: no debug, no reloader
- Single instance lock via `app.requestSingleInstanceLock()`

### Auto-Updates
- `electron-updater` checks GitHub Releases
- Native `dialog.showMessageBox` for "Update Ready" (Restart Now / Later) and user-initiated "No Updates" / "Error" feedback
- `userInitiatedCheck` flag differentiates manual check from auto-check
- Releases must be non-draft (`releaseType: release` in package.json)

### Secrets Management
- Google OAuth client ID/secret resolved in order: env var > config.json > `_build_defaults.json`
- `_build_defaults.json` is gitignored, injected by CI from GitHub Repository secrets
- Bundled into PyInstaller frozen app via `LapForge.spec` datas

### Brand Identity
- Gold accent: `#c8960c` (CSS `--accent`)
- Sidebar: symbol.png logo (no text)
- Splash: dark background, logo, gold gradient loading bar
- Icons: 512px PNG -> ICO for Windows

---

## Completed Phases

### Phase 1: Electron Shell + Flask Backend
- Flask `create_app()` factory with `--production` mode
- PyInstaller `.spec` with explicit `collect_data_files()` for werkzeug/flask/jinja2/etc.
- Electron `main.js` with child process management, splash screen, single instance
- `build.py` automation script
- Data path resolution to `%APPDATA%/LapForge/data/`
- Migration from `RaceDataAnalysis` -> `LapForge` appdata

### Phase 2: Auto-Updates + CI
- `electron-updater` integration with IPC bridge
- GitHub Actions workflow: Python 3.10 + Node 20 on `windows-latest`
- Tag-based releases (`v*` triggers)
- Native menu bar (File, Edit, View, Help > About / Check for Updates)
- Verbose updater logging with timestamps

### Phase 2b: Brand Guide + Secrets
- Brand assets processed and placed (icons, splash, sidebar, favicon, CSS palette)
- OAuth credentials extracted to GitHub Repository secrets
- CI injects `_build_defaults.json` before PyInstaller freeze

### Phase 3: Comprehensive Testing
- `pytest` + `pytest-cov` + `playwright`
- 180 unit/integration tests + 12 Playwright e2e tests = 192 total (rewritten for Phase 4 SPA)
- Coverage: models 100%, channels 100%, config 95%, parser 88%, processing 83%, session_store 86%, bundle 97%
- CI runs `pytest --ignore=tests/e2e --cov-fail-under=50` before freeze

### Phase 4: SPA Frontend Migration
- React 18 + TypeScript + Vite SPA in `frontend/`
- All 21 Jinja2 templates replaced; Flask is now a pure JSON API server
- `test_api.py` rewritten (52 tests) to target JSON APIs instead of form-based HTML routes
- `test_smoke.py` rewritten (12 tests) with React SPA selectors and client-side rendering waits
- 5 bugs in `app.py` caught and fixed by tests (incorrect store method names)
- Build verified: v1.6.0 released via CI

---

## Known Issues / Notes

1. **Playwright browsers** -- Must run `python -m playwright install chromium` before e2e tests. E2E tests also require the SPA to be built first (`cd frontend && npm run build:spa`).
2. **E2e tests excluded from CI** -- The GitHub Actions runner doesn't have Playwright browsers; only unit/integration tests run in CI.
3. **Coverage gaps** -- `sync/cloud_google.py` (0%), `sync/secrets.py` (0%), `auth/oauth.py` (36%), and `tools/` modules (6-50%) have low coverage because they require external service mocking or specific session data.
4. **MSYS2 Python on dev machine** -- The local dev machine uses MSYS2/MinGW Python which requires `--system-site-packages` venv and `pacman` for native packages like `cryptography`. Standard Windows Python recommended for new setups.

---

## Next Step

**Phase 5: Rust Processing Modules (napi-rs)** -- see `environment/evolution_roadmap.md` for details.
