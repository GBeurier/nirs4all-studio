# Update System — Current Status & Testing Guide

High-level overview of what works today, what's missing, and how to test updates end-to-end.

---

## 1. Current State

The update system handles two independent update channels:

| Channel | Source | Checks online? | Can install? |
|---------|--------|-----------------|--------------|
| **nirs4all library** (Python) | PyPI | Yes — queries `https://pypi.org/pypi/nirs4all/json` | Yes — `pip install` in managed venv |
| **Webapp** (Electron app) | GitHub Releases | Yes — queries `https://api.github.com/repos/GBeurier/nirs4all-webapp/releases/latest` | Code is ready, but no releases exist yet |

### Python Library Updates (Working)

The full pipeline works today:

1. **Version detection** — Backend runs `python -c "import nirs4all; print(nirs4all.__version__)"` in the active venv to get the installed version.
2. **Online check** — `UpdateManager.check_pypi_release()` queries the PyPI JSON API. Results are cached to disk for 24h (configurable). This is real and functional.
3. **Managed venv** — `VenvManager` can create an isolated Python venv, install/upgrade/uninstall packages via `pip`, list installed and outdated packages. In dev mode it defaults to `sys.prefix` (your active `.venv`).
4. **Install/upgrade** — The Settings > Advanced > Updates section lets users install or upgrade nirs4all (and optional deps like TensorFlow, PyTorch) in the managed venv.

**What "working config" means today**: There is no explicit "snapshot and restore" mechanism. The user sees their current installed version and can upgrade to a newer one, but there's no built-in rollback to a previous known-good state.

### Webapp Updates (Implemented but Untestable)

The entire backend code path is implemented and not stubbed:

1. **GitHub check** — `UpdateManager.check_github_release()` calls the GitHub Releases API, finds the correct platform asset (by OS + arch), extracts version/size/URL/checksum.
2. **Download** — `UpdateDownloader` does streaming download with progress, SHA256 verification, archive extraction (tar.gz/zip) to a staging directory. Cancellation is supported.
3. **Apply** — `updater` module generates a platform-specific script (`.bat` on Windows, `.sh` on Linux) that waits for the app to exit, backs up the current install, copies staged files, rolls back on failure, and relaunches.
4. **Frontend** — `UpdatesSection` component shows download progress, staged update status, and an "Apply" button.

**Why it can't be tested**: The `GBeurier/nirs4all-webapp` GitHub repo has **zero tags and zero releases**. The API call returns nothing, so the UI always shows "Up to date". The `electron-builder.yml` `publish` section is commented out. No production build has ever been published.

### What's NOT Implemented

- **`electron-updater`** — Documentation mentions it, but it's not in `package.json` and not imported anywhere. The update mechanism is entirely Python-driven (download + script replacement), not Electron's native auto-update.
- **Electron IPC for updates** — No IPC handlers in `main.ts` for update operations. Everything goes through HTTP to the FastAPI backend.
- **Update badge in sidebar** — The `useHasUpdates()` hook exists and returns `hasAnyUpdate` + `updateCount`, but no component consumes it. Users must navigate to Settings > Advanced to see updates.
- **Dashboard notification** — No update indicator on the dashboard.
- **Working config / rollback** — No mechanism to pin to a known-good Python environment or roll back after a bad upgrade.

---

## 2. What's Missing for a Complete Mechanism

### Must Fix Before First Release

| Item | Why | Effort |
|------|-----|--------|
| **Create a GitHub Release** | Without a release, the webapp update check always returns "no update". Need at least one tagged release with platform-specific archives attached. | CI workflow exists (`electron-release.yml`), just needs a `v*` tag push |
| **Uncomment `publish` in `electron-builder.yml`** | Set `provider: github`, `owner: GBeurier`, `repo: nirs4all-webapp` so that builds upload release assets automatically | 3 lines |
| **Validate the update script on Windows** | The `.bat` updater template looks correct but has never run against a real packaged install. Edge cases: paths with spaces, UAC elevation, antivirus interference | Manual testing |
| **Validate the update script on Linux** | Same for the `.sh` script — test with both AppImage and deb installs | Manual testing |

### Should Fix Soon After

| Item | Why |
|------|-----|
| **Wire `useHasUpdates()` to the sidebar** | Users should see a badge on the Settings nav item (or a global indicator) when updates are available, without having to check manually |
| **Working config snapshot** | Let users save current `pip freeze` output as a "known good" state. Provide a "Restore" button that runs `pip install -r` from the snapshot. Simple file-based, no complex DB needed |
| **Startup update check** | The `auto_check` setting exists but the background check on startup should surface a toast/notification, not just log to console |
| **Checksum in GitHub Releases** | The download verifier supports SHA256 but the release assets need a `.sha256` sidecar file or the checksum in the release body. Without it, verification is skipped |
| **Error recovery for partial downloads** | Download resumption on network failure. Currently a failed download requires starting over |

### Nice to Have (Later)

| Item | Why |
|------|-----|
| **`electron-updater` integration** | Native Electron auto-update (differential downloads, code signing verification). More robust than the script-based approach, but requires the publish config and signed builds |
| **Changelog display** | Show release notes diff between current and target version |
| **Multi-version dependency pinning** | Let users pick specific versions of optional deps (e.g., TensorFlow 2.15 vs 2.16) with compatibility notes |

---

## 3. Testing Guide

### 3.1 Testing Python Library Updates (Easy)

This works against the real PyPI today.

```bash
# Start the app in dev mode
cd nirs4all-webapp
npm start

# Go to Settings > Advanced > Updates
# Click "Check Now" — it will query PyPI for the latest nirs4all version
# If your installed version is older, "Update" appears
# Click "Update" to trigger pip install --upgrade
```

