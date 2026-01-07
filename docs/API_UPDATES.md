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
  "current_version": "1.0.0",
  "latest_version": "1.2.0",
  "download_url": "https://github.com/.../nirs4all-webapp-1.2.0-linux.tar.gz",
  "asset_name": "nirs4all-webapp-1.2.0-linux.tar.gz",
  "download_size_bytes": 85000000,
  "release_notes": "### What's New...",
  "release_url": "https://github.com/.../releases/v1.2.0"
}
```

#### POST /webapp/download
Initiate webapp update download (returns download URL for now).

**Response**:
```json
{
  "status": "ready",
  "download_url": "https://github.com/...",
  "asset_name": "nirs4all-webapp-1.2.0-linux.tar.gz",
  "version": "1.2.0",
  "message": "Download URL ready."
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
