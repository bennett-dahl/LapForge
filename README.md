# LapForge

Motorsport telemetry analysis platform.

## Development

### Prerequisites

- Python 3.11+ with a virtual environment at `.venv/`
- Node.js 18+ (for the frontend build)

### Quick start

```powershell
# Install Python dependencies
.venv\bin\python.exe -m pip install -r requirements.txt

# Install frontend dependencies
cd frontend
npm install
cd ..

# Build frontend + start Flask dev server
.\dev-restart.ps1
```

### `dev-restart.ps1`

A convenience script that builds the frontend SPA and (re)starts the Flask development server in one step.

```powershell
# Full rebuild + restart (default)
.\dev-restart.ps1

# Skip the frontend build (backend-only changes)
.\dev-restart.ps1 -SkipBuild

# Use a custom port
.\dev-restart.ps1 -Port 8080
```

The script automatically kills any existing process listening on the target port before starting, so you don't need to manually stop the server first.

## Releases

### Stable channel

Push a tag matching `v*` from `main` (e.g. `v1.7.0`). GitHub Actions runs `build.yml`, which:

1. Runs tests
2. Builds the React SPA
3. Freezes the Python backend with PyInstaller
4. Packages everything into an NSIS installer via electron-builder
5. Publishes a full **GitHub Release**

Installed users receive the update automatically via `electron-updater`.

### Beta channel

Push a tag matching `v*-beta*` from the `beta` branch (e.g. `v2.0.0-beta.1`). GitHub Actions runs `build-beta.yml`, which runs the same steps but additionally:

- Patches `electron/package.json` at build time: sets `appId` to `com.lapforge.beta`, `productName` to `LapForge Beta`, and `releaseType` to `prerelease`
- Renames the backend executable to `LapForgeBeta.exe`
- Publishes a **GitHub Pre-release**

The beta app installs alongside the stable app with its own Start Menu shortcut and a completely separate data directory (`%APPDATA%\LapForge Beta`), so the two versions never share or corrupt each other's databases.

Beta users receive updates automatically within the beta channel (pre-releases only). Stable users never see beta builds.

### Version numbering

| Channel | Tag pattern | Example |
|---------|------------|---------|
| Stable | `v<major>.<minor>.<patch>` | `v1.7.0` |
| Beta | `v<major>.<minor>.<patch>-beta.<n>` | `v2.0.0-beta.1` |

### Typical release workflow

```powershell
# Stable release
git checkout main
git tag v1.7.0
git push origin main --tags

# Beta release (from the beta branch)
git checkout beta
git tag v2.0.0-beta.1
git push origin beta --tags
```
