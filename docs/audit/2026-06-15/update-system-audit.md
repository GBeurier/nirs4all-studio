# Auto-Update Audit & Test Strategy — nirs4all Studio

**Date:** 2026-06-15
**Scope:** the self-update path for desktop builds (installer, portable, all-in-one) — *not* the `nirs4all`/pip dependency manager.
**Reported symptom:** "the update downloads, then the rest doesn't work" — across install/portable and all-in-one, with **no Sentry crash**.
**Review:** root causes A/B/C and the test/roadmap were independently re-verified against source by Codex (adversarial pass, 2026-06-15) — all confirmed; its wording/rigor refinements are folded in below.

---

## 0. Verdict (TL;DR)

The **download** step is robust (it is a plain HTTP GET with resume + checksum). Every reported failure is in the **apply** step, and the apply step is broken in *different* ways per distribution. The mechanism was designed for exactly two cases — **portable Windows** (swap one `.exe`) and **an all-in-one archive extracted into a user-writable folder** — but the asset selector offers in-place updates to *every* build, including OS-installed ones it physically cannot update.

Three confirmed root causes, ranked by blast radius:

| # | Root cause | Who hits it | Confidence |
|---|---|---|---|
| **A** | **macOS ZIP extraction destroys symlinks** → relaunched `.app` is structurally corrupt → "is damaged / won't open" | **All macOS users** (DMG-installed *and* all-in-one) | **High — confirmed in code** |
| **B** | **Windows installs are per-machine (Program Files); the updater needs UAC elevation and silently `exit /b 0` if denied/unavailable** → app closes, nothing replaced, no relaunch | **All NSIS-installed Windows users** (the default installer) | **High — confirmed in code** |
| **C** | **No privilege escalation on Linux + AppImage isn't a directory** → `cp` over root-owned `/usr|/opt` or an AppImage mount silently fails | **deb / AppImage Linux users** | **High — confirmed in code** |

Plus a systemic reason it ships undetected:

| # | Root cause | Impact |
|---|---|---|
| **D** | **There is no test that exercises apply → relaunch → "app boots again".** Tests assert generated *script text* and zip *permission* bits only. The macOS symlink bug, the elevation bug, and the relaunch path are all 100% untested. | Every one of A/B/C ships green. |
| **E** | **Sentry is blind by construction:** the apply runs in a *detached OS script after the app has already exited*, so there is no live process to report a crash. | "No Sentry crash" is expected, not reassuring. |

**Only three paths actually work today:** portable Windows, Windows all-in-one extracted to a writable folder, and Linux all-in-one (`.tar.gz`) extracted to a writable folder. Everything OS-installed, and *all* of macOS, is broken.

---

## 1. How the system works (verified map)

Distribution families (`docs/PACKAGING.md`) and the update asset each is offered (`api/updates/manager.py:_find_platform_asset`, 532–603):

```
files on disk ─GET─► download_and_stage_update() ─► extract to staging ─► /webapp/apply
                     (api/update_downloader.py)      (zip OR tar OR exe)   (api/updates/app_updates.py:357)
                                                                              │
                                                                              ▼
                                              updater/__init__.py: write OS script, launch detached,
                                              app quits, script waits for PID, backup+replace, relaunch
```

Apply handoff (confirmed):
- `POST /webapp/apply` validates the staged layout (`api/updates/staging.py:119`), creates the OS script (`updater/__init__.py:554`), launches it **detached** (`updater/__init__.py:647`), returns `restart_required`.
- Frontend then calls `electronApi.quitForUpdate()` (`src/hooks/useUpdates.ts:247–266`).
- Electron handles it (`electron/main.ts:260–273`): `setQuittingForUpdate()` → `app.quit()` after 500 ms → hard `process.exit(0)` after 10 s.
- `setQuittingForUpdate()` makes `stop()` kill the backend **without** a tree-kill so the detached updater survives (`electron/backend-manager.ts:74–78, 718–729`).
- The script waits for the **Electron** PID (`updater/__init__.py:581–584`, `os.getppid()` under Electron), then backs up, replaces, relaunches.

Update mode is chosen by `_expected_update_mode()` (`api/updates/staging.py:40`): `portable` / `bundle` (any darwin) / `directory` (everything else).

