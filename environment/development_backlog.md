# LapForge Development Backlog

> Working document for future development tasks. Each open item is descriptive enough to start a detailed plan. Priority order is within each tier.

---

## Current state

- **Version:** Stable line v1.6.9; pressure-plan betas through **v1.7.0-beta.3** (see Completed).
- **Stack:** Electron + Flask (JSON API) + React/TypeScript SPA + SQLite.
- **Tests:** 241 collected (pytest); overall coverage figure is maintained separately (historically ~53%).
- **Phase 4b:** 26-item post-SPA plan largely executed; tire pressure planning on the v1.7 beta line.

---

## Open backlog

### High priority

*(none — previous high-priority upload cleanup is complete; see Recently completed.)*

### Medium priority

#### 1. Live Session Dashboard

> Deferred from tire pressure planning; design and build as its own vertical.

**Problem:** Hot bleeds at the pit wall happen during the session, but bleed records can only be entered after telemetry is uploaded.

**Concept:** “Live session” mode — session stub before upload, live bleed/notes entry, merge on upload; plan board Zones C/D integration; optional multi-device sync later.

**Dependencies:** Upload flow changes (merge into existing session); possibly WebSocket/SSE; pit-wall UX.

**Key files:** `LapForge/app.py`, `LapForge/session_store.py`, `LapForge/models.py`, `frontend/src/pages/UploadPage.tsx`, `frontend/src/pages/SessionDetailPage.tsx`, plan pages.

**Phased delivery (when picked up):** 2A design lock → 2B stub session CRUD → 2C bleeds on stub → 2D upload merge (after upload-delete behavior is stable) → 2E plan board → 2F real-time optional.

---

#### 2. Home page — remaining polish

**Done:** Empty-state CTAs, recent sessions (with `created_at` first, legacy sessions without date sorted after), shortcuts to Plan / Tire Sets / Track Layouts, `.card-grid` / home card styling in `LapForge/static/style.css`.

**Still open:**
- **Sync at a glance:** One line or badge (last sync, signed-in) + link to Settings without embedding full `SyncPanel`.
- **App context:** Footer strip with app version (preload) and/or data path.
- **Sessions list:** Optional `created_at` column or secondary line on `SessionsPage`.
- **Playwright:** Extend smoke if home selectors need coverage.

**Key files:** `frontend/src/pages/IndexPage.tsx`, `frontend/src/layouts/AppLayout.tsx`, `frontend/src/pages/SessionsPage.tsx`.

---

#### 3. Background upload — navigate away without interrupting sync

**Problem:** Leaving the Upload page during upload/sync appears to cancel work.

**Goal:** Global upload/sync state (context or store), ambient progress in nav/sidebar, correct reattachment when returning to Upload; optional confirm only when a new action would abort the job.

**Key files:** `frontend/src/pages/UploadPage.tsx`, `frontend/src/layouts/AppLayout.tsx`, possible `frontend/src/context/UploadContext.tsx`.

---

#### 4. Telemetry distance axis — trim blank leading/trailing regions

**Problem:** Some exports stretch the distance axis with long empty or flat regions; real laps cluster in the middle.

**Goal:** Detect “active” index range, trim or re-base distance and aligned arrays consistently across dashboard, sections, track map, and compare; reprocess updates blobs; tests with a padded-distance fixture.

**Key files:** `LapForge/processing.py`, `LapForge/app.py`, `LapForge/tools/section_metrics.py`, `frontend/src/components/charts/TelemetryChart.tsx`, `tests/test_processing.py`.

---

## Future phases

### 5. Rust processing modules (napi-rs)

Replace hot paths in the Python pipeline with Rust; same `process_session`-style interface; compare against fixtures. Later callable from Node after backend migration.

**Key files:** `LapForge/processing.py`, `LapForge/parsers/pi_toolbox_export.py`, `tests/test_processing.py`, `tests/test_parser.py`.

---

### 6. Node.js backend migration + drop Python

Express/Fastify, `better-sqlite3`, `googleapis`, `keytar` / `safeStorage`, Rust napi-rs in-process; remove PyInstaller; smaller installer.

---

## Recently completed

### Upload file cleanup (former backlog #1)

**What shipped:**

1. **Delete file when the session is deleted** (`DELETE /api/sessions/<id>` and legacy `POST /sessions/<id>/delete`):
   - Resolve `session.file_path` with `SessionStore.resolve_file_path()`.
   - After `Path.resolve()`, delete only if the path is a **regular file** and **inside** `data_root/uploads` (`is_relative_to(uploads_dir)`).
   - On `OSError`, log a warning and **still remove the session row** from the database.

2. **Orphan sweep (on demand, not on startup):** `SessionStore.cleanup_orphan_uploads()` walks top-level files in `uploads/`, builds the set of resolved paths referenced by any session `file_path`, and deletes unreferenced files. Exposed as **`POST /api/maintenance/cleanup-uploads`** returning `{ ok, removed[], count }`. **Settings → Backup & Restore → “Remove orphaned upload files”** runs it after a confirm dialog. No automatic delete at startup (avoids surprise data loss).

3. **Backup / restore:** `tests/test_sync_bundle.py` includes `test_round_trip_after_orphan_cleanup` — bundle build/restore after cleanup leaves referenced uploads intact.

**Deferred (not built):** Trash / grace period.

**Product note:** Reprocess needs the original export on disk; deleting a session removes that upload file, so reprocess will report source file missing until a new upload.

**Key files:** `LapForge/app.py` (`api_session_delete`, `session_delete`, `api_cleanup_uploads`), `LapForge/session_store.py` (`cleanup_orphan_uploads`), `tests/test_api.py`, `tests/test_session_store.py`, `tests/test_sync_bundle.py`.

---

### Session added date/time — `created_at` (former backlog #4)

- SQLite `sessions.created_at` via `_migrate()`; `Session.created_at` in `models.py`; set on `add_session()` when empty (UTC ISO).
- API: `session.to_dict()` and `GET /api/sessions-full` include `created_at`.
- UI: `SessionDetailPage` header + Session Info “Added” row.
- Legacy rows: empty string; UI hides or shows em dash where appropriate.

---

### Home page cleanup — core (former backlog #3)

- `IndexPage`: Get Started when no car-drivers; car/driver cards when present; Recent Sessions (up to 5); Quick Actions including Plan, Tire Sets, Track Layouts.
- Styling: `home-section`, `card-grid`, `card-link`, `card-title`, `card-subtitle` in `LapForge/static/style.css`.

---

## Completed (milestones)

- **Phase 1:** Electron shell + Flask backend  
- **Phase 2:** Auto-updates + CI (v1.5.0)  
- **Phase 2b:** Brand guide + secrets extraction  
- **Phase 3:** Broader automated testing (coverage tracked in tooling)  
- **Phase 4:** SPA migration — React + TypeScript (v1.6.0)  
- **Phase 4b:** Post-SPA bugfix pass (v1.6.4–v1.6.8 range)  
- **Pressure plan onboarding / “Create Plan” + +car flow** (v1.7.0-beta.3): `PlanRedirect` cache updates, 409 handling on `PlanPage`, `CarDriversPage` return URL + Select.

---

## Planning reference

Detailed execution notes for the batch that shipped upload cleanup, home, and `created_at` live in the Cursor plan **backlog_1-3_implementation_90c2284d** (local plan file; not edited from this repo).
