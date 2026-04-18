# Updates API Reference

Quick reference for the nirs4all webapp update system API.

## Base URL

```
/api/updates
```

## Endpoints

### Update Status

#### GET /status
Get current update status for webapp and nirs4all (uses cache).

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
Get current version information.

**Response**:
```json
{
  "webapp_version": "1.0.0",
  "nirs4all_version": "0.6.2",
  "python_version": "3.11.5",
  "platform": "Linux",
  "machine": "x86_64"
}
```

---

### Managed Virtual Environment

#### GET /venv/status
Get managed venv status and installed packages.

**Response**: `VenvStatus`

#### POST /venv/create
Create the managed virtual environment.

**Request Body**:
```json
{
  "force": false,
  "install_nirs4all": true,
  "extras": ["tensorflow"]
}
```

**Response**:
```json
{
  "success": true,
  "message": "Virtual environment created successfully",
  "already_existed": false,
  "nirs4all_installed": true,
  "install_message": "Successfully installed nirs4all"
}
```

---

### nirs4all Library

#### POST /nirs4all/install
Install or upgrade nirs4all in the managed venv.

**Request Body**:
```json
{
  "version": "0.7.0",
  "extras": ["tensorflow", "torch"]
}
```

**Response**:
```json
{
  "success": true,
  "message": "Successfully installed nirs4all==0.7.0",
  "version": "0.7.0",
  "output": ["Installing...", "Successfully installed"]
}
```

---

### Webapp Update

#### GET /webapp/download-info
Get information needed to download a webapp update.

**Response**:
```json
{
  "update_available": true,
  "current_version": "0.5.0",
  "latest_version": "0.5.1",
  "download_url": "https://github.com/.../nirs4all%20Studio-0.5.1-all-in-one-linux-x64.zip",
  "asset_name": "nirs4all Studio-0.5.1-all-in-one-linux-x64.zip",
  "download_size_bytes": 85000000,
  "release_notes": "### What's New...",
  "release_url": "https://github.com/.../releases/tag/0.5.1"
}
```

#### POST /webapp/download-start
Start a background download job for the selected webapp update.

**Response**:
```json
{
  "job_id": "job_123",
  "status": "started",
  "asset_name": "nirs4all Studio-0.5.1-all-in-one-linux-x64.zip",
  "version": "0.5.1",
  "message": "Downloading nirs4all Studio-0.5.1-all-in-one-linux-x64.zip..."
}
```

#### GET /webapp/download-status/{job_id}
Poll the progress of a background download job.

#### POST /webapp/download-cancel/{job_id}
Request cancellation of an in-progress download.

#### GET /webapp/staged-update
Get information about the currently staged update, if any.

**Response**:
```json
{
  "has_staged_update": true,
  "staging_path": "/path/to/update_staging",
  "version": "0.5.1",
  "asset_name": "nirs4all Studio-0.5.1-all-in-one-linux-x64.zip",
  "update_mode": "directory"
}
```

#### DELETE /webapp/staged-update
Remove the staged update without applying it.

#### POST /webapp/apply
Create and launch the platform-specific updater script for the staged update.

**Response**:
```json
{
  "success": true,
  "message": "Update will be applied after app restart (directory mode). Please close the application.",
  "restart_required": true
}
```

#### POST /webapp/restart
Request application restart.

**Response**:
```json
{
  "success": true,
  "message": "Restart requested.",
  "restart_required": true
}
```

#### POST /webapp/download
Legacy endpoint that only returns the resolved download URL.

---

## Data Models

### UpdateStatus

```typescript
interface UpdateStatus {
  webapp: WebappUpdateInfo;
  nirs4all: Nirs4allUpdateInfo;
  venv: VenvInfo;
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
}
```

### Nirs4allUpdateInfo

```typescript
interface Nirs4allUpdateInfo {
  current_version: string | null;
  latest_version: string | null;
  update_available: boolean;
  pypi_url: string | null;
  release_notes: string | null;
  requires_restart: boolean;
}
```

### VenvInfo

```typescript
interface VenvInfo {
  path: string;
  exists: boolean;
  is_valid: boolean;
  python_version: string | null;
  pip_version: string | null;
  created_at: string | null;
  last_updated: string | null;
  size_bytes: number;
}
```

### VenvStatus

```typescript
interface VenvStatus {
  venv: VenvInfo;
  packages: PackageInfo[];
  nirs4all_version: string | null;
}
```

### PackageInfo

```typescript
interface PackageInfo {
  name: string;
  version: string;
  location: string | null;
}
```

### UpdateSettings

```typescript
interface UpdateSettings {
  auto_check: boolean;
  check_interval_hours: number;
  prerelease_channel: boolean;
  github_repo: string;
  pypi_package: string;
  dismissed_versions: string[];
}
```

---

### Environment Management

#### GET /runtime/status
#### GET /venv/status

Inspect the current Python runtime the backend is actually using.

