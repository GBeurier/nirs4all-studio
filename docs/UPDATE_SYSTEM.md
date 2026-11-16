# Update System Documentation

This document describes the update system of nirs4all Studio.

Two things are kept up to date, by two different owners:

- **The application** (Electron shell, renderer, Rust sidecar, `uv`, the
  wheels of the required packages, the document adapters) is updated by
  installing the newer installer from GitHub Releases. The Rust sidecar
  discovers the release and selects the asset.
- **The Python environment** belongs to the user. Electron keeps its required
  packages in range and installs recommended packages on request. There are no
  sidecar routes for package or runtime management.

## What An Application Update Replaces

An application update replaces the installed application only: everything
under the installation directory, including `resources/backend/` (`native/`,
`tools/`, `wheels/`, `adapters/`). Installers ship no Python, so an update
downloads and rewrites about 150 MB of backend resources instead of a complete
Python runtime.

An update does not touch `userData`:

- `env-settings.json` and the selected Python environment (whether Studio
  created it under `userData/python-env/` or the user selected their own)
- workspaces, application settings and update settings

### Required packages after an update

At the first launch after an update, Electron takes the inventory of the
selected environment and compares it with the `required` block of the new
`recommended-config.json`:

- every required package within its `range`: nothing is installed, and the
  cached inventory is reused when the environment has not changed
- a required package missing or out of range, in a writable environment with
  no editable required package: the required set is installed at its exact
  `install` versions from the shipped wheels before the sidecar starts (the
  splash shows one progress line)
- otherwise Studio opens with the phase `needs_attention` and explains what to
  do

Recommended packages are never changed by an update. When some are older than
their recommended version, Studio shows one warning toast per session and an
indicator dot on Settings and on its `Python` tab.

### Updating from a release that had an included runtime

Such an installation has no selected environment in `env-settings.json`. After
the update the phase is `unconfigured`: Studio opens the setup page once and
the user chooses a detected environment or creates a new one. Workspaces and
settings are kept.

## Architecture Overview

```text
React Settings UI
  ├─ Updates tab  (UpdatesSection)          ── HTTP ──> Rust sidecar
  └─ Python tab   (PythonEnvironmentPage)   ── IPC ───> Electron main

Rust sidecar (sidecar/src/native_updates.rs)
  ├─ /api/updates/status, /check, /settings, /version
  ├─ /api/updates/webapp/*
  └──> GitHub Releases (release discovery, checksum sidecar)

Electron main (electron/env-manager.ts, electron/env/)
  ├─ PythonEnvApi (window.electronApi.pythonEnv)
  └──> uv ──> shipped wheels, offline payload, package index
```

## Main Components

### `sidecar/src/native_updates.rs`

Responsibilities:

- query GitHub Releases for the configured repository and channel
- select the release asset for the current platform and architecture
- bind the asset to its `.sha256` sidecar
- report the update capability of the installation (`update_capability`)
- refuse checks and downloads in offline mode

The update capability of an installed application is:

```json
{
  "can_apply_in_place": false,
  "channel": "installer",
  "reason": "installer_release",
  "install_kind": "windows-installer"
}
```

`install_kind` is `windows-installer`, `dmg` or `deb`. `reason` is
`installer_release` once a release has been discovered, `managed_install`
before. With
`channel: "installer"` the Updates tab offers the installer download
(`installer_download_url`) and opens it in the system browser; the
`download-start` and `apply` routes answer `400`.

### Electron environment manager

`electron/env-manager.ts` and `electron/env/` own the Python environment:
detection, creation, the automatic update of required packages, and the
installation of recommended packages. See
[environment architecture](_internals/environment-architecture.md).

### Frontend settings surfaces

- `src/components/settings/UpdatesSection.tsx`: application update status and
  installer download
- `src/components/python-env/PythonEnvironmentPage.tsx`: the `Python` tab of
  Settings and the `/setup` route
- `src/components/settings/SystemInfo.tsx`: versions

## Asset Selection Rules

The sidecar selects one asset per release, by platform and architecture.

| Platform | Selected asset suffix |
|---|---|
| Windows | `-win-{arch}.exe` |
| macOS | `-mac-{arch}.dmg` (or `-mac-universal.dmg`) |
| Linux | `-linux-amd64.deb` (or `-linux-{arch}.deb`) |

Rules:

- An asset whose name contains `-offline` is never selected. The offline
  installer carries a Python payload that an installed application does not
  need.
- For a published release the selection resolves to the light installer of
  the platform, for example `nirs4all.Studio-{version}-win-x64.exe`.
- When a release carries no installer for the platform, the selection looks
  for an `-all-in-one-{os}-{arch}` archive name; published releases carry
  none. A release with neither fails the check with
  `No matching installer or legacy archive for this platform and architecture`.

### Checksums

The `.sha256` sidecar published next to the selected asset is required. It is
downloaded and bound to that exact asset name; its digest is reported as
`checksum_sha256`. A release whose selected asset has no sidecar fails the
check.

## API Reference

Base path:

```text
/api/updates
```

### Status and settings

