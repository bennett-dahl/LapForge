---
name: dev
description: Develop and verify LapForge locally: Python Flask backend in LapForge/, React SPA in frontend/, tests in tests/, desktop packaging via build.py and electron/. Use when the user runs /dev, works in this repository, runs the dev server, fixes backend or frontend bugs, writes tests, or matches CI before a PR.
---

# LapForge development (`/dev`)

## Layout

| Area | Path | Notes |
|------|------|--------|
| Backend | `LapForge/` | Flask app: `LapForge.app` |
| Frontend | `frontend/` | Vite + React + TypeScript |
| Tests | `tests/` | pytest; `e2e` marker for Playwright |
| Desktop build | `build.py`, `electron/`, `LapForge.spec` | Full installer pipeline |
| Version (releases) | `electron/package.json` | Stable releases bump this before tagging |

## Prerequisites

- Python 3.11+ with a virtual environment at `.venv/` (repo uses `.venv/bin/python.exe` in scripts)
- Node.js 18+ for the frontend

Install deps:

```powershell
.venv\bin\python.exe -m pip install -r requirements.txt
cd frontend; npm install; cd ..
```

## Local dev server

Prefer the root script (builds SPA, frees the port, starts Flask):

```powershell
.\dev-restart.ps1
```

```powershell
# Backend-only iteration
.\dev-restart.ps1 -SkipBuild

# Custom port
.\dev-restart.ps1 -Port 8080
```

Manual equivalents: `cd frontend` → `npm run build`; then run Flask with `-m flask --app LapForge.app run`.

Frontend dev server alone (API proxy not implied): `cd frontend` → `npm run dev`.

## Tests (match CI)

Unit and integration (same as `build.yml` / `build-beta.yml`, excludes browser e2e):

```powershell
.venv\bin\python.exe -m pytest tests/ --ignore=tests/e2e -v --tb=short --cov=LapForge --cov-report=term-missing --cov-fail-under=50
```

E2E tests use the `e2e` marker (`pytest.ini`); require Playwright. Run only when changing e2e flows or debugging them:

```powershell
.venv\bin\python.exe -m pytest tests/e2e -v -m e2e
```

## Desktop build (local)

Full desktop pipeline (PyInstaller + electron-builder):

```powershell
.venv\bin\python.exe build.py
```

Partial steps: `build.py --backend-only` or `build.py --electron-only` (see docstring in `build.py`). The build script may use a separate `.buildenv` venv for freezing; follow `build.py` behavior on Windows.

## Shipping a release

Do not hand-roll tag steps from memory. Use the [deploy skill](../deploy/SKILL.md) (`/deploy`): branch check, clean tree, version bump (stable), tag, push.

## Conventions for agents

- Prefer existing patterns in `LapForge/`, `frontend/src/`, and `tests/` for naming and structure.
- After backend or test changes, run the pytest command above before considering work done.
- After frontend changes, run `npm run build` in `frontend/` (or `dev-restart.ps1`) to catch TypeScript and bundle errors.
