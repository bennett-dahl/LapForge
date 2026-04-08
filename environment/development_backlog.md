# LapForge Development Backlog

> Working document for future development tasks. Each open item is descriptive enough to start a detailed plan. Priority order is within each tier.

---

## Current state

- **Version:** Stable **v1.7.0**; beta line **v1.7.0-beta.4** (see Completed).
- **Stack:** Electron + Flask (JSON API) + React/TypeScript SPA + SQLite.
- **Tests:** 229 collected (pytest, excluding `e2e`); overall coverage figure is maintained separately (historically ~53%).
- **Phase 4b:** 26-item post-SPA plan largely executed; tire pressure planning on the v1.7 beta line. Session detail dashboard TPMS unit handling fixed (see Recently completed).

---

## Open backlog

### Medium priority

#### 1. Live Session Dashboard

> Deferred from tire pressure planning; design and build as its own vertical.

**Problem:** Hot bleeds at the pit wall happen during the session, but bleed records can only be entered after telemetry is uploaded.

**Concept:** “Live session” mode — session stub before upload, live bleed/notes entry, merge on upload; plan board Zones C/D integration; optional multi-device sync later.

**Dependencies:** Upload flow changes (merge into existing session); possibly WebSocket/SSE; pit-wall UX.

**Key files:** `LapForge/app.py`, `LapForge/session_store.py`, `LapForge/models.py`, `frontend/src/pages/UploadPage.tsx`, `frontend/src/pages/SessionDetailPage.tsx`, plan pages.

**Phased delivery (when picked up):** 2A design lock → 2B stub session CRUD → 2C bleeds on stub → 2D upload merge (after upload-delete behavior is stable) → 2E plan board → 2F real-time optional.

---

#### 2. Background upload — navigate away without interrupting sync

**Problem:** Leaving the Upload page during upload/sync appears to cancel work.

**Goal:** Global upload/sync state (context or store), ambient progress in nav/sidebar, correct reattachment when returning to Upload; optional confirm only when a new action would abort the job.

**Key files:** `frontend/src/pages/UploadPage.tsx`, `frontend/src/layouts/AppLayout.tsx`, possible `frontend/src/context/UploadContext.tsx`.

---

#### 3. Telemetry distance axis — trim blank leading/trailing regions

**Problem:** Some exports stretch the distance axis with long empty or flat regions; real laps cluster in the middle.

**Goal:** Detect “active” index range, trim or re-base distance and aligned arrays consistently across dashboard, sections, track map, and compare; reprocess updates blobs; tests with a padded-distance fixture.

**Key files:** `LapForge/processing.py`, `LapForge/app.py`, `LapForge/tools/section_metrics.py`, `frontend/src/components/charts/TelemetryChart.tsx`, `tests/test_processing.py`.

---

#### 4. Cloud backup — move off personal Google Drive (explore)

**Problem:** Cloud sync today uses the signed-in user’s personal Google Drive (`DriveClient` in `LapForge/sync/cloud_google.py`, OAuth + `engine.py`). That does not scale operationally or perception-wise as the product grows.

**Goal:** Spike or short design pass: pick a direction for a **separate** backup/sync backend (not the developer’s personal Drive). Compare at least: (a) Google Workspace / Shared drive + dedicated OAuth client, (b) S3-compatible object storage (e.g. R2, S3, B2) with optional thin LapForge API for auth and signed uploads, (c) BaaS storage if vendor fit is acceptable. Define auth model (Google sign-in → your tokens vs provider-native), cost/egress, migration for existing `LapForgeBackup/` users, and what a `DriveClient`-shaped adapter would look like.

**Deliverable:** Written recommendation (this doc or a short `environment/` note) plus rough effort estimate before implementation.

**Key files:** `LapForge/sync/cloud_google.py`, `LapForge/sync/engine.py`, `LapForge/sync/secrets.py`, `LapForge/auth/oauth.py`, `LapForge/app.py` (sync routes), `frontend` sync/settings UI as needed.

---

#### 5. Tire sets, weekends, and plan integration (reassess linkage)

**Problem:** Tire sets are largely scoped to **car / driver** (`car_driver_id` on `tire_sets`). A **weekend** (event) is the natural unit for “which rubber is on the car, at what cold/hot pressures, across practice → qual → race,” but that story is not first-class. Sessions link to a tire set id, and the **plan** ties sessions to a weekend, yet there is no clear, durable link that answers: *for this weekend and this car, which tire sets are in play and how do morning / roll-out / target pressures evolve?* The **Tire Sets** library and **Plan** board feel loosely coupled.

**Goal:** Reassess the domain model and UX so tire inventory and pressures are **traceable per weekend (and car)** end-to-end, with a **clean interface** and **first-class integration into the plan** (not only session detail).