**Response**:
```json
{
  "runtime": {
    "path": "/path/to/runtime",
    "exists": true,
    "is_valid": true,
    "python_version": "3.11.9",
    "pip_version": "25.0"
  },
  "venv": {
    "path": "/path/to/runtime",
    "exists": true,
    "is_valid": true
  },
  "packages": [],
  "nirs4all_version": "0.9.1"
}
```

The `venv` field is a compatibility alias for the same current-runtime payload.

#### POST /runtime/create
#### POST /venv/create

Legacy compatibility endpoint. The backend no longer creates an independent
managed environment on its own.

**Response**:
```json
{
  "detail": "Creating a new Python runtime is a desktop-managed action. Use the Python Runtime settings to create a runtime and switch the app to it."
}
```

#### GET /runtime/path
#### GET /venv/path

Return the current runtime root path.

**Response**:
```json
{
  "current_path": "/path/to/runtime",
  "is_valid": true,
  "exists": true
}
```

---

### Environment Coherence

> **Base URL**: `/api/system` (not `/api/updates`)

#### GET /api/system/env-coherence
Return the configured-vs-running runtime summary used by desktop diagnostics,
Settings, and preflight checks.

**Response**:
```json
{
  "coherent": true,
  "configured_python": "/Users/alice/.venvs/nirs4all/bin/python",
  "running_python": "/Users/alice/.venvs/nirs4all/bin/python",
  "running_prefix": "/Users/alice/.venvs/nirs4all",
  "runtime_kind": "managed",
  "is_bundled_default": false,
  "bundled_runtime_available": false,
  "configured_matches_running": true,
  "core_ready": true,
  "missing_core_packages": [],
  "missing_optional_packages": ["shap"],
  "python_match": true,
  "prefix_match": true,
  "runtime": {
    "python": "/Users/alice/.venvs/nirs4all/bin/python",
    "prefix": "/Users/alice/.venvs/nirs4all",
    "version": "3.11.9"
  },
  "venv_manager": {
    "python": "/Users/alice/.venvs/nirs4all/bin/python",
    "prefix": "/Users/alice/.venvs/nirs4all"
  }
}
```

Optional desktop fields:

- `electron_expected_python`
- `electron_match`

`coherent` now means the running backend interpreter matches the Python
configured by Electron. The backend does not support deferred custom-path
activation anymore.

#### GET /api/system/build
Get build information including `runtime_mode`.

**Response**:
```json
{
  "build": {
    "flavor": "cpu",
    "gpu_enabled": false
  },
  "runtime_mode": "managed",
  "is_frozen": false,
  "summary": {
    "runtime_mode": "managed"
  }
}
```

Use `runtime_mode` as the primary contract for UI/runtime behavior. `is_frozen` is kept for compatibility with the legacy PyInstaller path.

---

### Run Preflight

> **Base URL**: `/api/runs` (not `/api/updates`)

#### POST /api/runs/preflight
Pre-run validation: checks environment coherence and pipeline operator imports.

**Request Body**:
```json
{
  "pipeline_ids": ["pipeline_1", "pipeline_2"],
  "inline_pipeline": null
}
```

**Response**:
```json
{
  "ready": true,
  "issues": []
}
```

Issue types when `ready: false`:
- `env_mismatch` — VenvManager targets a different env than the running backend
- `not_found` — A referenced `pipeline_id` does not exist
- `missing_module` — An operator class cannot be imported (includes `details` with `step_name`, `step_type`, `error`)

---

## Error Responses

All endpoints may return error responses:

```json
{
  "detail": "Error message"
}
```

| Status Code | Description |
|-------------|-------------|
| 400 | Bad request (e.g., no update available) |
| 500 | Internal server error (e.g., venv creation failed) |
| 501 | Not implemented (e.g., nirs4all not available) |

---

## Examples

### Check for Updates (TypeScript)

```typescript
import { getUpdateStatus, checkForUpdates } from "@/api/client";

// Get cached status
const status = await getUpdateStatus();
if (status.webapp.update_available) {
  console.log(`Update available: ${status.webapp.latest_version}`);
}

// Force refresh
const freshStatus = await checkForUpdates();
```

### Install nirs4all (TypeScript)

```typescript
import { installNirs4all } from "@/api/client";

const result = await installNirs4all({
  version: "0.7.0",
  extras: ["tensorflow"]
});

if (result.success) {
  console.log(`Installed: ${result.version}`);
}
```

### Using React Hooks

```typescript
import { useUpdateStatus, useInstallNirs4all } from "@/hooks/useUpdates";

function UpdateButton() {
  const { data: status } = useUpdateStatus();
  const { mutate: install, isPending } = useInstallNirs4all();

  if (!status?.nirs4all?.update_available) return null;

  return (
    <button
      onClick={() => install({ version: status.nirs4all.latest_version })}
      disabled={isPending}
    >
      Update to {status.nirs4all.latest_version}
    </button>
  );
}
```
