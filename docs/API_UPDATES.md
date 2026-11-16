# Updates API Reference

Quick reference for the application update API served by the Rust sidecar,
and for the interfaces that expose the Python environment.

Application updates are HTTP routes of the sidecar. The Python environment is
not managed over HTTP: the Electron main process owns it and exposes it to the
renderer through the `PythonEnvApi` IPC contract. The sidecar only reports what
the scientific host runs.

## Base URL

```
/api/updates
```

## Endpoints

### Update Status

#### GET /status
Get the current application update status (uses cache).

**Response**: `UpdateStatus`

#### POST /check
Force a fresh check for updates (bypasses cache).

**Response**: `UpdateStatus`

---

### Settings

#### GET /settings
Get update settings.

**Response**: `UpdateSettings`

#### PUT /settings
Update settings.

**Request Body**:
```json
{
  "auto_check": true,
  "check_interval_hours": 24,
  "prerelease_channel": false
}
```

**Response**: `UpdateSettings`

---

### Version Info

#### GET /version
Get the application version and the versions reported by the selected Python
environment. Answers `503` (`reason: "not_configured"`) when the sidecar runs
without a Python host.

**Response**:
```json
{
  "webapp_version": "0.15.11",
  "nirs4all_version": "1.4.16",
  "python_version": "3.11.13",
  "platform": "Linux",
  "machine": "x86_64"
}
```

---

### Application Update

#### GET /webapp/download-info
Resolve the release asset for this platform and the update channel of this
installation.

**Response**:
```json
{
  "update_available": true,
  "current_version": "0.15.11",
  "latest_version": "0.16.0",
  "download_url": "https://github.com/.../nirs4all.Studio-0.16.0-linux-amd64.deb",
  "asset_name": "nirs4all.Studio-0.16.0-linux-amd64.deb",
  "download_size_bytes": 185000000,
  "release_notes": "### What's New...",
  "release_url": "https://github.com/.../releases/tag/0.16.0",
  "installer_download_url": "https://github.com/.../nirs4all.Studio-0.16.0-linux-amd64.deb",
  "installer_asset_name": "nirs4all.Studio-0.16.0-linux-amd64.deb",
  "can_apply_in_place": false,
  "update_channel": "installer",
  "install_kind": "deb"
}
```

The selected asset is always the installer of the platform; an asset whose
name contains `-offline` is never selected, nor is the macOS wheel archive
(`-mac-arm64-wheels.tar.gz`). Version numbers and sizes in this
document are illustrative.

#### GET /webapp/changelog
Release notes of the discovered release. Optional query:
`current_version=<version>`.

#### POST /webapp/download-start
Start an in-place download job. An installed application updates through its
installer, so this route answers `400`:

```json
{
  "detail": "This build updates through its installer and cannot apply an archive in place"
}
```

#### GET /webapp/download-status/{job_id}
Poll the progress of a download job.

#### POST /webapp/download-cancel/{job_id}
Request cancellation of a download job.

#### GET /webapp/staged-update
Get information about the currently staged update, if any.

**Response**:
```json
{
  "has_staged_update": false
}
```

#### DELETE /webapp/staged-update
Remove the staged update without applying it.

#### POST /webapp/apply
Apply a staged update. Accepts only `{"confirm": true}`. Answers `400` on an
installed application (`"This build cannot apply updates in place"`).

#### POST /webapp/cleanup
Remove stale update artifacts.

#### GET /webapp/last-apply-result
Result of the last apply attempt; `{"status": "none"}` when there is nothing
to report.

#### DELETE /webapp/last-apply-result
Dismiss the stored result.

#### POST /webapp/restart
Request application restart.

**Response**:
```json
{
  "success": true,
  "message": "Restart requested; Electron will restart the native backend",
  "restart_required": true
}
```

---

## Data Models

### UpdateStatus

```typescript
interface UpdateStatus {
  webapp: WebappUpdateInfo;
  update_capability?: UpdateCapability | null;
  last_check: string | null;
  check_interval_hours: number;
}
```

### WebappUpdateInfo

```typescript
interface WebappUpdateInfo {
  current_version: string;
  latest_version: string | null;
  update_available: boolean;
  release_url: string | null;
  release_notes: string | null;
  published_at: string | null;
  download_size_bytes: number | null;
  download_url: string | null;
  asset_name: string | null;
  checksum_sha256: string | null;
  is_prerelease: boolean;
  installer_download_url?: string | null;
  installer_asset_name?: string | null;
}
```

### UpdateCapability

```typescript
interface UpdateCapability {
  can_apply_in_place: boolean;
  channel: "in_place" | "installer";
  reason: string;
  install_kind: string;
}
```

An installed application reports `can_apply_in_place: false` and
`channel: "installer"`.

### UpdateSettings

```typescript
interface UpdateSettings {
  auto_check: boolean;
  check_interval_hours: number;
  prerelease_channel: boolean;
  github_repo: string;
  pypi_package: string;
  dismissed_versions: string[];
  offline_mode: string;
}
```

---

## Python Environment

### PythonEnvApi (Electron IPC)

Exposed by the preload script as `window.electronApi.pythonEnv`; types in
`src/types/pythonEnvironment.ts`. This is the only interface that changes the
environment.

