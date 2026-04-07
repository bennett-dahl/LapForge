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

### 3. Home Page (Index) Cleanup

**Problem:** The index route (`/`) is minimal: a title, a one-line tagline, car/driver shortcut cards (only when at least one exists), and three quick-action cards. There is little guidance for new users, no sense of “what happened recently,” and no path into other high-value areas (pressure plans, tire sets, sync) without using the sidebar.

**Goal:** Turn the home page into a useful landing surface — fast re-entry for regular use, clear onboarding when the database is empty, and optional at-a-glance status without duplicating whole other pages.

**Suggestions (pick and refine in planning):**
- **Empty / first-run state:** When there are no car-drivers (or no sessions), show a short checklist or prominent CTAs: add car & driver, optional track layout, first upload — instead of a nearly blank screen.
- **Recent sessions:** A compact list of the last handful of sessions (date, track/event label, car) linking to session detail — fastest way to resume analysis after opening the app.
- **Pressure planning entry:** A card or row linking to `/plan` (and optionally highlighting in-progress weekends if the API supports listing them cleanly).
- **Secondary shortcuts:** Cards or a single “Library” row for Tire Sets, Track Layouts, and Compare — matches how often users bounce between setup data and analysis.
- **Sync / cloud at a glance:** One line or badge (e.g. last successful push/pull, signed-in state) with a link to Settings, reusing patterns from `SyncPanel` without embedding the full panel on home.
- **App context (Electron):** Subtle footer or meta strip: app version (already available from preload in places) and/or data location — reduces “where is my data?” support friction.
- **Visual hierarchy:** Reconcile heading levels, spacing, and card density with the rest of the SPA so home feels as polished as Sessions or Session Detail.

**Key files:** `frontend/src/pages/IndexPage.tsx`, `frontend/src/layouts/AppLayout.tsx` (nav), existing session/plan/sync API hooks as needed

### 4. Session Added Date/Time (Metadata & Header)

**Problem:** Sessions have no persisted “when was this added to LapForge?” field. The `sessions` table and `Session` model do not include a timestamp (unlike weekends, plans, and track layouts, which already use `created_at`). Users cannot see at a glance when telemetry was imported, which matters when comparing multiple uploads from the same event or debugging “which file did I load last?”

**Scope:**
- Add a column (e.g. `created_at` or `added_at`) via `session_store._migrate()`, default empty for legacy rows.
- Set the timestamp when a session is first inserted (`add_session` / upload flow); decide whether edits (`update_session`) should also set `updated_at` (optional second column).
- Expose the value on session JSON from the API so the SPA can render it.
- **Session detail:** Show formatted local date/time in the header or metadata panel alongside track, session type, car/driver, etc.
- **Sessions list:** Optional column or secondary line under the title for sort/browse by recency.
- Backfill: legacy sessions can stay blank or use file mtime / Pi export metadata if available and worth the complexity (document the choice).

**Key files:** `LapForge/session_store.py`, `LapForge/models.py`, `LapForge/app.py` (session routes), `frontend/src/types/models.ts`, `frontend/src/pages/SessionDetailPage.tsx`, `frontend/src/pages/SessionsPage.tsx`

### 5. Telemetry distance axis: trim blank leading/trailing regions & normalize

**Problem:** Some Pi Toolbox exports produce dashboards where the **distance (X) axis spans a wide range** (e.g. 0–90 km) but **most of that span is empty or flat** — channels show no real variation for long leading and trailing segments, while the **actual on-track data is squeezed into the middle**. Lap boundary markers and overlays then **only align with the active region**, which looks wrong relative to the full axis and makes zoom/pan and mental mapping harder. Example: COTA Practice 1 with large dead zones before ~38 km and after ~82 km on distance-based charts.

**Goal:** **Detect** the contiguous index range where the session is “alive” (e.g. meaningful speed / motion / non-padded channels), **trim or re-base** distance (and aligned arrays: times, series, pressure, GPS-derived data) so charts use a domain that matches the data, and keep **lap splits, section tools, and compare** consistent with the chosen domain rules.

**Scope (planning):**
- Root-cause analysis per failure mode: `log_distance` / integrated distance vs. row count, null forward-fill in `compute_distance`, export padding, or mismatch between `lap_split_distances` and the distance series used for charts.
- Define robust criteria for “inactive” samples (zeros, holds, pre/post out-lap padding) without clipping real pit-lane or low-speed segments incorrectly.
- Implement normalization in the processing pipeline (likely `process_session` / `compute_distance` / post-step trim) so **reprocess** refreshes stored blobs; document behavior for legacy sessions.
- Verify **dashboard modules**, **section metrics**, **track map**, and **compare** still agree on distance semantics after trimming or offsetting.
- Add or extend **fixtures/tests** with a minimal synthetic case that reproduces long padded distance so regressions are caught.

**Key files:** `LapForge/processing.py` (`compute_distance`, downsampling and any distance-derived outputs), `LapForge/app.py` (`_build_dashboard_data` / chart payload assembly), `LapForge/tools/section_metrics.py`, `frontend/src/components/charts/TelemetryChart.tsx`, `tests/test_processing.py`

---

## Future Phases

### 6. Rust Processing Modules (napi-rs)

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

### 7. Node.js Backend Migration + Drop Python

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
