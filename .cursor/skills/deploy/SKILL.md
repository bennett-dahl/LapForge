---
name: deploy
description: Deploy LapForge by tagging a release to trigger the GitHub Actions pipeline. Handles both stable (main branch, v* tag) and beta (beta branch, v*-beta.* tag) channels. Use when the user runs /deploy, wants to ship a release, bump a version, or trigger a build pipeline.
---

# Deploy LapForge

Releases are tag-driven. Pushing a tag triggers GitHub Actions — no manual build needed.

| Channel | Branch | Tag pattern | Example |
|---------|--------|-------------|---------|
| Stable  | `main` | `v<major>.<minor>.<patch>` | `v1.7.1` |
| Beta    | `beta` | `v<major>.<minor>.<patch>-beta.<n>` | `v1.7.0-beta.2` |

## Workflow

### Step 1 — Identify the channel

Ask the user: **beta or stable?**

### Step 2 — Verify the branch

Run:
```powershell
git branch --show-current
```

- Stable requires `main`. Beta requires `beta`.
- If the branch is wrong, **stop and warn** — do not proceed. The user may be working on the wrong branch.

### Step 3 — Uncommitted changes (working tree)

Run:
```powershell
git status --short
```

- If the working tree is **clean**, continue to Step 4.

- If the working tree is **dirty** and the current branch **already matches** the channel from Step 2 (`main` for stable, `beta` for beta), **do not stop or ask for confirmation**. Stage everything, commit with a concise descriptive message that summarizes the changes, and push the branch so the remote matches what you are about to tag:
  ```powershell
  git add -A
  git commit -m "<descriptive message>"
  git push origin main   # stable — use `beta` for beta channel
  ```
  Then continue to Step 4.

If the branch did **not** match the channel, you already stopped in Step 2 — **never** commit or push on the wrong branch.

### Step 4 — Determine the new version

Read the current version:
```powershell
(Get-Content electron/package.json | ConvertFrom-Json).version
```

**Stable:** Ask the user for the bump type (patch / minor / major) or a specific version. Compute the new semver accordingly.

**Beta:** Show the current `electron/package.json` version and the most recent beta tags to help determine the next number:
```powershell
git tag --list "v*-beta*" --sort=-version:refname | Select-Object -First 5
```
Ask the user to confirm the full tag (e.g. `v1.7.0-beta.2`).

### Step 5 — Apply the version bump (stable only)

For **stable**, update `electron/package.json`:
```powershell
$pkg = Get-Content electron/package.json | ConvertFrom-Json
$pkg.version = "<new_version>"
$pkg | ConvertTo-Json -Depth 10 | Set-Content electron/package.json
```

Then commit:
```powershell
git add electron/package.json
git commit -m "chore: bump version to v<new_version>"
```

For **beta**, skip this step — CI patches `electron/package.json` from the tag at build time.

### Step 6 — Tag and push

**Stable:**
```powershell
git tag v<new_version>
git push origin main --tags
```

**Beta:**
```powershell
git tag v<new_version>-beta.<n>
git push origin beta --tags
```

After pushing, confirm to the user that the tag was created and that the GitHub Actions pipeline should now be running.

## Important notes

- The `build.yml` pipeline triggers on `v*` tags that are **not** `-beta*`, `-alpha*`, or `-rc*`.
- The `build-beta.yml` pipeline triggers on `v*-beta*` tags only.
- Beta builds patch `appId`, `productName`, and the exe name at build time — the installed beta app is completely separate from stable.
- Never push a `v*` stable tag from the `beta` branch, or vice versa.