| Method | Purpose |
|---|---|
| `getState()` | Current `PythonEnvState`: phase, selected interpreter, its report, problem, activity |
| `detect(refresh?)` | List the interpreters found on this machine, each with its report |
| `inspect(path)` | Inspect an interpreter path or environment directory without changing anything |
| `describeNewEnvironment()` | What Studio would install in an environment it creates |
| `browse()` | File dialog to choose a Python executable |
| `chooseDirectory()` | Folder dialog to choose where a new environment is created |
| `apply({ pythonPath, packages })` | Switch to an existing interpreter; required packages are always installed |
| `create({ directory?, packages })` | Create a Studio environment and switch to it |
| `installPackages(packages)` | Install or update recommended packages in the selected environment |
| `retry()` | Re-run the startup check, then restart the analysis backend |
| `onState(handler)` | Subscribe to state changes; returns the unsubscribe function |

`packages` are names from the recommended catalogue (`optional` in
`recommended-config.json`); unknown names are refused. `apply`, `create`,
`installPackages` and `retry` resolve to a `PythonEnvActionResult`
(`success`, `message`, `hostRestarted`, `state`); a failure is returned as a
message, never thrown, and a failed switch restores the previous selection.

`PythonEnvState.phase` is `unconfigured`, `ready`, `busy` or
`needs_attention`. `problem.code` is one of `interpreter_missing`,
`interpreter_unusable`, `required_not_installable`, `required_update_failed`,
`host_failed`.

### Sidecar system routes

> **Base URL**: `/api/system` (not `/api/updates`)

These routes are read-only. They describe the interpreter the sidecar was
started with.

#### GET /api/system/readiness
Readiness of the sidecar and of the scientific host.

**Response**:
```json
{
  "core_ready": true,
  "elapsed_seconds": 4.2,
  "ml_error": null,
  "ml_loading": false,
  "ml_ready": true,
  "workspace_ready": true,
  "native_prediction_ready": true,
  "native_training_ready": true
}
```

`ml_loading` is true while the host is being acquired. When the host is
neither ready nor loading, `ml_error` holds the acquisition reason code (for
example `studio_adapters_unavailable` or
`scientific_distribution_version_unsupported`).

#### GET /api/system/env-coherence
Compare the interpreter the sidecar was given with the one the host reports.
Electron uses it to confirm a switch. Answers `503` when no Python host is
configured or when the probe fails.

**Response**:
```json
{
  "coherent": true,
  "configured_python": "/home/alice/.config/nirs4all-webapp/python-env/venv/bin/python",
  "running_python": "/home/alice/.config/nirs4all-webapp/python-env/venv/bin/python",
  "running_prefix": "/home/alice/.config/nirs4all-webapp/python-env/venv",
  "configured_matches_running": true,
  "core_ready": true,
  "runtime_engine_capabilities": {},
  "missing_core_packages": [],
  "missing_optional_packages": [],
  "python_match": true,
  "prefix_match": true,
  "runtime": {
    "python": "/home/alice/.config/nirs4all-webapp/python-env/venv/bin/python",
    "prefix": "/home/alice/.config/nirs4all-webapp/python-env/venv",
    "version": "3.11.13"
  },
  "venv_manager": {
    "python": "/home/alice/.config/nirs4all-webapp/python-env/venv/bin/python",
    "prefix": "/home/alice/.config/nirs4all-webapp/python-env/venv"
  },
  "electron_expected_python": "/home/alice/.config/nirs4all-webapp/python-env/venv/bin/python",
  "electron_match": true
}
```

`coherent` means the running interpreter is the configured one. `core_ready`
is false, with `missing_core_packages: ["nirs4all"]`, when `nirs4all` cannot
be imported. The content of `runtime_engine_capabilities` is elided here.

#### GET /api/system/info
Interpreter, operating system and installed package versions, read from
distribution metadata without importing packages. Without a usable Python host
the route still answers `200` with `python_available: false` and a
`python_error`.

#### GET /api/system/capabilities
Which capability packages (for example `nirs4all`, `torch`, `tensorflow`,
`jax`, `shap`) are installed, as `{ "capabilities": { "<module>": true } }`,
without importing them. Answers `503` when no Python host is configured.

#### GET /api/system/build
Build metadata assembled in Rust without Python.

**Response**:
```json
{
  "build": {
    "flavor": "development",
    "gpu_enabled": false
  },
  "summary": {
    "flavor": "development",
    "gpu_build": false
  }
}
```

---

## Error Responses

Update routes report errors as:

```json
{
  "detail": "Error message"
}
```

| Status Code | Description |
|-------------|-------------|
| 400 | Bad request (e.g., no update available, offline mode, in-place update not available) |
| 404 | Unknown update route |
| 405 | Method not allowed |
| 409 | Conflicting update operation in progress |

System routes that need the Python host report its absence or failure as
`503` with a typed error envelope (`error.code`, `error.details.reason`).

---

## Examples

### Check for Updates (TypeScript)

```typescript
import { getUpdateStatus, checkForUpdates } from "@/api/updates";

// Get cached status
const status = await getUpdateStatus();
if (status.webapp.update_available) {
  console.log(`Update available: ${status.webapp.latest_version}`);
}

// Force refresh
const freshStatus = await checkForUpdates();
```

### Read the Python environment (TypeScript)

```typescript
const pythonEnv = window.electronApi?.pythonEnv;
if (pythonEnv) {
  const state = await pythonEnv.getState();
  if (state.phase === "needs_attention") {
    console.log(state.problem?.code, state.problem?.message);
  }
  const unsubscribe = pythonEnv.onState((next) => console.log(next.phase));
}
```

### Using React Hooks

```typescript
import { useUpdateStatus } from "@/hooks/useUpdates";

function UpdateNotice() {
  const { data: status } = useUpdateStatus();

  if (!status?.webapp?.update_available) return null;

  return <span>Version {status.webapp.latest_version} is available</span>;
}
```
