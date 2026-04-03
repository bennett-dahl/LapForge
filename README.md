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
