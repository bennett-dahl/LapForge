# LapForge development

Follow the full workflow and conventions in `.cursor/skills/dev/SKILL.md` (same content as the **dev** Agent Skill).

**When the user adds modifiers** (e.g. **no tests**): honor them — if they say *no tests*, do **not** run pytest unless they explicitly ask for tests later.

**Summary for this repo**

- Backend: `LapForge/` (Flask `LapForge.app`). Frontend: `frontend/` (Vite + React + TS). Tests: `tests/` (pytest; `e2e` for Playwright).
- Prefer local server: `.\dev-restart.ps1` from repo root (builds SPA + Flask). Backend-only: `.\dev-restart.ps1 -SkipBuild`.
- After backend/test changes: run pytest as in the skill **unless** the user asked for no tests.
- After frontend changes: `npm run build` in `frontend/` or use `dev-restart.ps1`.
- Releases: use `/deploy` and `.cursor/skills/deploy/SKILL.md` — do not improvise tagging.