---

## 2. Root causes in detail

### A — macOS: ZIP extraction silently drops symlinks → corrupt `.app` (HIGH)

`_extract_zip` (`api/update_downloader.py:262–279`) extracts each member with `zipfile.ZipFile.extract()` and then `_restore_zip_permissions` (`:281–290`), which **only `chmod`s**. There is **no symlink handling anywhere** — no `stat.S_ISLNK` check, no `os.symlink`. Python's `zipfile` materialises a symlink entry as a *regular file whose contents are the link-target string*.

A macOS Electron `.app` is full of internal relative symlinks:
`Contents/Frameworks/Electron Framework.framework/Versions/Current → A`, `…/Electron Framework → Versions/Current/Electron Framework`, `Resources`, `Libraries`, plus the Squirrel/Mantle/ReactiveObjC frameworks. After extraction those become plain text files, so `dyld` cannot load the framework and the relaunched app dies with *"the application is damaged and can't be opened."* The code signature is also invalidated.

Worse, the bug is **invisible to validation**: `_validate_staged_update_layout` for `bundle` mode only checks that `Contents/MacOS` exists and the suffix is `.app` (`api/updates/staging.py:143–149`) — both still true. Apply proceeds, replaces the good `.app` with a corrupt one, relaunches → nothing.

- The macOS in-place update asset is a **`.zip`** (`docs/PACKAGING.md:208`; built with `ditto -c -k` at `scripts/build-archive-standalone.cjs:207`). The selector prefers `.zip` for darwin but also accepts `.tar.gz`/`.tgz` (`manager.py:546, 591`) — so the zip is a property of *current packaging*, not enforced by the selector. In practice every macOS self-update ships as a zip and goes through this broken path.
- The CI builds those ZIPs with `ditto`, which *does* store symlinks correctly — the archive is fine; the **extractor** is the bug.

**Correction to an earlier hypothesis:** the Linux `tar.gz` path is **not** affected. `_extract_tarball` uses `tar.extract(..., filter="data")` (`api/update_downloader.py:255`); the PEP-706 "data" filter *preserves* safe relative symlinks. Linux symlinks survive. The symlink bug is **macOS-only** because only macOS ships its in-place payload as a zip-with-symlinks.

### B — Windows: per-machine install + silent elevation bail-out (HIGH)