**Scope (planning — not prescriptive):**
- **Model:** Decide whether tire sets gain optional **`weekend_id`** (or a junction table weekend ↔ set ↔ car), whether “set instances” per weekend replace global sets for event use, and how legacy rows migrate.
- **Pressures over time:** Define what is stored where (morning grid, roll-out per session, targets from plan vs session) so the plan can show a coherent timeline without duplicate sources of truth.
- **API:** Extend or add routes so the plan page can list weekend-scoped sets, assign a set to sessions/checklist steps, and read/write the fields the UI needs.
- **Plan UI:** Surfaces for picking/linking sets per weekend, seeing pressure context next to checklist / session slots, and quick navigation to set detail.
- **Tire Sets page:** Clarify global library vs “in use this weekend”; filters or sections by weekend / car.
- **Migration:** Backfill strategy for existing `tire_sets` and `sessions.tire_set_id` so nothing breaks mid-season.

**Key files:** `LapForge/models.py` (`TireSet`, `Weekend`, `Plan`, `Session`), `LapForge/session_store.py`, `LapForge/app.py`, `frontend/src/pages/PlanPage.tsx` (and related plan components), `frontend/src/pages/TireSetsPage.tsx` (or equivalent), `frontend/src/types/models.ts`.

**Deliverable:** Short design note (model + UI sketches + migration) before large implementation; then phased PRs (schema → API → plan → tire library).

---

#### 6. Weather page

**Problem:** Ambient and track temperature matter for tire pressure planning and session notes, but there is **no dedicated place** in the app to view, record, or revisit **weather context** alongside a **weekend** or **track**. Data that exists today is scattered (session-level temps on import, plan fields) and there is no single “what were the conditions?” surface.

**Goal:** A **Weather** page (and supporting data) that supports the pressure-planning workflow: see or enter conditions for an event, optionally tie readings to **weekend + track**, and leave room to **integrate with the plan board** and session detail later.

**Scope (planning — pick in design):**
- **Inputs:** Manual entry only (grid / timeline per day), vs. **external forecast API** (provider, rate limits, Electron vs web), vs. hybrid (manual override on top of fetched data).
- **Persistence:** New table(s) or JSON on `weekends` / plans — versioned so sync and backup stay coherent.
- **UI:** Route (e.g. `/weather`), nav entry, pick weekend + track, list or chart by day/session slot; respect app **temp unit** preference.
- **Integration (later phases):** Surface summary chips on **Plan** or **Home**; optional pull of last session temps into plan context.

**Key files:** `LapForge/models.py`, `LapForge/session_store.py`, `LapForge/app.py`, `frontend` router + new page, `frontend/src/layouts/AppLayout.tsx` (nav), `frontend/src/types/models.ts`.

**Deliverable:** One-page product + data design (what we store, what we fetch, privacy/offline) before build.

---

#### 7. Setup tracking (chassis / alignment) + plan checklist integration

**Problem:** There is no first-class **setup** in LapForge: chassis parameters (alignment, ride heights, corner weights, track width, etc.) that persist **independently of telemetry sessions** but should attach to **pressure-plan checklist steps** the same way **sessions** do today (`session_ids` per `ChecklistStep` in `PlanChecklist.tsx`).

**Goal:** **Setups** are reusable, editable records (scoped at least to **car / driver**, optionally **weekend**). Each plan checklist step can **link zero or more setups** (pick from library + create new), mirroring the session link/unlink UX. Optional **detail view** to compare before/after or against a target template.

**Reference — ShopFloor 2.0 (`C:\Coding\ShopFloor2.0`):** That app models **alignment** work, not a generic “setup” name, but the **captured fields** are a strong template for what LapForge might store (likely as JSON + metadata in SQLite):

| Area | Fields (from ShopFloor models) |
|------|--------------------------------|
| **Alignment record** | `vehicle`, optional `workOrder`, optional `template`, `alignmentType`, `rideHeightReference`, **`before`** snapshot, **`after`** snapshot, **`intermediateSteps[]`** (`label` + snapshot each), `customerNotes`, `technicianNotes`, `accuracyRating` (1–5), `customerRating` (1–5), `rideHeightUnit` / `trackWidthUnit` (`mm` \| `in`), `completedBy`, `alignmentDate` |
| **Snapshot** (before/after/target) | Per corner **FL / FR / RL / RR:** `camber` (°), `toe` (mm), `rideHeight`, `weightPercent`, `weightLbs`. **Vehicle-level:** `frontAxlePercent`, `rearAxlePercent`, `leftSidePercent`, `rightSidePercent`, `crossFLRRPercent`, `crossFRRLPercent`, `totalWeightLbs`, `trackWidthFront`, `trackWidthRear` |
| **Template** (library target) | `make`, `model`, `year`, `alignmentType`, `rideHeightReference`, **`target`** snapshot (same shape as above), units, `notes` |

LapForge does not need Mongo/work orders; map **vehicle → `car_driver_id`**, drop shop-only fields if irrelevant, and keep **snapshot JSON** aligned with the above shape for possible future import/export.

