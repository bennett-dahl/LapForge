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

## Deploying

Use the `/deploy` agent skill to ship a release. It will verify your branch, check for uncommitted work, bump the version, tag, and push — triggering the GitHub Actions pipeline automatically.

```
/deploy
```

Releases are entirely tag-driven. Pushing the right tag to the right branch is all that is needed to start a build.

### Channels

| Channel | Branch | Tag pattern | Example | Pipeline |
|---------|--------|-------------|---------|----------|
| Stable  | `main` | `v<major>.<minor>.<patch>` | `v1.7.0` | `build.yml` |
| Beta    | `beta` | `v<major>.<minor>.<patch>-beta.<n>` | `v2.0.0-beta.1` | `build-beta.yml` |

### What the pipeline does

Both pipelines:

1. Run unit and integration tests (≥50% coverage required)
2. Build the React SPA
3. Freeze the Python backend with PyInstaller
4. Package an NSIS installer via electron-builder
5. Publish a GitHub Release (stable) or Pre-release (beta)

Beta additionally patches `electron/package.json` at build time to set `appId → com.lapforge.beta`, `productName → LapForge Beta`, and renames the backend executable to `LapForgeBeta.exe`. The beta app installs alongside stable with a separate data directory (`%APPDATA%\LapForge Beta`).

Installed users receive updates automatically via `electron-updater` within their respective channel.

### Manual release (without the skill)

```powershell
# Stable — update electron/package.json version first, then:
git checkout main
git tag v1.7.0
git push origin main --tags

# Beta — CI patches electron/package.json from the tag, so no file change needed:
git checkout beta
git tag v2.0.0-beta.1
git push origin beta --tags
```