| Endpoint | Method | Purpose |
|---|---|---|
| `/status` | `GET` | Return the cached update status |
| `/check` | `POST` | Force a fresh GitHub Releases check |
| `/settings` | `GET` | Read update settings |
| `/settings` | `PUT` | Update settings |
| `/version` | `GET` | Return the application, Python and `nirs4all` versions |

### Application update endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/webapp/download-info` | `GET` | Resolve the release asset for this platform and the update channel |
| `/webapp/changelog` | `GET` | Release notes of the discovered release |
| `/webapp/download-start` | `POST` | Start an in-place download; `400` on an installed application |
| `/webapp/download-status/{job_id}` | `GET` | Poll a download job |
| `/webapp/download-cancel/{job_id}` | `POST` | Cancel a download job |
| `/webapp/staged-update` | `GET` | Inspect the staged update, if any |
| `/webapp/staged-update` | `DELETE` | Remove the staged update |
| `/webapp/apply` | `POST` | Apply a staged update; `400` on an installed application |
| `/webapp/cleanup` | `POST` | Remove stale update artifacts |
| `/webapp/last-apply-result` | `GET`, `DELETE` | Read or dismiss the result of the last apply attempt |
| `/webapp/restart` | `POST` | Request application restart |

The Python environment has no route under `/api/updates`. It is managed
through the `PythonEnvApi` IPC contract (`src/types/pythonEnvironment.ts`), and
its state is visible on the sidecar through `/api/system/readiness`,
`/api/system/env-coherence`, `/api/system/info` and
`/api/system/capabilities`. See [API_UPDATES.md](API_UPDATES.md).

## Key Response Shapes

### `GET /api/updates/webapp/download-info`

```json
{
  "update_available": true,
  "current_version": "0.15.11",
  "latest_version": "0.16.0",
  "download_url": "https://github.com/.../nirs4all.Studio-0.16.0-win-x64.exe",
  "asset_name": "nirs4all.Studio-0.16.0-win-x64.exe",
  "download_size_bytes": 123456789,
  "release_notes": "...",
  "release_url": "https://github.com/.../releases/tag/0.16.0",
  "installer_download_url": "https://github.com/.../nirs4all.Studio-0.16.0-win-x64.exe",
  "installer_asset_name": "nirs4all.Studio-0.16.0-win-x64.exe",
  "can_apply_in_place": false,
  "update_channel": "installer",
  "install_kind": "windows-installer"
}
```

The version numbers are illustrative.

### `GET /api/updates/webapp/staged-update`

```json
{
  "has_staged_update": false
}
```

## Update Flows

### 1. Background or manual check

1. the renderer calls `/status` (cached) or `/check` (fresh)
2. the sidecar queries GitHub Releases, selects the installer asset and reads
   its checksum sidecar
3. the renderer refreshes the update notice and the Updates tab

### 2. Install the application update

1. the Updates tab shows the new version with a download action
2. Studio opens `installer_download_url` in the system browser
3. the user closes Studio and runs the downloaded installer
4. the installer replaces the application; `userData` is kept

### 3. First launch of the new version

1. Electron reads `env-settings.json` and takes the inventory of the selected
   environment
2. required packages that left their range are installed from the wheels
   shipped with the new version
3. the sidecar starts on the environment and the window opens

### 4. Environment maintenance

Changing the environment, creating one, and installing or updating
recommended packages are user actions on the `Python` tab of Settings. They
go through `PythonEnvApi` and are independent of application updates.

## Storage Layout

### User data

```text
<userData>/
├── env-settings.json        selected interpreter: { "pythonPath": "..." }
├── python-inventory.json    cached package listing of the selected environment
└── python-env/              environment created by Studio, when the user chose that
    ├── python/
    └── venv/
```

Update settings are stored by the sidecar in `update_settings.yaml` in its
data directory.

### Application resources

```text
resources/backend/
├── native/
├── tools/
├── wheels/
└── adapters/
```

This tree is part of the installed application and is replaced as a whole by
an application update. The offline installer adds `offline/`.

## Security And Reliability Notes

- update checks use HTTPS GitHub endpoints
- application updates are explicit, not silent
- the selected asset must have a matching `.sha256` sidecar
- offline mode (`offline_mode` setting, `NIRS4ALL_OFFLINE`, or the `--offline`
  application switch) disables update checks and downloads
- the user's Python environment is never replaced by an application update;
  Studio never modifies editable installs

## Troubleshooting

### "No matching installer or legacy archive for this platform and architecture"

The latest GitHub Release does not contain an installer for the current
platform. Check asset naming first.

### "Matching SHA-256 sidecar asset is missing"

The release carries the installer but not its `.sha256` file. Each
downloadable artifact must ship with one.

### The update check proposes nothing while a newer release exists

Check that offline mode is off, that the release channel matches (the
prerelease setting), and `GET /api/updates/webapp/download-info`.

### Studio opens the setup page after an update

No Python environment is selected. This is expected once when updating from a
release that had an included runtime; choose or create an environment.

### Studio reports that required packages could not be installed after an update

The new version requires package versions the environment does not have, and
their installation failed or is not allowed. See the
[support runbook](_internals/support-runbook-env-mismatch.md).

## See Also

- [PACKAGING.md](PACKAGING.md)
- [API_UPDATES.md](API_UPDATES.md)
