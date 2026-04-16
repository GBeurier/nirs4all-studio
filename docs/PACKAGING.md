# Packaging & Release System

This document describes the packaging model currently used by `nirs4all-webapp`.

The source of truth is:

- `.github/workflows/release-unified.yml`
- `electron-builder.installer.yml`
- `electron-builder.archive.yml`
- `scripts/build-release.cjs`
- `scripts/build-archive-standalone.cjs`
- `scripts/bake-standalone-backend.cjs`

Legacy PyInstaller-based backend packaging still exists in the repository for compatibility and debugging, but it is no longer the published desktop release path.

## Overview

The project now publishes three desktop distribution families plus Docker:

| Product | Platforms | Published assets | Runtime model |
|---|---|---|---|
| Installer | Windows x64, macOS x64/arm64, Linux x64 | `.exe`, `.dmg`, `.AppImage`, `.deb` | Electron + backend source; Python environment is writable and managed outside the app bundle |
| Portable Windows | Windows x64 | `-portable.exe` | Electron portable layout with state under `.nirs4all/` next to the executable |
| All-in-one bundle | Windows x64, Linux x64, macOS x64/arm64 | `-all-in-one-*.zip` | Electron + backend source + embedded `python-runtime/python`; runtime is read-only |
| Docker | Linux | `ghcr.io/gbeurier/nirs4all-studio:*` | No Electron; FastAPI serves the UI |

For the desktop all-in-one bundle, v1 is deliberately locked to a single product profile:

- `cpu`
- `torch` included
- `.zip` only
- no first-launch Python download
- no first-launch setup wizard

## Terminology

- `Installer`: standard OS install flow (`.exe`, `.dmg`, `.AppImage`, `.deb`).
- `Portable`: Windows-only `-portable.exe` build with dedicated state next to the executable.
- `All-in-one`: the final ZIP bundle distributed to users, containing Electron, backend source, embedded Python, and a baked venv.
- `Bundled runtime`: the embedded Python runtime found under `resources/backend/python-runtime/`.
- `Legacy PyInstaller`: historical frozen-backend packaging path. Not the release path for the desktop product anymore.

An extracted ZIP is not the same thing as portable mode. Portable mode is enabled explicitly by the electron-builder portable executable and its dedicated environment variables.

## Packaged Layouts

### Installer / portable builds

Installer-oriented builds package backend source only:

```text
resources/
└── backend/
    ├── api/
    ├── websocket/
    ├── updater/
    ├── main.py
    ├── recommended-config.json
    └── version.json
```

At runtime, Electron resolves or creates a writable Python environment outside the app bundle:

- installed app: standard `userData` paths
- portable Windows app: `.nirs4all/` next to the executable

### All-in-one builds

All-in-one bundles embed the runtime directly in the packaged app:

```text
resources/
└── backend/
    ├── api/
    ├── websocket/
    ├── updater/
    ├── main.py
    ├── recommended-config.json
    ├── version.json
    └── python-runtime/
        ├── python/
        └── RUNTIME_READY.json
```

The bundled runtime is immutable in v1. Package installation, environment creation, snapshot restore, and config alignment mutations are disabled for this mode.

## Runtime Modes

`/api/system/build` exposes the runtime contract used by Electron and the frontend:

| `runtime_mode` | Meaning |
|---|---|
| `development` | Local dev server / ad hoc Python process |
| `managed` | Writable Python environment managed outside the bundle |
| `bundled` | All-in-one ZIP with embedded read-only runtime |
| `pyinstaller` | Legacy frozen backend path kept for compatibility |

`is_frozen` remains in the API for compatibility, but new UI and packaging decisions should use `runtime_mode`.

## Build Entry Points

### Installer-oriented local builds

Use `scripts/build-release.cjs` for installer-style packaging:

```bash
npm run release -- --clean --platform win
npm run release -- --clean --platform mac
npm run release -- --clean --platform linux
```

This path packages with `electron-builder.installer.yml`.

Notes:

- it is the local helper for installer targets
- the published desktop release matrix is no longer split into CPU/GPU installers
- the old `--mode standalone` option is a legacy path, not the all-in-one bundle workflow

### All-in-one local builds

Use `scripts/build-archive-standalone.cjs` for the distributed ZIP bundle:

```bash
npm run release:all-in-one:clean -- --platform win32 --arch x64
npm run release:all-in-one:clean -- --platform linux --arch x64
npm run release:all-in-one:clean -- --platform darwin --arch arm64
```

Behavior:

- locked to profile `cpu`
- must run on the matching target host (`platform` and `arch` must match the runner)
- bakes the embedded runtime first, then packages with `electron-builder.archive.yml`

### Backend-only bake

To build only the embedded backend payload:

```bash
node scripts/bake-standalone-backend.cjs --profile cpu --platform win32 --arch x64
```

This produces `backend-dist/` with `python-runtime/` and `RUNTIME_READY.json`.

## CI/CD Pipeline

The release workflow is `.github/workflows/release-unified.yml`.

### Trigger

- tag push matching `[0-9]*`
- manual `workflow_dispatch`

### Manual inputs

- `tag`
- `skip_all_in_one`
- `skip_docker`

### Jobs

| Job | Purpose |
|---|---|
| `prepare` | Resolve version/tag, prerelease flag, and build switches |
| `installer-linux` | Linux installer assets via `electron-builder.installer.yml` |
| `installer-windows` | Windows NSIS installer and portable executable |
| `installer-macos-x64` | macOS Intel DMG, signed/notarized when secrets are available |
| `installer-macos-arm64` | macOS Apple Silicon DMG, signed/notarized when secrets are available |
| `archive-windows` | Windows all-in-one ZIP |
| `archive-linux` | Linux all-in-one ZIP |
| `archive-macos-x64` | macOS Intel all-in-one ZIP, rebuilt after notarization/stapling |
| `archive-macos-arm64` | macOS Apple Silicon all-in-one ZIP, rebuilt after notarization/stapling |
| `docker` | CPU and GPU-CUDA container images |
| `release` | Consolidates `installer-*` and `archive-*` artifacts into the GitHub Release |

