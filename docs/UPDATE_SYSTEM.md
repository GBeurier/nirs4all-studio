# Update System Documentation

This document describes the update system for nirs4all webapp, which provides:
- Webapp self-update capabilities via GitHub Releases
- nirs4all library updates via PyPI
- Managed virtual environment for isolated library updates

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Components](#components)
3. [API Reference](#api-reference)
4. [Update Flows](#update-flows)
5. [Configuration](#configuration)
6. [Frontend Integration](#frontend-integration)
7. [Security Considerations](#security-considerations)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    DESKTOP APPLICATION                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  React Frontend                                        │  │
│  │  - UpdatesSection (Settings page)                      │  │
│  │  - useUpdates hook (TanStack Query)                    │  │
│  └───────────────────────────────────────────────────────┘  │
│                              ↕                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  FastAPI Backend                                       │  │
│  │  - /api/updates/* endpoints                            │  │
│  │  - UpdateManager (version checking)                    │  │
│  │  - VenvManager (virtual environment)                   │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        ▼                              ▼
┌───────────────────┐      ┌────────────────────────┐
│  MANAGED VENV     │      │  PYINSTALLER BUNDLE    │
│  (~/.local/share/ │      │  (self-update via      │
│   nirs4all-webapp/│      │   external updater)    │
│   managed_venv/)  │      └────────────────────────┘
│  - nirs4all       │                │
│  - ML backends    │                ▼
└───────────────────┘      ┌────────────────────────┐
        │                  │  GitHub Releases       │
        ▼                  │  GBeurier/nirs4all-    │
┌───────────────────┐      │  webapp                │
│      PyPI         │      └────────────────────────┘
│  nirs4all package │
└───────────────────┘
```

### Key Design Decisions

1. **Hybrid Bundling**: The webapp core is bundled with PyInstaller, while nirs4all and ML dependencies live in a managed virtual environment.

2. **Independent Updates**: nirs4all can be updated without rebuilding the entire app.

3. **Notify-Only UX**: Updates are not applied automatically; users must explicitly trigger them.

4. **Platform Isolation**: The managed venv is isolated from system Python.

---

## Components

### Backend Components

#### 1. VenvManager (`api/venv_manager.py`)

Manages a dedicated Python virtual environment for nirs4all and its dependencies.

**Location**: Platform-specific via platformdirs
- **Windows**: `%LOCALAPPDATA%/nirs4all-webapp/managed_venv/`
- **macOS**: `~/Library/Application Support/nirs4all-webapp/managed_venv/`
- **Linux**: `~/.local/share/nirs4all-webapp/managed_venv/`

**Key Methods**:

```python
class VenvManager:
    def get_venv_info() -> VenvInfo
    def create_venv(progress_callback, force) -> Tuple[bool, str]
    def install_package(package, version, extras, upgrade) -> Tuple[bool, str, List[str]]
    def get_installed_packages() -> List[PackageInfo]
    def get_package_version(package) -> Optional[str]
    def get_nirs4all_version() -> Optional[str]
```

**Data Classes**:

```python
@dataclass
class VenvInfo:
    path: str
    exists: bool
    is_valid: bool
    python_version: Optional[str]
    pip_version: Optional[str]
    created_at: Optional[str]
    last_updated: Optional[str]
    size_bytes: int

@dataclass
class PackageInfo:
    name: str
    version: str
    location: Optional[str]
```

#### 2. UpdateManager (`api/updates.py`)

Handles version checking against GitHub and PyPI APIs.

**Key Methods**:

```python
class UpdateManager:
    def get_webapp_version() -> str
    def get_nirs4all_version() -> Optional[str]
    async def check_github_release(force) -> WebappUpdateInfo
    async def check_pypi_release(force) -> Nirs4allUpdateInfo
    async def get_update_status(force) -> UpdateStatus
```

**Version Sources**:
- **Webapp**: Reads from `version.json` in app directory
- **nirs4all**: Calls `nirs4all.__version__` in managed venv

**External APIs**:
- **GitHub**: `https://api.github.com/repos/{owner}/{repo}/releases/latest`
- **PyPI**: `https://pypi.org/pypi/{package}/json`

**Caching**:
- Results are cached in `~/.local/share/nirs4all-webapp/update_cache.json`
- Cache expires after `check_interval_hours` (default: 24)

#### 3. Updater Module (`updater/__init__.py`)

Handles webapp self-update via external scripts.

**Key Functions**:

```python
def get_update_cache_dir() -> Path
def get_staging_dir() -> Path
def get_backup_dir() -> Path
def calculate_sha256(file_path) -> str
def verify_checksum(file_path, expected_sha256) -> bool
def create_updater_script(staging_dir, app_dir) -> Tuple[Path, str]
def launch_updater(script_path) -> bool
def cleanup_old_updates() -> None
```

**Platform Scripts**:
- **Windows**: Generates `.bat` script
- **Linux/macOS**: Generates `.sh` script

**Update Flow**:
1. Download release to staging directory
2. Verify SHA256 checksum
3. Create platform-specific updater script
4. Launch updater and exit app
5. Updater waits for app exit, replaces files, relaunches

---

## API Reference

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/updates/status` | GET | Get current update status (cached) |
| `/api/updates/check` | POST | Force fresh update check |
| `/api/updates/settings` | GET | Get update settings |
| `/api/updates/settings` | PUT | Update settings |
| `/api/updates/version` | GET | Get version information |
| `/api/updates/venv/status` | GET | Get managed venv status |
| `/api/updates/venv/create` | POST | Create managed venv |
| `/api/updates/nirs4all/install` | POST | Install/upgrade nirs4all |
| `/api/updates/webapp/download-info` | GET | Get webapp download info |
| `/api/updates/webapp/download` | POST | Initiate webapp download |
| `/api/updates/webapp/restart` | POST | Request app restart |

### Request/Response Models

#### GET /api/updates/status

**Response**:
```json
{
  "webapp": {
    "current_version": "1.0.0",
    "latest_version": "1.2.0",
    "update_available": true,
    "release_url": "https://github.com/GBeurier/nirs4all-webapp/releases/v1.2.0",
    "release_notes": "### What's New\n- Feature 1\n- Bug fix 2",
    "published_at": "2024-01-15T10:30:00Z",
    "download_size_bytes": 85000000,
    "download_url": "https://github.com/.../nirs4all-webapp-1.2.0-linux.tar.gz",
    "asset_name": "nirs4all-webapp-1.2.0-linux.tar.gz",
    "checksum_sha256": null
  },
  "nirs4all": {
    "current_version": "0.6.2",
    "latest_version": "0.7.0",
    "update_available": true,
    "pypi_url": "https://pypi.org/project/nirs4all/0.7.0/",
    "release_notes": "### Changelog...",
    "requires_restart": false
  },
  "venv": {
    "path": "/home/user/.local/share/nirs4all-webapp/managed_venv",
    "exists": true,
    "is_valid": true,
    "python_version": "3.11.5",
    "pip_version": "24.0",
    "created_at": "2024-01-10T14:00:00Z",
    "last_updated": "2024-01-15T10:00:00Z",
    "size_bytes": 2500000000
  },
  "last_check": "2024-01-20T08:00:00Z",
  "check_interval_hours": 24
}
```

#### GET /api/updates/settings

**Response**:
```json
{
  "auto_check": true,
  "check_interval_hours": 24,
  "prerelease_channel": false,
  "github_repo": "GBeurier/nirs4all-webapp",
  "pypi_package": "nirs4all",
  "dismissed_versions": []
}
```

#### PUT /api/updates/settings

**Request**:
```json
{
  "auto_check": true,
  "check_interval_hours": 12,
  "prerelease_channel": false
}
```

#### POST /api/updates/venv/create

**Request**:
```json
{
  "force": false,
  "install_nirs4all": true,
  "extras": ["tensorflow", "torch"]
}
```

**Response**:
```json
{
  "success": true,
  "message": "Virtual environment created successfully",
  "already_existed": false,
  "nirs4all_installed": true,
  "install_message": "Successfully installed nirs4all[tensorflow,torch]"
}
```

#### POST /api/updates/nirs4all/install

**Request**:
```json
{
  "version": "0.7.0",
  "extras": ["tensorflow"]
}
```

**Response**:
```json
{
  "success": true,
  "message": "Successfully installed nirs4all==0.7.0",
  "version": "0.7.0",
  "output": ["Collecting nirs4all==0.7.0", "Installing...", "Successfully installed"]
}
```

#### GET /api/updates/venv/status

**Response**:
```json
{
  "venv": {
    "path": "/home/user/.local/share/nirs4all-webapp/managed_venv",
    "exists": true,
    "is_valid": true,
    "python_version": "3.11.5",
    "pip_version": "24.0",
    "created_at": "2024-01-10T14:00:00Z",
    "last_updated": "2024-01-15T10:00:00Z",
    "size_bytes": 2500000000
  },
  "packages": [
    {"name": "nirs4all", "version": "0.6.2", "location": null},
    {"name": "numpy", "version": "1.24.0", "location": null},
    {"name": "scikit-learn", "version": "1.3.0", "location": null}
  ],
  "nirs4all_version": "0.6.2"
}
```

#### GET /api/updates/version

**Response**:
```json
{
  "webapp_version": "1.0.0",
  "nirs4all_version": "0.6.2",
  "python_version": "3.11.5 (main, Oct 24 2023, 14:00:00)",
  "platform": "Linux",
  "machine": "x86_64"
}
```

---

## Update Flows

### Flow 1: Startup Update Check

```
App Startup
    │
    ▼
┌─────────────────────────┐
│ Load update settings    │
│ from config.yaml        │
└───────────┬─────────────┘
            │
            ▼
    ┌───────────────┐
    │ auto_check    │──── false ────▶ Skip
    │ enabled?      │
    └───────┬───────┘
            │ true
            ▼
┌─────────────────────────┐
│ Background task:        │
│ check_updates_background│
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Query GitHub API        │
│ Query PyPI API          │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Log available updates   │
│ (if any)                │
└─────────────────────────┘
```

### Flow 2: Manual Update Check

```
User clicks "Check Now"
    │
    ▼
┌─────────────────────────┐
│ Frontend: POST          │
│ /api/updates/check      │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Backend: Force refresh  │
│ (bypass cache)          │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Query GitHub/PyPI APIs  │
│ in parallel             │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Update cache            │
│ Return UpdateStatus     │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Frontend: Update UI     │
│ Show available updates  │
└─────────────────────────┘
```

### Flow 3: nirs4all Library Update

```
User clicks "Update nirs4all"
    │
    ▼
┌─────────────────────────┐
│ Show confirmation       │
│ dialog with version     │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Frontend: POST          │
│ /api/updates/nirs4all/  │
│ install                 │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Ensure venv exists      │
│ (create if needed)      │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Run pip install         │
│ --upgrade nirs4all      │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Update venv metadata    │
│ Invalidate query cache  │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Show success message    │
│ (No restart required)   │
└─────────────────────────┘
```

### Flow 4: Webapp Self-Update (Future)

```
User clicks "Update Webapp"
    │
    ▼
┌─────────────────────────┐
│ Download release asset  │
│ to update_cache/        │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Verify SHA256 checksum  │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Extract to staging dir  │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Create updater script   │
│ (.bat or .sh)           │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Launch updater script   │
│ Exit current app        │
└───────────┬─────────────┘
            │
            ▼
    [External Process]
┌─────────────────────────┐
│ Wait for app exit       │
│ Backup current version  │
│ Copy new files          │
│ Launch new version      │
│ Self-delete script      │
└─────────────────────────┘
```

---

## Configuration

### Settings File

**Location**: `~/.local/share/nirs4all-webapp/update_settings.yaml`

```yaml
auto_check: true
check_interval_hours: 24
prerelease_channel: false
github_repo: "GBeurier/nirs4all-webapp"
pypi_package: "nirs4all"
dismissed_versions: []
```

### Version File

**Location**: `{app_dir}/version.json`

```json
{
  "version": "1.0.0",
  "build_date": "2025-01-07T00:00:00Z",
  "commit": "abc1234"
}
```

### Cache File

**Location**: `~/.local/share/nirs4all-webapp/update_cache.json`

```json
{
  "github_release": {
    "cached_at": "2024-01-20T08:00:00Z",
    "latest_version": "1.2.0",
    "release_url": "https://...",
    "release_notes": "...",
    "published_at": "2024-01-15T10:30:00Z",
    "download_url": "https://...",
    "asset_name": "nirs4all-webapp-1.2.0-linux.tar.gz",
    "download_size_bytes": 85000000
  },
  "pypi_release": {
    "cached_at": "2024-01-20T08:00:00Z",
    "latest_version": "0.7.0",
    "pypi_url": "https://pypi.org/project/nirs4all/",
    "release_notes": "..."
  }
}
```

### Venv Metadata

**Location**: `{venv_path}/venv_metadata.json`

```json
{
  "created_at": "2024-01-10T14:00:00Z",
  "last_updated": "2024-01-15T10:00:00Z",
  "python_version": "3.11.5"
}
```

---

## Frontend Integration

### React Hooks

```typescript
// src/hooks/useUpdates.ts

// Query update status (cached)
const { data, isLoading, error } = useUpdateStatus();

// Force check for updates
const { mutate: checkUpdates, isPending } = useCheckForUpdates();

// Get/update settings
const { data: settings } = useUpdateSettings();
const { mutate: updateSettings } = useUpdateUpdateSettings();

// Venv management
const { data: venvStatus } = useVenvStatus();
const { mutate: createVenv } = useCreateVenv();

// Install/upgrade nirs4all
const { mutate: installNirs4all } = useInstallNirs4all();

// Quick check for any updates
const { hasAnyUpdate, updateCount } = useHasUpdates();
```

### Components

**UpdatesSection** (`src/components/settings/UpdatesSection.tsx`):
- Displays current versions
- Shows available updates with "Update" buttons
- Collapsible managed environment section
- Collapsible settings section (auto-check, prerelease)
- Update dialogs with release notes

### Query Keys

```typescript
const updateKeys = {
  all: ["updates"],
  status: () => [...updateKeys.all, "status"],
  settings: () => [...updateKeys.all, "settings"],
  venv: () => [...updateKeys.all, "venv"],
  version: () => [...updateKeys.all, "version"],
};
```

---

## Security Considerations

### Network Security
- All API calls use HTTPS
- GitHub API respects rate limits (60 req/hour unauthenticated)
- PyPI API is read-only

### File Security
- SHA256 checksum verification for downloads (planned)
- Backup created before webapp update
- Managed venv isolated from system Python

### User Security
- No auto-install without explicit user action
- Update settings are user-configurable
- Dismissed versions tracked to avoid repeated prompts

### Future Enhancements
- GPG signature verification for releases
- Code signing for Windows/macOS
- Delta updates for smaller downloads

---

## Directory Structure

```
~/.local/share/nirs4all-webapp/      # Linux (platformdirs)
├── update_settings.yaml             # Update preferences
├── update_cache.json                # Cached API responses
├── update_cache/                    # Downloaded updates
│   └── webapp/
│       ├── nirs4all-webapp-v1.2.0.zip
│       └── nirs4all-webapp-v1.2.0.sha256
├── update_staging/                  # Extracted updates
├── update_backup/                   # Pre-update backup
└── managed_venv/                    # Virtual environment
    ├── venv_metadata.json
    ├── bin/ (or Scripts/ on Windows)
    │   ├── python
    │   └── pip
    └── lib/python3.11/site-packages/
        ├── nirs4all/
        ├── numpy/
        └── ...

{app_dir}/                           # Application directory
├── version.json                     # Current version info
└── ...
```

---

## Troubleshooting

### Common Issues

**1. Update check fails**
- Check internet connectivity
- Verify GitHub/PyPI URLs are accessible
- Check rate limit status

**2. Managed venv creation fails**
- Ensure Python is available (bundled or system)
- Check disk space
- Verify write permissions to data directory

**3. nirs4all install fails**
- Check pip output for dependency conflicts
- Try with `--no-cache-dir`
- Verify PyPI is accessible

**4. Webapp update fails**
- Check disk space for download
- Verify write permissions to app directory
- Check Windows antivirus isn't blocking

### Logs

**Backend startup log**:
```
nirs4all webapp starting...
Webapp version: 1.0.0
```

**Update check log** (when updates available):
```
Webapp update available: 1.2.0
nirs4all update available: 0.7.0
```

**External updater log**:
- **Windows**: `%LOCALAPPDATA%/nirs4all-webapp/logs/update.log`
- **Linux/macOS**: `~/.local/state/nirs4all-webapp/logs/update.log`

---

## Future Roadmap

1. **Automatic Download**: Background download of webapp updates
2. **Progress Streaming**: WebSocket-based progress for long operations
3. **Delta Updates**: Incremental updates for smaller downloads
4. **Code Signing**: Windows Authenticode, macOS notarization
5. **Rollback UI**: User-triggered rollback to previous version
6. **ML Backend Selection**: First-launch wizard for TensorFlow/PyTorch/JAX
