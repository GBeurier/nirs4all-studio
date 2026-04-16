# Update System Documentation

This document describes the current update system used by `nirs4all-webapp`.

The update stack now covers two separate concerns:

- application self-update through GitHub Releases
- optional Python environment and `nirs4all` management for writable runtimes only

For the all-in-one ZIP bundle, the embedded runtime is read-only. The app can still check for and stage application updates, but it must not mutate `resources/backend/python-runtime/`.

## Runtime Modes

`/api/system/build` exposes the runtime contract used by the backend and frontend:

| `runtime_mode` | Meaning | Writable Python runtime |
|---|---|---|
| `development` | Local development / ad hoc Python launch | yes |
| `managed` | Installer-style runtime managed outside the app bundle | yes |
| `bundled` | All-in-one ZIP with embedded `python-runtime/python` | no |
| `pyinstaller` | Legacy frozen backend mode kept for compatibility | no |

`is_frozen` is still returned for compatibility, but new logic should rely on `runtime_mode`.

## Architecture Overview

```text
React Settings UI
  ├─ UpdatesSection
  ├─ DependenciesManager
  └─ ConfigAlignment
          |
          v
FastAPI backend
  ├─ api/updates.py
  ├─ api/update_downloader.py
  ├─ api/venv_manager.py
  ├─ api/recommended_config.py
  └─ api/system.py
          |
          +--> GitHub Releases (desktop app updates)
          +--> PyPI (nirs4all metadata / installs for managed runtimes)
          +--> updater/__init__.py (stage/apply/restart scripts)
```

### What changed versus the old model

- Desktop releases are no longer described as a PyInstaller-first product.
- Installed desktop builds and all-in-one ZIP builds now share the same update channel, but not the same runtime mutability.
- The frontend uses `runtime_mode`, not only `is_frozen`, to decide when package-management actions must be disabled.

## Main Components

### `api/updates.py`

Responsibilities:

- check GitHub Releases for desktop updates
- check PyPI for `nirs4all` updates
- select the correct release asset for the current platform/runtime
- expose update, download, staging, and apply endpoints
- block runtime mutations when the runtime is read-only

Important details:

- installed Windows builds prefer all-in-one ZIP assets
- portable Windows builds prefer `-portable.exe`
- macOS prefers ZIP assets
- Linux prefers `.tar.gz` / `.tgz` all-in-one assets, with ZIP still accepted for backward compatibility
- when multiple ZIPs exist, names containing `all-in-one` are preferred

### `api/update_downloader.py`

Responsibilities:

- download the selected release asset
- verify file size and optional SHA256
- extract ZIP or tarball content into staging
- restore POSIX executable bits from ZIP metadata on Linux/macOS

The ZIP permission restoration is required for bundled Electron and bundled Python binaries to remain executable after staging.

### `updater/__init__.py`

Responsibilities:

- determine update mode:
  - `portable`
  - `bundle`
  - `directory`
- create platform-specific apply scripts
- back up the current install
- replace files from staging
- relaunch the updated app

On macOS app bundles, the updater relaunches the `.app` itself. On non-bundle platforms it relaunches the executable directly.

### `api/venv_manager.py`

Responsibilities:

- manage the writable Python environment used by installer-style builds
- create the managed venv
- install/uninstall/update Python packages
- report installed package state

This component is not allowed to mutate the runtime in `bundled` or `pyinstaller` modes.

### Frontend settings surfaces

The following frontend surfaces react to `runtime_mode`:

- `src/components/settings/UpdatesSection.tsx`
- `src/components/settings/DependenciesManager.tsx`
- `src/components/settings/ConfigAlignment.tsx`
- `src/components/settings/SystemInfo.tsx`

In `bundled` mode they show the runtime as read-only and disable incompatible actions.

## Asset Selection Rules

The backend chooses update assets by platform and runtime mode.

### Installed desktop builds

Preferred update assets:

- Windows: `nirs4all Studio-{version}-all-in-one-win-x64.zip`
- macOS: `nirs4all Studio-{version}-all-in-one-mac-{arch}.zip`
- Linux: `nirs4all Studio-{version}-all-in-one-linux-x64.tar.gz`

### Portable Windows builds

Preferred update asset:

- `nirs4all Studio-{version}-win-x64-portable.exe`

### Formats intentionally excluded from in-place update

- Windows installer `.exe`
- `.dmg`
- `.deb`
- `.AppImage`

These are installer/distribution artifacts, not updater payloads.

### Checksums

If a matching `.sha256` sidecar asset exists in the GitHub Release, it is downloaded and used for verification before staging.

## API Reference

Base path:

```text
/api/updates
```

### Status and settings

| Endpoint | Method | Purpose |
|---|---|---|
| `/status` | `GET` | Return cached update status |
| `/check` | `POST` | Force a fresh GitHub/PyPI check |
| `/settings` | `GET` | Read update settings |
| `/settings` | `PUT` | Update settings |
| `/version` | `GET` | Return version and Python runtime info |

### Managed runtime endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/venv/status` | `GET` | Inspect the managed venv |
| `/venv/create` | `POST` | Create the managed venv |
| `/nirs4all/install` | `POST` | Install or upgrade `nirs4all` |
| `/dependencies/install` | `POST` | Install an optional package in the managed venv |
| `/dependencies/uninstall` | `POST` | Remove an optional package |
| `/dependencies/update` | `POST` | Update one package |
| `/dependencies/revert` | `POST` | Revert to the recommended package state |

In `bundled` and `pyinstaller` modes, these mutation endpoints return `400` with a read-only message instead of attempting a `pip` operation.

