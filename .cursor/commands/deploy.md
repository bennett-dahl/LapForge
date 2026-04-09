# Deploy LapForge (tag-driven release)

Follow the full workflow in `.cursor/skills/deploy/SKILL.md`.

**Summary**

1. Ask **beta** or **stable**, then verify branch (`beta` vs `main`).
2. If the working tree is dirty **and** the branch matches the channel: `git add -A`, commit with a descriptive message, `git push origin <branch>` — then bump version (stable only), create the tag, and `git push origin <branch> --tags`.
3. If the branch is wrong, **stop** — do not commit on the wrong branch.

CI runs from the tag; see the skill for tag patterns and PowerShell snippets.
