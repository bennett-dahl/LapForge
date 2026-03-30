"""
Build pipeline for LapForge desktop app.

Usage:
    python build.py                 # Full build: PyInstaller + electron-builder
    python build.py --backend-only  # Only freeze the Python backend
    python build.py --electron-only # Only build the Electron installer (assumes backend already built)
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
BACKEND_DIST = DIST / "backend"
ELECTRON_DIR = ROOT / "electron"
FRONTEND_DIR = ROOT / "frontend"
SPEC_FILE = ROOT / "LapForge.spec"


def run(cmd: list[str], cwd: Path | None = None, label: str = "") -> None:
    if label:
        print(f"\n{'='*60}\n  {label}\n{'='*60}")
    print(f"  > {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=str(cwd) if cwd else None)
    if result.returncode != 0:
        print(f"\nERROR: step failed with exit code {result.returncode}")
        sys.exit(result.returncode)


def _build_python() -> str:
    """Return the path to the build venv Python. Create venv if needed."""
    venv_dir = ROOT / ".buildenv"
    venv_python = venv_dir / "Scripts" / "python.exe"
    if not venv_python.exists():
        print("  Creating build virtual environment...")
        run([sys.executable, "-m", "venv", str(venv_dir), "--copies"], cwd=ROOT)
        run([str(venv_python), "-m", "pip", "install", "--upgrade", "pip"], cwd=ROOT)
        run([str(venv_python), "-m", "pip", "install", "-r", "requirements.txt"], cwd=ROOT)
    return str(venv_python)


def build_spa() -> None:
    """Build the React SPA so Flask can serve it from static/spa/."""
    node_modules = FRONTEND_DIR / "node_modules"
    if not node_modules.exists():
        run(["npm", "ci"], cwd=FRONTEND_DIR, label="Installing frontend dependencies")
    run(["npm", "run", "build:spa"], cwd=FRONTEND_DIR, label="Building React SPA")
    spa_out = ROOT / "LapForge" / "static" / "spa"
    if not (spa_out / "index.html").exists():
        print(f"ERROR: SPA build output not found at {spa_out}")
        sys.exit(1)
    print(f"  SPA built -> {spa_out}")


def build_backend() -> None:
    build_spa()
    py = _build_python()
    run(
        [py, "-m", "PyInstaller", "--clean", "--noconfirm", str(SPEC_FILE)],
        cwd=ROOT,
        label="Freezing Python backend with PyInstaller",
    )
    if not BACKEND_DIST.exists():
        print(f"ERROR: Expected output at {BACKEND_DIST} not found.")
        sys.exit(1)
    print(f"  Backend built -> {BACKEND_DIST}")


def install_electron_deps() -> None:
    node_modules = ELECTRON_DIR / "node_modules"
    if not node_modules.exists():
        run(
            ["npm", "install"],
            cwd=ELECTRON_DIR,
            label="Installing Electron dependencies",
        )
    else:
        print("\n  Electron node_modules already present, skipping npm install.")


def build_electron() -> None:
    if not BACKEND_DIST.exists():
        print(f"ERROR: Backend not found at {BACKEND_DIST}. Run --backend-only first.")
        sys.exit(1)
    install_electron_deps()
    run(
        ["npx", "electron-builder", "--win"],
        cwd=ELECTRON_DIR,
        label="Building Electron installer",
    )
    out_dir = DIST / "electron"
    print(f"\n  Installer output -> {out_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build LapForge desktop app")
    parser.add_argument("--backend-only", action="store_true", help="Only freeze Python backend")
    parser.add_argument("--electron-only", action="store_true", help="Only build Electron installer")
    args = parser.parse_args()

    if args.backend_only:
        build_backend()
    elif args.electron_only:
        build_electron()
    else:
        build_backend()
        build_electron()

    print("\n  Build complete.")


if __name__ == "__main__":
    main()
