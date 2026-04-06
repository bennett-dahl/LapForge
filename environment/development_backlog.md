# LapForge Development Backlog

> Working document for future development tasks. Each item is described well enough to serve as a starting point for a detailed plan. Items are listed in priority order within each tier.

---

## Current State

- **Version:** v1.6.8
- **Stack:** Electron + Flask (pure JSON API) + React/TypeScript SPA + SQLite
- **Tests:** 192 (unit/integration + Playwright e2e), 53% overall coverage
- **Phase 4b (Post-SPA Bugfix Pass):** In progress — 26-item plan executed, 5 post-plan fixes shipped (v1.6.4–v1.6.8). Additional UI polish and minor regressions still being identified through user testing.

---

## High Priority

### 1. Upload File Cleanup (Orphan Management)

**Problem:** When a session is deleted, its associated upload file in `%APPDATA%/LapForge/data/uploads/` is not removed. Over time this accumulates orphaned files that waste disk space and create confusion about what data is still active.

**Scope:**
- On session deletion, the corresponding upload file should be deleted from the uploads directory.
- A startup or on-demand sweep should detect and clean up any existing orphaned uploads (files not referenced by any session in the database).
- Consider a confirmation UX or a "trash" grace period before permanent file deletion.
- The sync/backup system (`bundle.py`) should be aware of the change — ensure backup/restore still works correctly when upload files may or may not be present.

**Key files:** `LapForge/session_store.py` (session deletion logic), `LapForge/app.py` (delete route), `LapForge/sync/bundle.py` (backup/restore), upload storage at `%APPDATA%/LapForge/data/uploads/`

---

## Medium Priority

### 2. Live Session Dashboard

> Deferred from the tire pressure planning feature. To be designed and built separately.

**Problem:** During a practice session (e.g. P1 stabilization), the engineer performs hot bleeds at the pit wall while the car is on track. Currently, bleed records can only be entered after the session telemetry is uploaded. This creates a gap between when bleeds happen and when they're recorded in the app.

**Concept:** A "live session" mode that allows real-time data entry before telemetry upload:
- **Pre-session setup:** Create a session stub (car, driver, session type, tire set) before the car goes out. No telemetry yet.
- **Live bleed recording:** Record hot bleeds in real time against the session stub. Each bleed: corner, PSI removed, hot/cold, approximate lap/time, notes.
- **Live notes:** Free-text notes timestamped during the session (e.g. "driver reports front push after lap 5").
- **Post-session merge:** When telemetry is uploaded, it merges into the existing session stub. Bleed timestamps can be correlated with TPMS data.

**Integration with pressure planning:**
- The plan board's bleed ledger (Zone D) would show live bleeds as they're entered.
- The session table (Zone C) would show the stub session with a "live / awaiting upload" badge.
- After upload and merge, the session transitions to a normal state with full telemetry.

**Dependencies:**
- Requires changes to the upload flow (merge into existing session vs. create new).
- May benefit from a WebSocket or SSE connection for multi-device sync (e.g. engineer at pit wall + strategist in the paddock both see live bleeds).
- Consider mobile/tablet form factor for pit-wall entry.

**Key files:** `LapForge/app.py` (upload routes, session API), `LapForge/session_store.py` (session CRUD), `LapForge/models.py` (Session dataclass), `frontend/src/pages/UploadPage.tsx`, `frontend/src/pages/SessionDetailPage.tsx`

---

## Future Phases

### 3. Rust Processing Modules (napi-rs)

**Goal:** Replace the Python processing pipeline with Rust for 10–50x speedup on heavy computation.

**Prerequisites:** Phase 3 processing tests provide correctness baselines.

**Approach:**
- Profile Python processing to identify bottlenecks (likely `normalize_channels`, `compute_distance`, `smooth_pressure`, `downsample_for_charts`).
- Set up Rust workspace with napi-rs for Node.js native addon.
- Port pipeline steps one at a time, comparing output against Python test fixtures.
- Expose same `process_session(raw_data) -> processed_blob` interface.
- Initially called from Python via subprocess; after Node.js backend migration, called directly from Node.js.
- Port parser (`pi_toolbox_export.py`) to Rust for faster file ingestion.

**New files:** `native/` Rust workspace, `native/src/processing.rs`, `native/src/parser.rs`

**Key files:** `LapForge/processing.py`, `LapForge/parsers/pi_toolbox_export.py`, `tests/test_processing.py`, `tests/test_parser.py`

### 4. Node.js Backend Migration + Drop Python

**Goal:** Eliminate the Python dependency entirely. Single-language stack (TypeScript/Rust).

**Approach:**
- Replace Flask routes with Express or Fastify (TypeScript).
- Replace `session_store.py` SQLite access with `better-sqlite3`.
- Replace Google Drive sync with `googleapis` npm package.
- Replace keyring with `keytar` or Electron's `safeStorage`.
- Integrate Rust napi-rs modules directly (no subprocess).
- Remove PyInstaller from build pipeline.
- Electron main process spawns nothing — Node.js backend runs in-process or as worker thread.
- Significantly smaller installer size (no frozen Python runtime).

**Key changes:** New `backend/` TypeScript directory replaces `LapForge/` Python package, `build.py` replaced by npm scripts.

---

## Completed

- **Phase 1:** Electron Shell + Flask Backend
- **Phase 2:** Auto-Updates + CI (v1.5.0)
- **Phase 2b:** Brand Guide + Secrets Extraction
- **Phase 3:** Comprehensive Testing (192 tests, 53% coverage)
- **Phase 4:** SPA Frontend Migration — React + TypeScript (v1.6.0)
- **Phase 4b:** Post-SPA Bugfix Pass — in progress (v1.6.8, 26-item plan + 5 post-plan fixes)