**To test with a specific version gap**:

```bash
# Downgrade nirs4all to an older version
pip install nirs4all==0.6.2

# Restart the backend, go to Settings > Updates
# It should show 0.7.1 available (or whatever is latest on PyPI)
# Click Update, verify it installs correctly
```

**To test managed venv creation**:

```bash
# In Settings > Advanced > Managed Environment
# Click "Create Environment"
# This creates a real venv at the platform-specific location
# Then install nirs4all into it
```

### 3.2 Testing Webapp Updates (Requires Setup)

Since `GBeurier/nirs4all-webapp` has no releases, you need a mock setup.

#### Option A: Use a Test GitHub Repository

1. **Create a test repo** (e.g., `your-user/nirs4all-webapp-test`) with releases enabled.

2. **Create a fake release**:
   ```bash
   # Package a minimal archive that looks like a build output
   mkdir -p test-release
   # Copy your current build output or create a dummy
   tar czf nirs4all-Studio-1.1.0-win-x64.tar.gz test-release/

   # Create a GitHub release with the archive attached
   gh release create v1.1.0 \
     --repo your-user/nirs4all-webapp-test \
     --title "v1.1.0" \
     --notes "Test release" \
     nirs4all-Studio-1.1.0-win-x64.tar.gz
   ```

3. **Point the app at your test repo** — modify `update_settings.yaml` or use the API:
   ```bash
   curl -X PUT http://localhost:8000/api/updates/settings \
     -H "Content-Type: application/json" \
     -d '{"github_repo": "your-user/nirs4all-webapp-test"}'
   ```
   The `github_repo` setting in `UpdateSettings` controls which repo is queried.

4. **Set a lower local version** — edit `version.json`:
   ```json
   { "version": "1.0.0", "build_date": "2025-01-07T00:00:00Z", "commit": "dev" }
   ```

5. **Check for updates** — the UI should now show "1.1.0 available". Click Download, verify the full flow.

#### Option B: Local HTTP Mock (No GitHub Needed)

For fully offline testing, mock the GitHub and PyPI API responses:

1. **Start a local mock server** (e.g., with Python):
   ```python
   # mock_update_server.py
   from fastapi import FastAPI
   from fastapi.responses import FileResponse
   import uvicorn

   app = FastAPI()

   @app.get("/repos/GBeurier/nirs4all-webapp/releases/latest")
   def github_release():
       return {
           "tag_name": "v2.0.0",
           "name": "v2.0.0",
           "prerelease": False,
           "published_at": "2026-02-01T00:00:00Z",
           "body": "## What's New\n- Test release",
           "html_url": "http://localhost:9999/release",
           "assets": [{
               "name": "nirs4all-Studio-2.0.0-win-x64.tar.gz",
               "browser_download_url": "http://localhost:9999/download/nirs4all-Studio-2.0.0-win-x64.tar.gz",
               "size": 1024000
           }]
       }

   @app.get("/download/{filename}")
   def download(filename: str):
       return FileResponse(f"./test-assets/{filename}")

   uvicorn.run(app, port=9999)
   ```

2. **Redirect the app's API calls** — You need to temporarily patch the base URLs in `api/updates.py`:
   ```python
   # In UpdateManager, change:
   GITHUB_API = "https://api.github.com"
   # To:
   GITHUB_API = "http://localhost:9999"
   ```

3. **Create a test archive** in `./test-assets/` and run the mock server.

4. **Test the full flow**: Check → Download → Verify → Stage → Apply.

#### Option C: First Real Release (Recommended for Final Validation)

When ready to validate the real production flow:

1. **Uncomment `publish` in `electron-builder.yml`**:
   ```yaml
   publish:
     provider: github
     owner: GBeurier
     repo: nirs4all-webapp
   ```

2. **Tag and push**:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

3. **Wait for CI** — `electron-release.yml` builds CPU/GPU flavors for Linux + Windows and creates a GitHub Release with all assets.

4. **Install the v1.0.0 release** on a test machine.

5. **Prepare v1.0.1** — bump `version.json`, tag `v1.0.1`, push. Wait for CI.

6. **On the test machine running v1.0.0**, click "Check for Updates" → Download → Apply. Verify the app restarts on v1.0.1.

### 3.3 Testing the Updater Script in Isolation

You can test the update script without running the full app:

```bash
# Windows: generate and inspect the script
python -c "
from updater import create_updater_script, get_staging_dir
import os, sys

staging = get_staging_dir()
os.makedirs(staging, exist_ok=True)

# Create a dummy file to simulate staged content
with open(os.path.join(staging, 'dummy.txt'), 'w') as f:
    f.write('test')

script_path, script_type = create_updater_script(staging, os.getcwd())
print(f'Script generated: {script_path}')
print(open(script_path).read())
"
```

Review the generated `.bat`/`.sh` before running it. The script expects a PID to wait on — in a real update, it's the current app's PID.

### 3.4 Quick Checklist

| Test | How to verify |
|------|---------------|
| PyPI version check | Settings > Updates shows latest nirs4all version from PyPI |
| nirs4all upgrade | Downgrade to old version, verify upgrade works |
| GitHub version check | Point `github_repo` to a repo with releases, verify detection |
| Webapp download | Trigger download, watch progress bar, check staging dir |
| Checksum verification | Provide a bad checksum, verify download is rejected |
| Apply update (Windows) | Run from a packaged build, apply, verify restart |
| Apply update (Linux) | Same on Linux with AppImage |
| Cancellation | Start a download, cancel mid-way, verify cleanup |
| Cache expiry | Set `check_interval_hours: 0`, verify each check hits the API |
| Settings persistence | Change auto-check/prerelease, restart, verify settings stick |
