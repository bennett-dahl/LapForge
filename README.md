# LapForge

Desktop telemetry analysis tool for motorsport data. Ingests Pi Toolbox exports and provides interactive charts, lap-by-lap comparison, track maps, and cloud sync via Google Drive.

Built with a Python (Flask) backend, Jinja2 templates, and an Electron shell for native desktop distribution on Windows.

## Architecture

```
LapForge/               Python package (Flask backend)
  app.py                Routes, request handlers (~48 endpoints)
  session_store.py      SQLite persistence (sessions, car-drivers, tire sets, etc.)
  processing.py         Telemetry pipeline (normalize, distance, smooth, downsample, summary)
  channels.py           Channel registry and detection
  models.py             Dataclasses for domain objects
  config.py             AppConfig backed by %APPDATA%/LapForge/
  parsers/              File format parsers
    pi_toolbox_export.py  Pi Toolbox Versioned ASCII parser
  auth/                 OAuth (Google) + keyring token storage
  sync/                 Google Drive backup sync engine
  tools/                Analysis tool plugins (auto-discovered)
  templates/            Jinja2 HTML templates
  static/               CSS, JS (Chart.js, Leaflet wrappers)
electron/               Electron desktop shell
  main.js               Main process: spawns backend, manages window, auto-updater
  preload.js            Context bridge (update events, platform info)
  package.json          Electron + electron-builder config
```

Data is stored in `%APPDATA%/LapForge/data/` (SQLite DB + uploaded files).

## Prerequisites

- **Python 3.10+**
- **Node.js 20+** and npm
- Windows 10/11 (primary target)

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/bennett-dahl/LapForge.git
cd LapForge
pip install -r requirements.txt
cd electron && npm install && cd ..
```

### 2. Run in development

**Option A -- Browser only (fastest iteration)**

```bash
python -m LapForge.app
```

Opens at http://127.0.0.1:5000 with Flask's auto-reloader enabled.

**Option B -- Electron + Flask dev server (two terminals)**

```bash
# Terminal 1: Flask backend with hot reload
python -m LapForge.app

# Terminal 2: Electron shell pointing at dev server
cd electron
npx electron . --dev
```

The `--dev` flag tells Electron to connect to `localhost:5000` instead of spawning its own backend.

### 3. Run from frozen backend (production-like)

```bash
# Build the PyInstaller backend first
python build.py --backend-only

# Launch Electron with the frozen backend
cd electron
npx electron .
```

Without `--dev`, Electron spawns `dist/backend/LapForge.exe`, shows a splash screen, waits for the `FLASK_READY` signal, then opens the main window.

## Building

### Full build (backend + installer)

```bash
python build.py
```

This will:
1. Create a clean Python venv (`.buildenv/`) and install dependencies
2. Run PyInstaller to freeze the backend into `dist/backend/`
3. Run electron-builder to produce an NSIS installer in `dist/electron/`

### Backend only

```bash
python build.py --backend-only
```

### Electron installer only

```bash
python build.py --electron-only
```

Requires `dist/backend/` to already exist from a prior backend build.

### Build artifacts

| Path | Contents |
|------|----------|
| `dist/backend/` | Frozen Python backend (`LapForge.exe` + dependencies) |
| `dist/electron/` | NSIS installer (`.exe`) and unpacked app |
| `.buildenv/` | Build-time Python venv (not committed) |
| `build/` | PyInstaller intermediate files (not committed) |

## Releasing

Releases are built automatically by GitHub Actions when you push a version tag.

### Steps

1. Bump `version` in `electron/package.json` (e.g., `"1.0.0"` -> `"1.1.0"`)
2. Commit the version bump
3. Tag and push:
   ```bash
   git tag v1.1.0
   git push origin main --tags
   ```
4. GitHub Actions builds the installer and publishes it as a GitHub Release
5. Running instances of LapForge will detect the update, download it in the background, and show a "Restart to Update" notification bar

The CI workflow is defined in `.github/workflows/build.yml`.

### Auto-updates

The app uses `electron-updater` with the GitHub Releases provider. On launch (packaged builds only), it checks for a newer version, downloads silently, and prompts the user to restart. Updates are also installed automatically when the app quits.

## Project Configuration

| File | Purpose |
|------|---------|
| `requirements.txt` | Python dependencies |
| `electron/package.json` | Electron deps, electron-builder config, publish config |
| `LapForge.spec` | PyInstaller spec (entry point, hidden imports, bundled data) |
| `build.py` | Build orchestration script |
| `.github/workflows/build.yml` | CI/CD pipeline |
| `.cursor/rules/architecture.md` | Cursor AI context (tool/channel/pipeline conventions) |

## Adding Features

### New analysis tool

1. Create `LapForge/tools/your_tool.py` with `TOOL_NAME`, `DISPLAY_NAME`, `REQUIRED_CHANNELS`, `TEMPLATE`, and `prepare_data()`
2. Create `LapForge/templates/partials/your_tool.html`
3. The tool auto-discovers and appears in the sidebar for sessions with matching channels

See `.cursor/rules/architecture.md` for the full plugin contract.

### New derived channel

1. Add a pipeline step function in `processing.py`
2. Insert it into `PIPELINE_STEPS`
3. Register the channel signature in `channels.py`

### New file parser

Add a module in `LapForge/parsers/` and wire it into the upload route in `app.py`.

## Troubleshooting

**Flask import errors in conda**: The base conda environment may have a broken Flask. Use a clean venv or the `.buildenv/` that `build.py` creates:
```bash
.buildenv/Scripts/python.exe -m LapForge.app
```

**PyInstaller `PermissionError` on rebuild**: The previous `LapForge.exe` may be locked. Delete `dist/backend/` before rebuilding:
```bash
rm -rf dist/backend
python build.py --backend-only
```

**Electron can't find backend**: Ensure `dist/backend/LapForge.exe` exists. Run `python build.py --backend-only` first, or use `--dev` mode with a running Flask server.