**Integration (clean path):**
- **Data:** New `setups` table (id, `car_driver_id`, optional `weekend_id`, name/label, `snapshot_json` or normalized columns, `created_at`, notes); optional `setup_templates` later mirroring ShopFloor templates.
- **Plan:** Extend `checklist_json` steps with **`setup_ids: string[]`** (default `[]`), same patch/update flow as `session_ids`; aggregate list on plan for board if needed.
- **UI:** `PlanChecklist` — “Pick setup” / “New setup” beside session actions; library route e.g. `/setups` (list + editor form for corner grid + totals).
- **Sync/bundle:** Include new table/files in backup manifest rules like other entities.

**Key files:** `LapForge/models.py`, `LapForge/session_store.py` (`plans` checklist schema + migrations), `LapForge/app.py`, `frontend/src/types/models.ts` (`ChecklistStep`, `Plan`), `frontend/src/components/plan/PlanChecklist.tsx`, new setup page(s), `DEFAULT_CHECKLIST_STEPS` in `LapForge/models.py` if defaults need new keys.

**Deliverable:** Schema + API sketch + one UI wire for checklist linking; confirm field parity with ShopFloor for any import story.

---

## Future phases

### 8. Rust processing modules (napi-rs)

Replace hot paths in the Python pipeline with Rust; same `process_session`-style interface; compare against fixtures. Later callable from Node after backend migration.

**Key files:** `LapForge/processing.py`, `LapForge/parsers/pi_toolbox_export.py`, `tests/test_processing.py`, `tests/test_parser.py`.

---

### 9. Node.js backend migration + drop Python

Express/Fastify, `better-sqlite3`, `googleapis`, `keytar` / `safeStorage`, Rust napi-rs in-process; remove PyInstaller; smaller installer.

---

## Recently completed

### Home page — remaining polish (former backlog #2)

**What shipped:**

1. **Sync at a glance** (`IndexPage`): compact badge + last-synced timestamp + link to Settings (`?tab=sync`); `oauth_not_configured` / `not_logged_in` render a muted one-liner only. `STATUS_LABELS` extracted to `frontend/src/utils/syncStatus.ts`; `staleTime: 60 s, refetchOnWindowFocus: false` added to both `IndexPage` and `SyncPanel` queries.
2. **Settings deep-link**: `SettingsPage` reads `?tab=` from `useSearchParams` on mount and activates the matching tab.
3. **App context footer**: `AppLayout` renders a pinned footer (`data-testid="app-footer"`) with `data_root` (from settings query) and Electron `appVersion` (absent in web context). `.main-content` changed to flex column; content wrapped in `.main-scroll-area` (`flex:1; overflow-y:auto`).
4. **Sessions Added column**: `SessionsPage` table shows `created_at` as short date (`Jan 15`) or `—`; e2e seed fixture given `created_at="2025-01-15T10:00:00Z"`.
5. **Playwright smoke**: new `TestHomePolish`, `TestSessionsPolish`, and `TestSettingsFlow.test_tab_deep_link` covering all four shipped items.

**Key files:** `frontend/src/pages/IndexPage.tsx`, `frontend/src/layouts/AppLayout.tsx`, `frontend/src/pages/SessionsPage.tsx`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/components/SyncPanel.tsx`, `frontend/src/utils/syncStatus.ts`, `LapForge/static/style.css`, `tests/e2e/test_smoke.py`, `tests/e2e/conftest.py`.

---

### Session detail dashboard — TPMS pressure units (former high-priority #1)

**What shipped:**

1. **`dashboard_data` matches Plan telemetry normalization:** `_build_dashboard_data` in `LapForge/app.py` converts bar-labelled pressure channels to PSI and patches `channel_meta` to `unit: "psi"` for those series (same contract as `_build_session_dash_data` / `GET /api/sessions/<id>/telemetry`), so `ChartModule` does not apply a second bar→PSI conversion. Fixes inflated traces when session blobs disagreed with the Plan chart.

2. **Parser:** Pi Toolbox headers `*tpms_press_* [psi]` are detected; canonical `tpms_press_*` rows store true bar, with `*_psi` companion columns where applicable (`LapForge/parsers/pi_toolbox_export.py`). `PIPELINE_VERSION` bumped so reprocess picks up parser changes.

3. **Regression:** `tests/test_api.py::TestSessionAPI::test_dashboard_tpms_pressure_normalized_to_psi`; parser coverage in `tests/test_parser.py::TestLoadPiToolboxExport::test_tpms_psi_header_stores_bar_and_psi`.

**Key files:** `LapForge/app.py`, `LapForge/parsers/pi_toolbox_export.py`, `LapForge/processing.py` (`PIPELINE_VERSION`), `tests/test_api.py`, `tests/test_parser.py`.

---

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