`electron-builder.installer.yml:63–67` sets `nsis.perMachine: true`, so the default installer writes to `C:\Program Files\nirs4all Studio\` — **not user-writable**.

The Windows updater (`updater/__init__.py:367–379`) tests write access by writing a temp file; on failure it does:

```bat
powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >NUL 2>NUL
exit /b 0
```

Ordering (precise): `/webapp/apply` launches the detached script *first* (`app_updates.py:381`), then the renderer calls `quitForUpdate` (`useUpdates.ts:247`); the script **waits for the Electron PID to die** (`updater/__init__.py:578, 331`) before reaching the elevation branch. So by the time elevation is attempted, the app is already gone. If the user dismisses the UAC prompt, or elevation can't run (locked-down PowerShell, AppLocker, non-admin account with no admin creds, SmartScreen), `Start-Process` fails — output is swallowed — and the script `exit /b 0` **without copying anything and without relaunching**. The app simply disappears. This is the textbook "the update killed my app" report, and it hits the **default** Windows installer.

Even on the happy path the user sees a *second* UAC prompt for a background `.bat`, which many will refuse.

### C — Linux installed + AppImage: no escalation, wrong target (HIGH)

The Unix updater (`updater/__init__.py:519–535`, directory mode) does `cp -a "$STAGING_DIR"/. "$APP_DIR/"` with **no privilege escalation** (unlike Windows, there is no elevation branch at all). For deb/`/opt`/`/usr` installs that need root, the `cp` fails, errors are appended to the log, the "restore backup" also fails, and it relaunches whatever is left. For **AppImage**, `APP_DIR` resolves to the FUSE-mounted runtime directory (`dirname(process.execPath)`, `electron/backend-manager.ts:536`), which is **read-only and ephemeral** — copying into it cannot persist and never touches the real `.AppImage` file, so the relaunch reverts. Yet the selector offers the `.tar.gz` all-in-one to these users with no install-type check (`manager.py:546`; tests even assert that preference, `tests/test_updates_asset_selection.py:85`).

### D — The apply path is untested end-to-end (HIGH, systemic)

Inventory of `tests/test_update*` / `test_updater*`:
- `test_updates_asset_selection.py` — selection logic (mocked).
- `test_update_apply_validation.py` — layout validation (mocked dirs).
- `test_update_downloader.py` — zip **permission** restore + nested-root resolution (real extract, but **no symlink fixture**).
- `test_updater_force_stop.py`, `test_updater_bundle_mode.py` — assert generated **script text** contains `taskkill` / bundle branch.
- `test_updates_version_logic.py`, `test_updates_logging.py`, `test_updates_profile_managed_deps.py` — version source, offline logging, deps.

What is **never** exercised: `launch_updater()` actually spawning; the script actually backing up / replacing / restoring on a real tree; **symlink fidelity** after extraction; the **relaunch**; the **read-only / elevation** branch; any "download → apply → app boots again" cycle. `scripts/smoke-archive-standalone.cjs` *does* boot a freshly-built bundle (good) but never goes through the *update extraction + swap*. So A, B, and C each pass CI green.

### E — Why there's no Sentry crash

The failure happens in a **detached `mshta`/`wscript`/`bash` script after the app process has exited** (`updater/__init__.py:647–697`). There is no live Python/Electron process, so nothing reports to Sentry. The only artifact is `update.log` in the app log dir — which today **nothing reads back**. Absence of a Sentry event is therefore expected and tells us nothing.

---

## 3. Working-vs-broken matrix

| Build | Asset offered | Apply target | Privilege | Symlink risk | Outcome |
|---|---|---|---|---|---|
| Windows **portable** `.exe` | `-portable.exe` | swap exe in place (userland) | none | n/a | ✅ works (designed case) |
| Windows **all-in-one** (extracted, userland) | `all-in-one.zip` | xcopy over folder | none | none (win) | ✅ works |
| Windows **installed** (NSIS perMachine) | `all-in-one.zip` | xcopy over `Program Files` | **UAC; silent bail on deny** | none | ❌ **B** |
| macOS **all-in-one** (userland) | `all-in-one.zip` | replace `.app` | none if userland | **broken** | ❌ **A** |
| macOS **installed** (DMG→/Applications) | `all-in-one.zip` | replace `.app` in `/Applications` | needs admin (no escalation) | **broken** | ❌ **A**+priv |
| Linux **all-in-one** (`.tar.gz`, userland) | `all-in-one.tar.gz` | cp over folder | none | preserved | ✅ works |
| Linux **deb** (`/opt`,`/usr`) | `all-in-one.tar.gz` | cp over root dir | **needs root, none** | preserved | ❌ **C** |
| Linux **AppImage** (single file) | `all-in-one.tar.gz` | "directory mode" over a mount | n/a | n/a | ❌ **C** |

---

## 4. Test strategy — how to make this provable without 3 physical OSes and a real release

The goal: a failing test (not a user email) the next time any of A/B/C regresses. Five layers, cheapest first.

### Layer 0 — unit (every PR, already mostly present)
Asset selection, version compare, layout validation, checksum. Keep. Add nothing structural.

### Layer 1 — **Extraction fidelity** (catches A) — *the missing keystone, cheap*
A pure-Python test that runs the **real** `extract()` on a crafted archive containing the structural features of a real bundle: an internal **relative symlink** (simulating `Versions/Current`), nested dirs, an executable-bit file, a space/unicode path. Assert the staged tree is **structurally identical**: symlinks are still symlinks pointing at the right target (`Path.is_symlink()` + `os.readlink`), exec bits preserved, **no symlink-turned-into-file**. Run for **both** `.zip` and `.tar.gz`. Runs on a Linux runner in milliseconds; would have caught A on day one. Also point it at a **real built artifact** in the release workflow (you already build the archives).

### Layer 2 — **Sandboxed apply** (catches B, C, relaunch, backup/restore) — *medium*
Refactor `updater/__init__.py` for testability: extract an `apply_update(plan)` core with injectable `app_dir` / `staging_dir` / launcher seam (today it reads env + spawns detached scripts → untestable). Then, per-OS runner:
1. Build a fake "install" dir (a stub executable that writes a marker file and exits) + a fake "running app" (a `sleep` holding the PID).
2. Run the **generated** script against it.
3. Assert: backup created; files replaced; **symlinks intact**; on a forced copy failure, **backup restored**; the relaunch ran (marker file appears).
4. **Negative test for B/C:** deny writes to `app_dir` → assert the script *detects* it and takes the elevation/abort branch and **relaunches the old app or surfaces an error**, instead of vanishing. This is the regression lock for B. *Rigor note (Codex):* a Windows read-only directory attribute is **not** a reliable write-denial proxy — use an ACL deny entry, a non-admin user, or (cleanest) make the elevation command an **injectable stub** so the test asserts the abort/relaunch branch deterministically. Real UAC denial is not headlessly testable.

Windows runner runs the `.bat`; mac/linux runners run the `.sh`. All in GitHub Actions, no signing needed.

### Layer 3 — **True end-to-end self-update** (catches everything incl. A + relaunch + health) — *gold standard, on tags/nightly*
Reproduce the user's exact scenario in CI:
1. Build version N and N+1 archives (or reuse one artifact with a bumped `version.json`).
2. Stand up a **local fixture server** serving a fake GitHub releases JSON + the N+1 asset. The seam is more than one line (Codex caught this): GitHub URLs are hardcoded in **two** places — release check (`manager.py:400–405`) *and* changelog (`app_updates.py:78`) — so a single `NIRS4ALL_UPDATE_API_BASE` env override must be threaded through both. The fixture JSON must also serve **local** `browser_download_url` and `.sha256` URLs (downloads use the asset URLs from the metadata, `manager.py:441`, `app_updates.py:277`), and the test must **isolate/bypass the update cache** (`manager.py:390`) so a stale `update_cache.json` doesn't short-circuit the check.
3. Extract/install N to a temp location, launch it, drive `/check → /download-start → poll → /apply`, let it quit, let the updater run.
4. **Poll the relaunched app's `/api/health` until ready** and assert `/api/updates/version` now reports **N+1**.

Extend `scripts/smoke-archive-standalone.cjs` (it already boots a bundle + health-checks) into `scripts/smoke-self-update.cjs`. Matrix over win/mac/linux. Add a Windows variant with a **read-only app dir** (proxy for per-machine) to exercise B without a real Program Files install.

### Layer 4 — manual pre-release checklist (the things CI can't fake)
Real notarized macOS launch through Gatekeeper; real per-machine Windows install on a **non-admin** account; AppImage/deb. A short documented checklist + 2–3 VMs. Only for what Layers 1–3 can't.

### Cross-cutting — **stop flying blind (fixes E)**
- **Post-update reconciliation:** before quitting, record an "apply attempt" (target version) in app data. On next launch, if `webapp_version` did **not** advance (or a backup/staging residue exists), emit a **Sentry event with the tail of `update.log`** and show a banner ("update failed — here's the log / download the installer"). This converts every silent A/B/C failure into signal you can see.
- Surface `update.log` in the Settings → Updates panel.

---

## 5. Roadmap

> **Implementation status (2026-06-15):** P0, P1, and the runnable part of P2 are **done, Codex-reviewed, and green** (ruff + tsc + eslint + ~48 update tests). Fix A (symlink extraction) + Layer-1 extraction-fidelity test; server-side capability gating + redirect-to-installer + Windows never-vanish (B/C); post-update reconciliation + Sentry signal (E); `updater` testability seam + Layer-2 sandbox apply test; **`NIRS4ALL_UPDATE_API_BASE` seam + a full pytest e2e** (`tests/test_self_update_e2e.py`: local fixture release server → check → download → checksum → extract → apply → relaunch); UPDATE_SYSTEM.md drift fixed.
>
> **Remaining:** only the **real-Electron, per-OS smoke** (`smoke-self-update.cjs`) — deferred because it can't be validated outside CI and has three concrete design problems to solve first: (a) the online/offline gate vs a localhost fixture (the smoke forces `NIRS4ALL_OFFLINE`, which would skip the update check), (b) it needs **two** full bundles built in CI (N and N+1, the latter served as the update asset), and (c) the updater relaunches the app **without the smoke's injected env** (forced backend port + sandbox HOME are lost), so the harness can't reach the relaunched process deterministically. Plus the privileged/signed native paths (P3 — Windows elevation UX, macOS ditto-extract, Linux native channels). Nothing is committed yet.

### P0 — stop the bleeding + gain visibility (days) — ✅ DONE
1. **Fix A:** in `_extract_zip`, detect symlink entries (`stat.S_ISLNK((member.external_attr >> 16))`) and recreate with `os.symlink(link_target, path)` (the target is the entry's content). ~15 lines. Ship with the **Layer-1** test. *(Consider: on macOS, extract via `ditto`/`unzip` subprocess instead of `zipfile` so xattrs + signature survive — see P3.)*
2. **Gate the broken paths — server-side, not just UI:** for builds that can't apply in place — per-machine Windows, deb, AppImage, DMG-in-/Applications — **do not offer in-app apply**. Decide writability by `runtime_mode` + an `app_dir` write probe, and enforce it in the **backend** (`/webapp/download-info`, `/webapp/download-start`, `/webapp/apply` — today `/webapp/apply` only validates the staged *layout*, `app_updates.py:378`), not only by hiding the UI button (`UpdatesSection.tsx:857`). Otherwise stale staged updates and direct API calls still reach the broken path. For gated builds, route the "update" action to *download the proper installer / open the release page*. Keep in-app apply for portable + extracted all-in-one.
3. **Never vanish:** the Windows script must, on any abort (failed/declined elevation, copy failure), **relaunch the old executable** and surface an error rather than `exit /b 0`. Ideally refuse *before* the app quits when the target isn't writable.
4. **Reconciliation + Sentry signal (fix E)** as in §4 cross-cutting.

### P1 — make apply testable + covered (1–2 weeks)
4. Refactor `updater` (`apply_update(plan)` + seams).
5. Land **Layer 1** + **Layer 2** in CI on PRs. Extend `smoke-update-zip-permissions.py` to assert symlink fidelity.

### P2 — true end-to-end self-update CI (partial — ✅ pytest e2e done)
6. ✅ `NIRS4ALL_UPDATE_API_BASE` seam + a pytest e2e against a local fixture release server (`tests/test_self_update_e2e.py`) — runs in the backend gate on every PR.
7. ⏳ `smoke-self-update.cjs`, real-Electron per-OS matrix, on tags/nightly — see the three design problems in the status note above (online gate, two-bundle build, relaunch env injection).

### P3 — harden the privileged & signed paths (later)
8. Windows: real elevation UX — on declined UAC, **relaunch the old app** and show "update needs admin", never vanish.
9. macOS: replace the whole `.app` from a **symlink/xattr-preserving** staging (ditto/unzip), verify the relaunched app passes Gatekeeper; keep signature intact.
10. Linux: route deb to apt/installer; AppImage via AppImageUpdate or download-new-AppImage.
11. **Doc drift:** `docs/UPDATE_SYSTEM.md` still describes `api/updates.py` as one file — it is now the `api/updates/` package (`manager`, `app_updates`, `staging`, `catalog`, `dependencies`, `snapshots`). Reconcile, since it's the maintainer's map.

---

## 6. Appendix — key references

- Extraction (symlink bug): `api/update_downloader.py:262–290` (zip), `:244–260` (tar `filter="data"`).
- Asset selection: `api/updates/manager.py:532–603`; win non-portable→`.zip` at `:546–550`.
- Apply endpoint + staged metadata: `api/updates/app_updates.py:357–409`, `:265–305`.
- Layout validation: `api/updates/staging.py:119–159`.
- Updater scripts (elevation, backup/replace, relaunch): `updater/__init__.py:304–448` (win), `:453–551` (unix), `:554–697` (create/launch).
- Electron quit handshake: `electron/main.ts:260–273, 683–704`; `electron/backend-manager.ts:74–78, 644–729`.
- Installer perMachine: `electron-builder.installer.yml:63–67`.
- Frontend apply: `src/hooks/useUpdates.ts:247–266`.