### Why installer and archive builds are split

The split is intentional:

- installer assets must stay lighter and writable at runtime
- all-in-one ZIPs must embed the heavy baked runtime
- macOS archive notarization has different handling than DMG packaging
- update asset names must stay unambiguous

## Published Asset Names

### Installer / portable assets

| Platform | Asset pattern |
|---|---|
| Windows installer | `nirs4all Studio-{version}-win-x64.exe` |
| Windows portable | `nirs4all Studio-{version}-win-x64-portable.exe` |
| macOS Intel installer | `nirs4all Studio-{version}-mac-x64.dmg` |
| macOS Apple Silicon installer | `nirs4all Studio-{version}-mac-arm64.dmg` |
| Linux AppImage | `nirs4all Studio-{version}-linux-x64.AppImage` |
| Linux DEB | `nirs4all Studio-{version}-linux-x64.deb` |

### All-in-one assets

| Platform | Asset pattern |
|---|---|
| Windows x64 | `nirs4all Studio-{version}-all-in-one-win-x64.zip` |
| Linux x64 | `nirs4all Studio-{version}-all-in-one-linux-x64.zip` |
| macOS Intel | `nirs4all Studio-{version}-all-in-one-mac-x64.zip` |
| macOS Apple Silicon | `nirs4all Studio-{version}-all-in-one-mac-arm64.zip` |

### Docker assets

| Variant | Tag |
|---|---|
| CPU | `ghcr.io/gbeurier/nirs4all-studio:{version}` |
| GPU-CUDA | `ghcr.io/gbeurier/nirs4all-studio:{version}-gpu-cuda` |

Each downloadable artifact also ships with a `.sha256` sidecar when produced by the release workflow.

## Code Signing And Notarization

### Windows

Windows release jobs optionally import a certificate from:

- `WINDOWS_CERT_BASE64`
- `WINDOWS_CERT_PASSWORD`

When configured, electron-builder signs the generated executables.

### macOS installers

Installer jobs package DMGs with `electron-builder.installer.yml`, then:

1. sign the `.app`
2. build the `.dmg`
3. notarize the `.dmg`
4. staple the notarization ticket

### macOS all-in-one ZIPs

The all-in-one ZIP path is stricter:

1. build the packaged `.app`
2. zip the `.app` for notarization submission
3. notarize
4. staple the `.app`
5. rebuild the final distributed ZIP from the stapled `.app`

This order is required for the offline first-launch promise of the macOS ZIP bundle.

## Update Compatibility

Self-update uses GitHub Releases, but the updater only applies assets it can stage in place.

### Preferred update assets

- installed Windows builds: all-in-one ZIP
- portable Windows builds: portable executable
- macOS builds: all-in-one ZIP
- Linux builds: all-in-one ZIP in current releases, with `.tar.gz` / `.tgz` still accepted for legacy compatibility

### Rejected as in-place update assets

These formats are published for installation, not in-place replacement:

- `.dmg`
- `.deb`
- `.AppImage`
- non-portable Windows installer `.exe`

### ZIP permissions on Linux and macOS

`api/update_downloader.py` restores POSIX permission bits recorded in ZIP entries during extraction. This is required so that:

- the packaged Electron binary remains executable
- the embedded Python runtime remains executable

The release workflow validates this with `scripts/smoke-update-zip-permissions.py`.

## Troubleshooting

### All-in-one build shows the setup wizard

The packaged runtime was not detected. Check that the archive contains:

- `resources/backend/python-runtime/RUNTIME_READY.json`
- the bundled `venv`

### Linux or macOS update succeeds but the app will not launch

Check ZIP permission restoration first:

```bash
python3 scripts/smoke-update-zip-permissions.py --archive path/to/archive.zip --platform linux
```

### macOS ZIP launches only online or fails Gatekeeper checks

Verify that the final ZIP was rebuilt after notarization and stapling. Zipping too early breaks the offline launch contract.

### Release contains ambiguous ZIP files

The updater prefers asset names containing `all-in-one`. Do not publish generic sidecar ZIPs that collide with the all-in-one naming convention.

## Files Reference

| File | Purpose |
|---|---|
| `.github/workflows/release-unified.yml` | Source of truth for published artifacts |
| `electron-builder.installer.yml` | Installer and portable packaging config |
| `electron-builder.archive.yml` | All-in-one ZIP packaging config |
| `electron-builder.yml` | Compatibility/default entry that still points to installer-style packaging |
| `scripts/build-release.cjs` | Local installer-oriented build helper |
| `scripts/build-archive-standalone.cjs` | Local all-in-one ZIP build helper |
| `scripts/bake-standalone-backend.cjs` | Builder for embedded backend + runtime |
| `scripts/copy-backend-source.cjs` | Copies backend source payload into `backend-dist/` |
| `scripts/smoke-archive-standalone.cjs` | Offline launch smoke test for extracted all-in-one bundles |
| `scripts/smoke-update-zip-permissions.py` | ZIP permission restoration smoke test |
| `api/update_downloader.py` | Download, checksum, and archive extraction logic |
| `api/updates.py` | GitHub/PyPI checks and asset selection logic |

## See Also

- [UPDATE_SYSTEM.md](UPDATE_SYSTEM.md)
- [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)
