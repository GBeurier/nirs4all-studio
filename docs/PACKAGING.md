# Packaging & Release System

This document describes how nirs4all-webapp is built, packaged, and released.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Build Flavors (CPU/GPU)](#build-flavors-cpugpu)
4. [Local Development Builds](#local-development-builds)
5. [CI/CD Pipeline](#cicd-pipeline)
6. [Release Process](#release-process)
7. [Asset Naming Convention](#asset-naming-convention)
8. [Code Signing](#code-signing)
9. [Troubleshooting](#troubleshooting)

---

## Overview

The packaging system produces standalone desktop applications for:
- **Linux** (x64) - AppImage, DEB
- **Windows** (x64) - NSIS installer, portable ZIP

> **Note**: macOS builds are temporarily disabled and will be added in a future release.

Each platform is available in **CPU** and **GPU** editions:
- **CPU Edition**: Lightweight, maximum compatibility
- **GPU Edition**: CUDA acceleration (Linux/Windows)

### Key Principles

1. **Electron Shell**: The desktop application uses Electron for a consistent Chromium-based WebGL experience across all platforms.

2. **Separate Backend**: The Python backend (FastAPI + nirs4all) is packaged separately with PyInstaller and spawned as a subprocess by Electron.

3. **CPU/GPU Flavors**: Two build variants allow users to choose based on their hardware capabilities.

4. **Automated CI/CD**: GitHub Actions builds all platforms and flavors automatically on release tag push.

5. **Auto-Updater**: Built-in electron-updater for seamless updates.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           BUILD PROCESS                                   │
│                                                                           │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌───────────┐ │
│  │   Source    │───▶│  Frontend   │───▶│  Electron   │───▶│  Package  │ │
│  │   Code      │    │  Build      │    │   Build     │    │  (DMG/    │ │
│  └─────────────┘    │  (Vite)     │    │             │    │  AppImage)│ │
│                     └─────────────┘    └─────────────┘    └───────────┘ │
│                                                                           │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                   │
│  │   Python    │───▶│ PyInstaller │───▶│  Backend    │  Bundled with    │
│  │   Backend   │    │   Build     │    │  Binary     │  Electron app    │
│  └─────────────┘    └─────────────┘    └─────────────┘                   │
└─────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        RELEASE ARTIFACTS                                  │
│                                                                           │
│  CPU Edition:                                                             │
│    nirs4all-{version}-linux-x64.AppImage                                 │
│    nirs4all-{version}-linux-x64.deb                                      │
│    nirs4all-{version}-win-x64.exe                                        │
│                                                                           │
│  GPU Edition (CUDA):                                                      │
│    nirs4all-{version}-gpu-linux-x64.AppImage                             │
│    nirs4all-{version}-gpu-linux-x64.deb                                  │
│    nirs4all-{version}-gpu-win-x64.exe                                    │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         GITHUB RELEASE                                    │
│  - Automatic on tag push (v*)                                            │
│  - Contains all platform/flavor combinations                              │
│  - Detected by electron-updater                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

### Application Structure

The packaged Electron application contains:

```
nirs4all.app/  (or nirs4all.exe on Windows)
├── resources/
│   ├── app.asar              # React frontend (bundled)
│   └── backend/
│       └── nirs4all-backend  # PyInstaller-packaged Python backend
├── Contents/                 # macOS app bundle structure
└── nirs4all                  # Electron main process
```

### Runtime Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Electron Application                                   │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                 Main Process (Node.js)                              │ │
│  │   - BrowserWindow management                                        │ │
│  │   - Backend lifecycle (spawn/kill via backend-manager.ts)           │ │
│  │   - File dialogs (Electron API)                                     │ │
│  │   - Auto-updater                                                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                           │                                              │
│                           │ IPC (contextBridge)                          │
│                           ▼                                              │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │              Renderer Process (Chromium)                            │ │
│  │   - React 19 App                                                    │ │
│  │   - WebGL (uniform across all platforms)                            │ │
│  │   - Pipeline Editor (dnd-kit)                                       │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                           │
                           │ HTTP/WebSocket (localhost:PORT)
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              Backend Python (Subprocess)                                  │
│   - FastAPI + Uvicorn                                                    │
│   - Packaged with PyInstaller                                            │
│   - nirs4all library (lazy-loaded ML frameworks)                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Build Flavors (CPU/GPU)

### CPU Edition (Default)

Lightweight build excluding heavy ML frameworks:
- TensorFlow, PyTorch, JAX excluded
- Smaller download size (~200MB)
- Works on any hardware

```bash
npm run build:backend:cpu
npm run build:release:cpu
```

### GPU Edition (CUDA)

For Linux/Windows with NVIDIA GPUs:
- Includes TensorFlow with CUDA support
- Requires NVIDIA drivers on target system
- Larger download size (~500MB+)

```bash
npm run build:backend:gpu
npm run build:release:gpu
```

### GPU Detection at Runtime

The backend provides GPU detection via `/api/system/build`:

```json
{
  "build": {
    "flavor": "gpu",
    "gpu_enabled": true
  },
  "gpu": {
    "cuda_available": true,
    "backends": {
      "tensorflow_cuda": { "available": true }
    }
  },
  "summary": {
    "flavor": "gpu",
    "gpu_build": true,
    "gpu_available": true,
    "gpu_type": "cuda"
  }
}
```

---

## Local Development Builds

### Prerequisites

- Python 3.11+
- Node.js 22+
- npm 10+
- Platform-specific dependencies (see below)

### Linux Dependencies

```bash
sudo apt-get install -y \
    build-essential \
    libfuse2 \
    rpm
```

### Windows Dependencies

- Visual Studio Build Tools (for native modules)
- NSIS (for installer creation, installed automatically by electron-builder)

### Building Locally

#### Quick Start (CPU Build)

```bash
# 1. Install dependencies
npm install
pip install -r requirements-cpu.txt

# 2. Build Python backend
npm run build:backend:cpu

# 3. Build and package Electron app
npm run build:electron
npm run dist
```

#### Full Release Build

```bash
# CPU Edition
./scripts/build-release.sh --flavor cpu

# GPU Edition (CUDA on Linux/Windows, Metal on macOS)
./scripts/build-release.sh --flavor gpu
```

The build script:
1. Builds the React frontend (`npm run build`)
2. Packages the Python backend with PyInstaller
3. Builds the Electron main process
4. Packages everything with electron-builder
5. Generates platform-specific installers

#### Output Locations

- **Backend Binary**: `backend-dist/nirs4all-backend`
- **Electron App**: `release/` (platform-specific formats)

#### Manual Build Steps (Advanced)

```bash
# 1. Build React frontend
npm ci
npm run build

# 2. Build Python backend (choose flavor)
NIRS4ALL_BUILD_FLAVOR=cpu pyinstaller backend.spec --clean --noconfirm
mkdir -p backend-dist && cp dist/nirs4all-backend backend-dist/

# 3. Build Electron main process
npm run build:electron

# 4. Package with electron-builder
npm run dist

# 5. Test the application
# Linux: ./release/*.AppImage
# macOS: open release/*.dmg
# Windows: ./release/*.exe
```

#### Development Mode

For development with hot reload:

```bash
# Terminal 1: Start Vite dev server
npm run dev

# Terminal 2: Start Python backend
python main.py --port 8000 --reload

# Terminal 3: Start Electron in dev mode
npm run electron:dev
```

---

## CI/CD Pipeline

### Workflows

Three GitHub Actions workflows handle the build and release process:

#### 1. CI Validation (`ci.yml`)

**Purpose**: Validate PRs and pushes to main branch.

**Trigger**: Pull requests, pushes to main.

**Jobs**:
| Job | Description | Runner |
|-----|-------------|--------|
| `frontend` | Lint, typecheck, test, build React app | ubuntu-latest |
| `backend` | Python syntax check, import validation | ubuntu-latest |
| `electron-build` | Test Electron main process compilation | ubuntu-latest |

#### 2. Pre-Release Validation (`pre-release.yml`)

**Purpose**: Validate everything works before creating a release tag.

**Trigger**: Manual (`workflow_dispatch`) with version input.

**Jobs**:
| Job | Description | Runner |
|-----|-------------|--------|
| `validate-version` | Check version format, compare with package.json | ubuntu-latest |
| `test-frontend` | Lint, test, build frontend | ubuntu-latest |
| `test-backend` | Verify Python imports, syntax check | ubuntu-latest |
| `test-build` | Full build test (backend + Electron) | ubuntu-latest |
| `summary` | Report pass/fail status | ubuntu-latest |

**Usage**:
1. Go to Actions → "Pre-Release Validation"
2. Click "Run workflow"
3. Enter version (e.g., `1.2.0`)
4. Optionally skip build test for faster validation
5. Review the summary

#### 3. Electron Release (`electron-release.yml`)

**Purpose**: Build for Linux/Windows and create GitHub Release.

**Trigger**:
- Push tag matching `v*` (e.g., `v1.0.0`, `v1.2.0-beta.1`)
- Manual dispatch with options for CPU-only or GPU builds

**Jobs**:
| Job | Description | Runner |
|-----|-------------|--------|
| `prepare` | Extract version, validate | ubuntu-latest |
| `build-linux-cpu` | Build Linux x64 CPU edition | ubuntu-22.04 |
| `build-linux-gpu` | Build Linux x64 GPU edition (CUDA) | ubuntu-22.04 |
| `build-windows-cpu` | Build Windows x64 CPU edition | windows-latest |
| `build-windows-gpu` | Build Windows x64 GPU edition (CUDA) | windows-latest |
| `release` | Create GitHub Release with all assets | ubuntu-latest |

> **Note**: macOS builds are temporarily disabled.

**Workflow Diagram**:

```
[Tag Push v1.0.0]
        │
        ▼
   ┌─────────┐
   │ prepare │  Extract version, validate
   └────┬────┘
        │
        ├─────────────────────────────┐
        │                             │
        ▼ CPU Builds                  ▼ GPU Builds
   ┌────┴────┬────────────┐    ┌──────┴────┬────────────┐
   ▼         ▼            │    ▼           ▼            │
┌──────┐ ┌───────┐        │ ┌──────┐  ┌───────┐         │
│linux │ │windows│        │ │linux │  │windows│         │
│ cpu  │ │  cpu  │        │ │ gpu  │  │  gpu  │         │
└──┬───┘ └───┬───┘        │ └──┬───┘  └───┬───┘         │
   │         │            │    │          │             │
   └─────────┴────────────┴────┴──────────┴─────────────┘
                          │
                          ▼
                     ┌─────────┐
                     │ release │  Create GitHub Release
                     └─────────┘
```

### Build Matrix

| Platform | Runner | Architecture | CPU Format | GPU Format |
|----------|--------|--------------|------------|------------|
| Linux | ubuntu-22.04 | x64 | AppImage, DEB | AppImage, DEB (CUDA) |
| Windows | windows-latest | x64 | NSIS, portable | NSIS, portable (CUDA) |

### GPU Build Specifics

**Linux/Windows GPU (CUDA)**:
- Uses `requirements-gpu.txt`
- Bundles TensorFlow with CUDA support
- Requires NVIDIA drivers on target system

---

## Release Process

### Step-by-Step

1. **Update version in package.json**:
   ```bash
   npm version 1.2.0 --no-git-tag-version
   ```

2. **Commit the change**:
   ```bash
   git add package.json
   git commit -m "Release 1.2.0"
   ```

3. **(Optional) Run pre-release validation**:
   - Go to GitHub Actions → Pre-Release Validation
   - Run with version `1.2.0`
   - Wait for all checks to pass

4. **Create and push the tag**:
   ```bash
   git tag v1.2.0
   git push origin main
   git push origin v1.2.0
   ```

5. **Monitor the build**:
   - Go to GitHub Actions → Electron Release
   - Watch the workflow progress
   - All platform/flavor combinations build in parallel

6. **Verify the release**:
   - Go to Releases page
   - Check all assets are present (CPU + GPU editions for each platform)
   - Verify release notes are correct

### Version Numbering

- **Stable releases**: `1.0.0`, `1.2.0`, `2.0.0`
- **Pre-releases**: `1.0.0-alpha.1`, `1.0.0-beta.2`, `1.0.0-rc.1`
- Pre-release versions are automatically marked as such in GitHub Releases

### Hotfix Releases

For urgent fixes:
1. Create fix on main branch
2. Increment patch version: `1.2.0` → `1.2.1`
3. Tag and push

### CPU-Only Release

To build only CPU editions (faster builds):
1. Go to GitHub Actions → Electron Release
2. Click "Run workflow"
3. Uncheck "Build GPU editions"
4. Enter the version tag

---

## Asset Naming Convention

Assets follow electron-builder's naming convention:

```
nirs4all-{version}-{platform}-{arch}[-gpu].{ext}
```

### Examples

| Platform | Asset Name | Type |
|----------|------------|------|
| Linux x64 CPU | `nirs4all-1.2.0-linux-x64.AppImage` | AppImage |
| Linux x64 CPU | `nirs4all-1.2.0-linux-x64.deb` | DEB package |
| Linux x64 GPU | `nirs4all-1.2.0-gpu-linux-x64.AppImage` | AppImage (CUDA) |
| Linux x64 GPU | `nirs4all-1.2.0-gpu-linux-x64.deb` | DEB (CUDA) |
| Windows x64 CPU | `nirs4all-1.2.0-win-x64.exe` | NSIS Installer |
| Windows x64 GPU | `nirs4all-1.2.0-gpu-win-x64.exe` | NSIS (CUDA) |

### Platform Detection

electron-updater automatically detects the correct asset based on:
- Operating system
- Architecture (x64)
- GPU suffix (if user installed GPU edition)

---

## Code Signing

### Windows Code Signing

Windows executables can be signed to avoid SmartScreen warnings.

#### Setup

1. **Obtain a certificate**: Get an EV or OV code signing certificate from:
   - DigiCert
   - Sectigo
   - GlobalSign

2. **Export as PFX**: Export the certificate with private key as `.pfx`

3. **Add GitHub Secrets**:
   ```
   WIN_CSC_LINK     = base64-encoded .pfx file
   WIN_CSC_KEY_PASSWORD = certificate password
   ```

4. **Encode the certificate**:
   ```bash
   base64 -w 0 certificate.pfx > cert_base64.txt
   ```

#### How It Works

electron-builder automatically signs when environment variables are set:

```yaml
env:
  WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
  WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
```

---

## Troubleshooting

### Common Build Issues

#### "ModuleNotFoundError" at Runtime (Backend)

The module is missing from `hiddenimports` in the spec file.

**Fix**: Add the module to `hiddenimports` in `backend.spec`:
```python
hiddenimports = [
    # ... existing imports
    'missing.module',
]
```

#### Backend Binary Size Too Large

Check for accidentally included large dependencies.

**Debug**:
```bash
# List largest files in bundle
du -ah dist/nirs4all-backend | sort -rh | head -20
```

**Fix**: Add exclusions in `backend.spec`:
```python
excludes = [
    # ... existing excludes
    'large_package',
]
```

#### Backend Fails to Start

Check if the backend binary runs standalone:
```bash
./backend-dist/nirs4all-backend --port 8000
```

If it fails, check:
- Missing dependencies in `hiddenimports`
- Missing data files in `datas`
- Platform-specific issues (check PyInstaller logs)

#### Electron Can't Find Backend

Check `electron-builder.yml` extraResources configuration:
```yaml
extraResources:
  - from: backend-dist/
    to: backend/
```

Verify the backend is copied:
```bash
ls release/*/resources/backend/
```

### CI/CD Issues

#### Build Timeout

Default timeout is 60 minutes. Increase if needed:
```yaml
jobs:
  build-linux-gpu:
    timeout-minutes: 90  # GPU builds are larger
```

#### Windows Signing Fails

Check certificate validity:
```powershell
certutil -v -dump cert.pfx
```

### Testing

#### Testing Backend Independently

```bash
# Build and run backend directly
npm run build:backend:cpu
./backend-dist/nirs4all-backend --port 8000

# Test endpoints
curl http://localhost:8000/api/health
curl http://localhost:8000/api/system/build
```

#### Testing Electron Locally

```bash
# Build everything
npm run build
npm run build:backend:cpu

# Run Electron in preview mode
npm run electron:preview
```

#### Testing Auto-Updater

1. Build and install an older version (e.g., `0.9.0`)
2. Create a new release (e.g., `1.0.0`)
3. Launch the old version
4. Go to Settings → Updates
5. Click "Check for Updates"
6. Verify it detects `1.0.0`

---

## Files Reference

| File | Purpose |
|------|---------|
| `backend.spec` | PyInstaller configuration for Python backend |
| `electron-builder.yml` | Electron packaging configuration |
| `electron/main.ts` | Electron main process entry point |
| `electron/preload.ts` | IPC bridge (contextBridge) |
| `electron/backend-manager.ts` | Backend lifecycle management |
| `scripts/build-backend.sh` | Backend build script with flavor support |
| `scripts/build-release.sh` | Full release build orchestration |
| `requirements-cpu.txt` | Python dependencies (CPU build) |
| `requirements-gpu.txt` | Python dependencies (GPU/CUDA build) |
| `.github/workflows/ci.yml` | PR validation workflow |
| `.github/workflows/pre-release.yml` | Pre-release validation |
| `.github/workflows/electron-release.yml` | Full release automation (Linux/Windows) |
| `src/types/electron.d.ts` | TypeScript types for Electron IPC |
| `docs/UPDATE_SYSTEM.md` | Updater documentation |

---

## See Also

- [UPDATE_SYSTEM.md](UPDATE_SYSTEM.md) - How the auto-updater works
- [Electron Documentation](https://www.electronjs.org/docs)
- [electron-builder Documentation](https://www.electron.build/)
- [PyInstaller Documentation](https://pyinstaller.org/en/stable/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