### Webapp update endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/webapp/download-info` | `GET` | Resolve the current release asset for this platform |
| `/webapp/download-start` | `POST` | Create a background download job |
| `/webapp/download-status/{job_id}` | `GET` | Poll job progress |
| `/webapp/download-cancel/{job_id}` | `POST` | Cancel an active download |
| `/webapp/staged-update` | `GET` | Inspect the staged update, if any |
| `/webapp/staged-update` | `DELETE` | Remove the staged update |
| `/webapp/apply` | `POST` | Launch the updater script and mark restart as required |
| `/webapp/cleanup` | `POST` | Remove stale update artifacts |
| `/webapp/restart` | `POST` | Request application restart |
| `/webapp/download` | `POST` | Legacy endpoint returning only the resolved download URL |

## Key Response Shapes

### `GET /api/system/build`

```json
{
  "build": {
    "flavor": "cpu",
    "gpu_enabled": false
  },
  "runtime_mode": "bundled",
  "is_frozen": false,
  "summary": {
    "runtime_mode": "bundled"
  }
}
```

### `GET /api/updates/webapp/download-info`

```json
{
  "update_available": true,
  "current_version": "0.5.0",
  "latest_version": "0.5.1",
  "download_url": "https://github.com/.../nirs4all%20Studio-0.5.1-all-in-one-win-x64.zip",
  "asset_name": "nirs4all Studio-0.5.1-all-in-one-win-x64.zip",
  "download_size_bytes": 123456789,
  "release_notes": "...",
  "release_url": "https://github.com/.../releases/tag/0.5.1"
}
```

### `POST /api/updates/webapp/download-start`

```json
{
  "job_id": "job_123",
  "status": "started",
  "version": "0.5.1",
  "asset_name": "nirs4all Studio-0.5.1-all-in-one-win-x64.zip",
  "message": "Downloading nirs4all Studio-0.5.1-all-in-one-win-x64.zip..."
}
```

### `GET /api/updates/webapp/staged-update`

```json
{
  "has_staged_update": true,
  "staging_path": "/path/to/update_staging",
  "version": "0.5.1",
  "asset_name": "nirs4all Studio-0.5.1-all-in-one-linux-x64.zip",
  "update_mode": "directory"
}
```

## Update Flows

### 1. Background or manual check

1. frontend calls `/status` or `/check`
2. backend queries GitHub Releases and PyPI
3. backend caches the result
4. frontend refreshes update banners and version panels

### 2. Download and stage application update

1. frontend calls `/webapp/download-start`
2. backend creates an update job
3. `api/update_downloader.py` downloads and extracts the selected asset
4. staging metadata records:
   - target version
   - asset name
   - expected update mode
5. frontend polls `/webapp/download-status/{job_id}`

### 3. Apply staged update

1. frontend calls `/webapp/apply`
2. backend validates staged content
3. `updater/__init__.py` creates the platform-specific apply script
4. current app exits
5. updater replaces files, restores from backup on failure, then relaunches

### 4. Managed runtime maintenance

Only in writable modes:

1. create or inspect the managed venv
2. install or update `nirs4all`
3. install or remove optional packages
4. restart backend if required

In `bundled` mode these flows are intentionally blocked.

## Read-Only Guardrails For All-In-One Bundles

When `NIRS4ALL_RUNTIME_MODE=bundled`, the backend refuses runtime mutations instead of trying to repair the embedded venv in place.

Blocked actions include:

- managed venv creation
- `nirs4all` install/upgrade
- optional dependency install/uninstall/update/revert
- config alignment mutations in `api/recommended_config.py`
- snapshot restore flows that would rewrite the managed environment

Expected error:

```json
{
  "detail": "Package management is not available in the all-in-one bundle."
}
```

This is intentional and not a bug.

## Storage Layout

### Writable state

Update settings, cache, staging, backup, and logs live under the app data directory:

- installed builds: standard platformdirs locations
- portable Windows builds: `.nirs4all/` next to the portable executable

Typical directories:

```text
<userData>/
├── update_settings.yaml
├── update_cache.json
├── update_cache/
├── update_staging/
├── update_backup/
└── managed_venv/
```

### Embedded runtime

The all-in-one runtime lives inside the packaged app:

```text
resources/backend/python-runtime/
```

That path is part of the distributed artifact and must remain read-only at runtime.

## Security And Reliability Notes

- update checks use HTTPS GitHub and PyPI endpoints
- application updates are explicit, not silent
- `.sha256` sidecars are used when available
- staged updates are applied from a backup-aware external script
- ZIP extraction restores recorded POSIX permissions on Linux/macOS
- all-in-one runtime mutation is blocked by design

## Troubleshooting

### "No download URL available for this platform"

The latest GitHub Release does not contain a compatible update asset for the current platform/runtime. Check asset naming first.

### Portable Windows app downloads a ZIP

That is a release naming or asset selection regression. Portable mode should prefer `-portable.exe`, not the all-in-one ZIP.

### Bundled app says package management is unavailable

Expected behavior. The embedded runtime in the all-in-one bundle is read-only.

### Linux or macOS staged ZIP loses executable bits

Run the dedicated smoke:

```bash
python3 scripts/smoke-update-zip-permissions.py --archive path/to/archive.zip --platform linux
```

### Update is downloaded but not applied

Inspect:

- `/api/updates/webapp/staged-update`
- backend logs
- updater log under the app log directory

## See Also

- [PACKAGING.md](PACKAGING.md)
- [API_UPDATES.md](API_UPDATES.md)
