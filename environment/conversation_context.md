# LapForge Conversation Context

> Last updated: 2026-03-29
> Conversation ID: d25bdf8e-20cd-4630-9fbb-49bed8b5ca99
> Current app version: v1.5.0
> Latest git commit: `09a142b` (Fix update notification: prevent duplicate handler registration)

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
  templates/               # 21 Jinja2 templates (to be replaced in Phase 4)
  static/                  # CSS, favicon, brand images

electron/                  # Electron shell
  main.js                  # Main process: spawns Flask, auto-updater, native menus
  preload.js               # Context bridge: appVersion, update IPC, about dialog
  splash.html              # Loading screen with brand logo
  package.json             # electron-builder config, publish to GitHub Releases
  icons/                   # icon.png, icon.ico

tests/                     # Phase 3 test suite (186 tests)
  conftest.py              # Shared fixtures (isolated DB, Flask test client, sample data)
  fixtures/sample_export.txt  # Synthetic Pi Toolbox export for deterministic tests
  test_models.py           # 17 tests
  test_config.py           # 12 tests
  test_channels.py         # 13 tests
  test_parser.py           # 18 tests
  test_processing.py       # 18 tests
  test_session_store.py    # 37 tests
  test_sync_bundle.py      # 9 tests
  test_api.py              # 35 tests (Flask test client integration)
  e2e/
    conftest.py            # Playwright fixtures (Flask server, browser, seeded data)
    test_smoke.py          # 12 Playwright browser smoke tests

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
- Gold notification bar at bottom of page (injected via `base.html` template script)
- `lastUpdateStatus` replayed on MPA page navigation
- `autoUpdaterInitialized` guard prevents duplicate event listeners
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
- 174 unit/integration tests + 12 Playwright e2e tests = 186 total
- Coverage: models 100%, channels 100%, config 95%, parser 88%, processing 83%, session_store 86%, bundle 97%
- CI runs `pytest --ignore=tests/e2e --cov-fail-under=50` before freeze

---

## Uncommitted Changes (as of conversation end)

The Phase 3 test suite has not yet been committed. Files:

```
Modified:
  .github/workflows/build.yml   (added pytest step)
  .gitignore                     (added .coverage, htmlcov/)
  requirements.txt               (added pytest, pytest-cov, playwright)

New:
  pytest.ini
  tests/conftest.py
  tests/fixtures/sample_export.txt
  tests/test_models.py
  tests/test_config.py
  tests/test_channels.py
  tests/test_parser.py
  tests/test_processing.py
  tests/test_session_store.py
  tests/test_sync_bundle.py
  tests/test_api.py
  tests/e2e/conftest.py
  tests/e2e/test_smoke.py
  environment/                   (this file and the roadmap)
```

---

## Known Issues / Notes

1. **Flask broken in base conda env** -- Flask import fails in the base Anaconda environment. Use `.buildenv/` venv for PyInstaller builds, or reinstall Flask with `pip install Flask --force-reinstall`.
2. **Playwright browsers** -- Must run `python -m playwright install chromium` before e2e tests.
3. **E2e tests excluded from CI** -- The GitHub Actions runner doesn't have Playwright browsers; only unit/integration tests run in CI.
4. **Coverage gaps** -- `sync/cloud_google.py` (0%), `sync/secrets.py` (0%), `auth/oauth.py` (36%), and `tools/` modules (6-50%) have low coverage because they require external service mocking or specific session data. These are acceptable given the Phase 4 SPA migration will change the frontend contract.

---

## Next Step

**Phase 4: SPA Frontend Migration (React + TypeScript)** -- see `environment/evolution_roadmap.md` for details.
