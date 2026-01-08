# Packaging & Release System

This document describes how nirs4all-webapp is built, packaged, and released.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Local Development Builds](#local-development-builds)
4. [CI/CD Pipeline](#cicd-pipeline)
5. [Release Process](#release-process)
6. [Asset Naming Convention](#asset-naming-convention)
7. [Code Signing](#code-signing)
8. [Troubleshooting](#troubleshooting)

---

## Overview

The packaging system produces standalone desktop applications for:
- **Linux** (x64) - `.tar.gz`
- **Windows** (x64) - `.zip` (portable) + `.exe` installer (NSIS), with optional code signing
- **macOS Intel** (x64) - `.tar.gz`
- **macOS Apple Silicon** (arm64) - `.tar.gz`

### Key Principles

1. **PyInstaller Bundling**: The webapp core (FastAPI backend + PyWebView launcher) is bundled using PyInstaller.

2. **Separate Library Management**: The nirs4all library and ML backends are NOT bundled. They're installed in a managed virtual environment on first run.

3. **Automated CI/CD**: GitHub Actions builds all platforms automatically on release tag push.

4. **Updater Integration**: Release assets follow a naming convention that the built-in updater recognizes.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           BUILD PROCESS                                   │
│                                                                           │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌───────────┐ │
│  │   Source    │───▶│  Frontend   │───▶│ PyInstaller │───▶│  Archive  │ │
│  │   Code      │    │  Build      │    │   Bundle    │    │  + SHA256 │ │
│  └─────────────┘    │  (Vite)     │    └─────────────┘    └───────────┘ │
│                     └─────────────┘                                       │
└─────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        RELEASE ARTIFACTS                                  │
│                                                                           │
│  nirs4all-webapp-{version}-linux-x64.tar.gz       (+ .sha256)           │
│  nirs4all-webapp-{version}-windows-x64.zip        (+ .sha256) portable  │
│  nirs4all-webapp-{version}-windows-x64-setup.exe  (+ .sha256) installer │
│  nirs4all-webapp-{version}-macos-x64.tar.gz       (+ .sha256)           │
│  nirs4all-webapp-{version}-macos-arm64.tar.gz     (+ .sha256)           │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         GITHUB RELEASE                                    │
│  - Automatic on tag push (v*)                                            │
│  - Contains all platform archives                                         │
│  - Detected by webapp's built-in updater                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Bundle Contents

The PyInstaller bundle (`dist/nirs4all-webapp/`) contains:

```
nirs4all-webapp/
├── nirs4all-webapp          # Main executable (or .exe on Windows)
└── _internal/
    ├── dist/                # React frontend build
    │   ├── index.html
    │   └── assets/
    ├── public/              # Static assets (icons, etc.)
    ├── version.json         # Version info (injected at build time)
    ├── api/                 # FastAPI backend modules
    ├── websocket/           # WebSocket manager
    ├── updater/             # Self-update modules
    └── [Python libraries]   # Bundled dependencies
```

### What's NOT Bundled

To keep the bundle size manageable (~50-150 MB compressed), these are excluded:
- `nirs4all` library (installed via managed venv)
- TensorFlow, PyTorch, JAX (installed on demand)
- NumPy, SciPy, scikit-learn (part of nirs4all)

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
    libgirepository1.0-dev \
    libcairo2-dev \
    gir1.2-gtk-3.0 \
    gir1.2-webkit2-4.1 \
    upx-ucl
```

### Building Locally

#### Using the Build Script (Recommended)

```bash
# Full build with archive
python scripts/build.py --version 1.0.0

# Skip frontend if already built
python scripts/build.py --version 1.0.0 --skip-frontend

# Skip archive creation (just build executable)
python scripts/build.py --version 1.0.0 --skip-archive
```

The build script:
1. Updates `version.json` with version, commit hash, and build timestamp
2. Builds the frontend (`npm run build`)
3. Runs PyInstaller with the spec file
4. Creates a platform-specific archive
5. Generates SHA256 checksum

#### Output Locations

- **Executable**: `dist/nirs4all-webapp/nirs4all-webapp`
- **Archive**: `release/nirs4all-webapp-{version}-{platform}-{arch}.{ext}`
- **Checksum**: `release/nirs4all-webapp-{version}-{platform}-{arch}.{ext}.sha256`

#### Manual Build (Advanced)

```bash
# 1. Build frontend
npm ci
npm run build

# 2. Update version.json manually
cat > version.json << EOF
{
  "version": "1.0.0",
  "build_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "commit": "$(git rev-parse --short HEAD)"
}
EOF

# 3. Run PyInstaller
pyinstaller nirs4all-webapp.spec --clean --noconfirm

# 4. Test the executable
./dist/nirs4all-webapp/nirs4all-webapp
```

---

## CI/CD Pipeline

### Workflows

Two GitHub Actions workflows handle the build and release process:

#### 1. Pre-Release Validation (`pre-release.yml`)

**Purpose**: Validate everything works before creating a release tag.

**Trigger**: Manual (`workflow_dispatch`) with version input.

**Jobs**:
| Job | Description | Runner |
|-----|-------------|--------|
| `validate-version` | Check version format, compare with package.json | ubuntu-latest |
| `test-frontend` | Lint, test, build frontend | ubuntu-latest |
| `test-backend` | Verify Python imports, syntax check | ubuntu-latest |
| `test-build` | Full PyInstaller build test | ubuntu-latest |
| `summary` | Report pass/fail status | ubuntu-latest |

**Usage**:
1. Go to Actions → "Pre-Release Validation"
2. Click "Run workflow"
3. Enter version (e.g., `1.2.0`)
4. Optionally skip build test for faster validation
5. Review the summary

#### 2. Build & Release (`release.yml`)

**Purpose**: Build for all platforms and create GitHub Release.

**Trigger**:
- Push tag matching `v*` (e.g., `v1.0.0`, `v1.2.0-beta.1`)
- Manual dispatch with tag input

**Jobs**:
| Job | Description | Runner |
|-----|-------------|--------|
| `prepare` | Extract version, build frontend, update version.json | ubuntu-latest |
| `build-linux` | Build Linux x64 tarball | ubuntu-22.04 |
| `build-windows` | Build Windows x64 zip (with optional signing) | windows-latest |
| `build-macos-x64` | Build macOS Intel tarball | macos-13 |
| `build-macos-arm64` | Build macOS Apple Silicon tarball | macos-14 |
| `release` | Create GitHub Release with all assets | ubuntu-latest |

**Workflow Diagram**:

```
[Tag Push v1.0.0]
        │
        ▼
   ┌─────────┐
   │ prepare │  Build frontend, update version.json
   └────┬────┘
        │
   ┌────┴────┬────────────┬────────────┐
   ▼         ▼            ▼            ▼
┌──────┐ ┌───────┐ ┌──────────┐ ┌──────────┐
│linux │ │windows│ │macos-x64 │ │macos-arm │
└──┬───┘ └───┬───┘ └────┬─────┘ └────┬─────┘
   │         │          │            │
   └────┬────┴──────────┴────────────┘
        │
        ▼
   ┌─────────┐
   │ release │  Create GitHub Release
   └─────────┘
```

### Build Matrix

| Platform | Runner | Architecture | Output Format |
|----------|--------|--------------|---------------|
| Linux | ubuntu-22.04 | x64 | `.tar.gz` |
| Windows | windows-latest | x64 | `.zip` |
| macOS Intel | macos-13 | x64 | `.tar.gz` |
| macOS Apple Silicon | macos-14 | arm64 | `.tar.gz` |

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
   - Go to GitHub Actions → Build & Release
   - Watch the workflow progress
   - All 4 platform builds run in parallel

6. **Verify the release**:
   - Go to Releases page
   - Check all 8 assets are present (4 archives + 4 checksums)
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

---

## Asset Naming Convention

Assets must follow this naming pattern for the updater to detect them:

```
nirs4all-webapp-{version}-{platform}-{arch}.{ext}
```

### Examples

| Platform | Asset Name | Type |
|----------|------------|------|
| Linux x64 | `nirs4all-webapp-1.2.0-linux-x64.tar.gz` | Archive |
| Windows x64 | `nirs4all-webapp-1.2.0-windows-x64.zip` | Portable |
| Windows x64 | `nirs4all-webapp-1.2.0-windows-x64-setup.exe` | Installer |
| macOS Intel | `nirs4all-webapp-1.2.0-macos-x64.tar.gz` | Archive |
| macOS Apple Silicon | `nirs4all-webapp-1.2.0-macos-arm64.tar.gz` | Archive |

### Platform Detection Keywords

The updater (`api/updates.py`) uses these keywords to find the right asset:

| Platform | Detection Keywords |
|----------|-------------------|
| Windows | `windows`, `win64`, `win32`, `.exe`, `.msi` |
| macOS | `macos`, `darwin`, `osx`, `.dmg`, `.app` |
| Linux | `linux`, `.appimage`, `.deb`, `.tar.gz` |

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
   WINDOWS_CERT_BASE64    = base64-encoded .pfx file
   WINDOWS_CERT_PASSWORD  = certificate password
   ```

4. **Encode the certificate**:
   ```bash
   base64 -w 0 certificate.pfx > cert_base64.txt
   ```

#### How It Works

The release workflow automatically signs if secrets are present:

```yaml
- name: Sign executable
  if: ${{ env.WINDOWS_CERT_BASE64 != '' }}
  run: |
    signtool sign /f cert.pfx /p $PASSWORD \
      /tr http://timestamp.digicert.com \
      /td sha256 /fd sha256 \
      dist/nirs4all-webapp/nirs4all-webapp.exe
```

### macOS Code Signing (Future)

Currently not implemented. For App Store distribution:
1. Apple Developer account required
2. Code signing with Developer ID certificate
3. Notarization with `xcrun notarytool`

---

## Troubleshooting

### Common Build Issues

#### "ModuleNotFoundError" at Runtime

The module is missing from `hiddenimports` in the spec file.

**Fix**: Add the module to `hiddenimports` in `nirs4all-webapp.spec`:
```python
hiddenimports = [
    # ... existing imports
    'missing.module',
]
```

#### Bundle Size Too Large

Check for accidentally included large dependencies.

**Debug**:
```bash
# List largest files in bundle
du -ah dist/nirs4all-webapp/_internal/ | sort -rh | head -20
```

**Fix**: Add exclusions in the spec file:
```python
excludes = [
    # ... existing excludes
    'large_package',
]
```

#### Frontend Not Bundled

The frontend build is missing or not copied.

**Check**:
```bash
ls dist/nirs4all-webapp/_internal/dist/
```

**Fix**: Ensure `npm run build` ran successfully before PyInstaller.

#### "Failed to execute script" on Windows

Missing Visual C++ Redistributable.

**Fix**: Include vcruntime in bundle or document the requirement.

### CI/CD Issues

#### Build Timeout

Default timeout is 360 minutes. Increase if needed:
```yaml
jobs:
  build-linux:
    timeout-minutes: 60
```

#### macOS Build Fails

Check runner version compatibility:
- `macos-13`: Intel (x64)
- `macos-14`: Apple Silicon (arm64)

#### Windows Signing Fails

Check certificate validity:
```powershell
certutil -v -dump cert.pfx
```

### Testing Updates

To test the updater integration:

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
| `nirs4all-webapp.spec` | PyInstaller configuration |
| `scripts/build.py` | Local build orchestration |
| `installer/nsis/nirs4all-webapp.nsi` | Windows NSIS installer script |
| `.github/workflows/pre-release.yml` | Pre-release validation |
| `.github/workflows/release.yml` | Build & release automation |
| `version.json` | Version info (updated at build time) |
| `docs/UPDATE_SYSTEM.md` | Updater documentation |

---

## See Also

- [UPDATE_SYSTEM.md](UPDATE_SYSTEM.md) - How the auto-updater works
- [PyInstaller Documentation](https://pyinstaller.org/en/stable/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
