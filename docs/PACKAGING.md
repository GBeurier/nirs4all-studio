# Packaging & Release System

This document describes the packaging model currently used by `nirs4all-webapp`.

The source of truth is:

- `.github/workflows/release-unified.yml`
- `electron-builder.installer.yml`
- `electron-builder.archive.yml`
- `scripts/build-release.cjs`
- `scripts/build-archive-standalone.cjs`
- `scripts/bake-python-plugin-runtime.cjs`
- `scripts/native-runtime-contract.cjs`
- `scripts/macos-attested-runtime.cjs`

Legacy PyInstaller-based backend packaging still exists in the repository for compatibility and debugging, but it is no longer the published desktop release path.

## Overview

The project now publishes three desktop distribution families plus Docker:

| Product | Platforms | Published assets | Runtime model |
|---|---|---|---|
| Installer | Windows x64, macOS x64/arm64, Linux x64 | `.exe`, `.dmg`, `.AppImage`, `.deb` | Electron + Rust `native/studio-sidecar` + read-only plugin-only CPython closure |
| Portable Windows | Windows x64 | `-portable.exe` | Electron portable layout with state under `.nirs4all/` next to the executable |
| All-in-one bundle | Windows x64, Linux x64, macOS x64/arm64 | `-all-in-one-*.zip` on Windows/macOS, `-all-in-one-*.tar.gz` on Linux | Electron + Rust `native/studio-sidecar` + the same read-only plugin-only CPython closure; no Python backend source |
| Docker | Linux x64 | `ghcr.io/gbeurier/nirs4all-studio:*` | nginx static UI + loopback Rust sidecar + bounded plugin-only CPython closure; no Python HTTP backend |

For the desktop all-in-one bundle, v1 is deliberately locked to a single product profile:

- `cpu`
- `torch` included
- archive format is platform-specific: `.zip` on Windows/macOS, `.tar.gz` on Linux
- no first-launch Python download
- no first-launch setup wizard

## Terminology

- `Installer`: standard OS install flow (`.exe`, `.dmg`, `.AppImage`, `.deb`).
- `Portable`: Windows-only `-portable.exe` build with dedicated state next to the executable.
- `All-in-one`: the final archive bundle distributed to users, containing Electron, Rust, and the embedded plugin-only CPython closure.
- `Bundled runtime`: the embedded Python runtime found under `resources/backend/python-runtime/`.
- `Legacy PyInstaller`: historical frozen-backend packaging path. Not the release path for the desktop product anymore.

An extracted all-in-one archive is not the same thing as portable mode. Portable mode is enabled explicitly by the electron-builder portable executable and its dedicated environment variables.

## Packaged Layouts

### Installer / portable builds

Installer-oriented builds package the Rust control-plane binary alongside the
same plugin-only CPython closure as all-in-one archives:

```text
resources/
└── backend/
    ├── python-runtime/
    │   ├── python/
    │   ├── PLUGIN_RUNTIME_READY.json
    │   └── PYTHON_PLUGIN_CLOSURE.json
    ├── native/
    │   ├── studio-sidecar
    │   ├── libn4m.so / libn4m.dylib / n4m.dll
    │   └── STUDIO_RUNTIME_CONTRACT.json
    ├── recommended-config.json
    └── version.json
```

At runtime, Electron may still resolve or create a writable Python environment
outside the app bundle for explicit compatibility diagnostics:

- installed app: standard `userData` paths
- portable Windows app: `.nirs4all/` next to the executable

Electron starts the packaged sidecar on every packaged desktop launch. This
managed environment is never eligible for the product stdio plugin host.
Installer layouts without a bundled closure advertise that capability as
unavailable, and routes requiring it refuse. Changing the interpreter does not
start another backend. A running sidecar whose original plugin-host path
became stale reports the optional host as unavailable until the next
application launch. The sidecar remains the sole product HTTP owner. There is
no command-line switch, environment activation, IPC acquisition, or renderer
target for a Python HTTP backend in Phase 2 desktop packages.

Packaged startup verifies the sidecar size and SHA-256 from
`STUDIO_RUNTIME_CONTRACT.json` before spawning it. A missing or altered sidecar
fails product startup before the renderer window is created; it is never
replaced by the Python compatibility backend. On signed Windows/macOS release
payloads, a valid Authenticode/code-signature verification is accepted when the
signing step has necessarily changed the pre-signing byte hash; tampering then
invalidates that platform signature and remains fail-closed.

### All-in-one builds

All-in-one bundles embed the runtime directly in the packaged app:

```text
resources/
└── backend/
    ├── recommended-config.json
    ├── version.json
    ├── python-runtime/
    │   ├── python/
    │   ├── PYTHON_PLUGIN_CLOSURE.json
    │   └── PLUGIN_RUNTIME_READY.json
    └── native/
        ├── studio-sidecar
        ├── libn4m.so / libn4m.dylib / n4m.dll
        └── STUDIO_RUNTIME_CONTRACT.json
```

Electron starts the packaged sidecar automatically and gives it the sibling
embedded interpreter only after the runtime contract and closure manifest have
verified the exact file inventory, sizes, hashes, canonical parents, unique
site-packages directory, and absence of symlinks/special files. Packaged
environment overrides, managed/user venvs, PATH, and source siblings are ignored.
The worker uses `-I -S -B` and inserts only the attested site-packages directory.
The Rust
sidecar remains the process and HTTP owner; the embedded Python runtime is a
plugin capability, not a FastAPI/Uvicorn fallback.

Phase 2 installers and all-in-one archives build this payload with
`scripts/bake-python-plugin-runtime.cjs`. This is a separate product profile;
it does not invoke `bake-standalone-backend.cjs`, copy `api/`, `websocket/`, or
`main.py`, or install the shared FastAPI backend dependency set. It rebuilds
the selected `nirs4all` wheel from source commit
`322265576ccfaeb1ee22332d05ae04b87be4b538` (or accepts that exact wheel for
an offline build), verifies SHA-256
`00326c703b933ff2c4b106905e1c44f81906b918db30bb5d05aa189846c48940`,
and rejects FastAPI, Starlette, Uvicorn, Sentry's FastAPI integration, and the
Uvicorn server transitive set. `PLUGIN_RUNTIME_READY.json` freezes the exact
`library-plugin-host-only` role. The older generic `RUNTIME_READY.json` never
enables the plugin capability.

Every installer/release gate invokes `native-runtime-contract.cjs` with
`--require-bundled-python-plugin` and `--require-bundled-methods`. The sidecar
builder likewise refuses to emit a product tree unless the build supplies one
content-addressed native Methods library at ABI 2.5. Therefore a standard
installer or all-in-one archive cannot silently publish either capability as
`mode: unavailable`.

The same content contract pins the bundled interpreter and every runtime file.
If any member is missing, altered, added, or path-substituted after packaging,
the Rust sidecar still owns the product
port and reports the Python plugin host unavailable. It does not acquire,
restart, or fall back to Uvicorn. Archive creation and the release smoke are
stricter: they reject such an incomplete bundle before publication.

Rust re-hashes the complete closure during acquisition, in the worker thread
immediately before spawn, immediately after spawn before stdin is released,
and after process exit. Cross-platform filesystems do not provide one portable
sealed-executable primitive for this tree, so the residual same-user race
between a successful hash and the kernel's later module read is not claimed
away. Release resources must also be installed read-only and protected by the
platform package/signature mechanism; any observed drift fails the job and
terminates a just-spawned worker.

Every Rust-owned invocation of the embedded CPython host disables bytecode
writes with both `-B` and `PYTHONDONTWRITEBYTECODE=1`. This keeps preflight,
system/update inspection, run-detail materialization, and scientific execution
from adding `__pycache__` members to the exact packaged closure.

### macOS signing order for attested native bytes

macOS code signing changes Mach-O bytes. The packaged runtime therefore uses a
strict order that differs from the default recursive Electron signing pass:

1. Electron Builder copies `backend-dist/` into the unsigned `.app`.
2. `scripts/macos-attested-runtime.cjs`, registered as `afterPack`, verifies the
   copied runtime contract and discovers Mach-O files from the complete CPython
   closure plus the optional `native/libn4m.dylib`.
3. When Electron Builder has selected a signing identity, the hook signs those
   files first with that same identity, hardened-runtime options, inherited
   entitlements, keychain, and timestamp policy. Any unresolved requested
   identity, non-Mach-O selected interpreter/library, signing error, or
   verification error aborts packaging.
4. Only after those signatures are final does the hook regenerate
   `PYTHON_PLUGIN_CLOSURE.json` and `STUDIO_RUNTIME_CONTRACT.json`, then verify
   the complete copied tree again.
5. Both Electron Builder configs use `mac.signIgnore` for exactly the CPython
   runtime root and `libn4m.dylib`. Electron Builder still signs the Rust
   sidecar, Electron helpers, frameworks, and outer application normally. The
   outer application signature seals the already signed and attested resources.

Unsigned local x64 builds have no signing identity to apply, but the hook still
re-attests the bytes in the final `.app`. Apple Silicon's Electron Builder
ad-hoc fallback is mirrored for the embedded Mach-O files. Custom macOS signing
hooks are rejected because their identity cannot be proven equal to the one
used for this pre-sign phase. This ordering preserves byte attestation; it does
not replace the release workflow's application-signature, notarization, staple,
or extracted-artifact verification gates.
Nested `.app`, `.bundle`, `.framework`, `.plugin`, or `.xpc` directories inside
the CPython closure are not currently attested as signable bundles and are
rejected instead of being partially signed.

This is purely a packaging rule. The Rust sidecar remains the sole product HTTP
and WebSocket owner; CPython remains a bounded stdio library host.

Linux CI executes the unpacked installer directly. The release workflow also
verifies the same manifest for Windows x64 and macOS x64/arm64 payloads on their
matching runners; archive jobs additionally execute the full extracted-bundle
smoke on each target OS.

While the app is still running on the embedded bundled runtime, package
installation, runtime creation, snapshot restore, and config alignment
mutations are disabled. Users may still switch the compatibility diagnostic
environment to an external Python runtime; that choice does not replace the
packaged stdio plugin host.

The loose `nirs4all-tools>=0.0.5` range remains confined to the transitional
FastAPI/tooling dependency declaration. The packaged Rust product instead
installs and attests the qualified `nirs4all-tools` 0.0.7 wheel from commit
`e3a332633f87b4652a06f8993e63c386a3568698`, plus exact `duckdb==1.5.5` and
`pyarrow==25.0.1` readers, inside the bounded CPython stdio closure. It remains
excluded from `BACKEND_COMMON_PACKAGES` and never acquires an HTTP role.

## Runtime Modes

`/api/system/build` exposes the runtime contract used by Electron and the frontend:

| `runtime_mode` | Meaning |
|---|---|
| `development` | Local dev server / ad hoc Python process |
| `managed` | Writable Python environment managed outside the bundle |
| `bundled` | All-in-one archive with embedded read-only runtime |
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
- `--mode standalone` is rejected; use `npm run release:all-in-one`
- only the CPU profile and the matching host platform are accepted; cross-host and `--platform all` builds are rejected

### All-in-one local builds

Use `scripts/build-archive-standalone.cjs` for the distributed all-in-one archive:

```bash
npm run release:all-in-one:clean -- --platform win32 --arch x64
npm run release:all-in-one:clean -- --platform linux --arch x64
npm run release:all-in-one:clean -- --platform darwin --arch arm64
# Optional smaller scientific closure (same Rust/product boundary):
npm run release:all-in-one:clean -- --profile cpu-lite --platform linux --arch x64
```

Behavior:

- supports profile `cpu` (default) and `cpu-lite`; both keep the same Rust
  product backend and plugin-only CPython boundary
- must run on the matching target host (`platform` and `arch` must match the runner)
- bakes the embedded runtime first, then packages with `electron-builder.archive.yml`

### Plugin-runtime-only bake

To build only the embedded library/plugin payload:

```bash
node scripts/bake-python-plugin-runtime.cjs
```

This produces `backend-dist/` with `python-runtime/` and the strict
`PLUGIN_RUNTIME_READY.json`. Pass `--plugin-wheel <path>` and
`--tools-wheel <path>` for an offline build; both wheels must match their
pinned SHA-256 identities. The unpublished qualified `dag-ml 0.3.23` platform
wheel is still a separate prerequisite of the selected `nirs4all` wheel; the
bake fails closed when that artifact is unavailable.

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
| `archive-linux` | Linux all-in-one tar.gz |
| `archive-macos-x64` | macOS Intel all-in-one ZIP, rebuilt after notarization/stapling |
| `archive-macos-arm64` | macOS Apple Silicon all-in-one ZIP, rebuilt after notarization/stapling |
| `docker` | Native container image with nginx and the Rust sidecar |
| `release` | Consolidates `installer-*` and `archive-*` artifacts into the GitHub Release |

### Why installer and archive builds are split

The split is intentional:

- installer assets must stay lighter and writable at runtime
- all-in-one archives must embed the heavy baked runtime
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
| Linux x64 | `nirs4all Studio-{version}-all-in-one-linux-x64.tar.gz` |
| macOS Intel | `nirs4all Studio-{version}-all-in-one-mac-x64.zip` |
| macOS Apple Silicon | `nirs4all Studio-{version}-all-in-one-mac-arm64.zip` |

### Docker asset

| Runtime | Tag |
|---|---|
| Native Rust | `ghcr.io/gbeurier/nirs4all-studio:{version}` |

The container has one public listener: nginx on port `8000`. It serves the
compiled React application and proxies `/api/*` and `/ws*` to
`studio-sidecar` on `127.0.0.1:8001`. The sidecar is the sole product HTTP,
WebSocket, job/control, scheduler and state owner. Its loopback port is neither
exposed nor configurable by container users.

The default image embeds the same fixed, separately attested CPython
library/plugin closure as the desktop packages. It contains no FastAPI,
Uvicorn, `main.py`, `api/`, or `websocket/` sources. The Rust sidecar selects
that interpreter through fixed `NIRS4ALL_PYTHON_PLUGIN_*` identities and invokes
it only through the bounded stdio protocol. It never owns a port, scheduler,
store, or fallback route.
The Rust transition-status route is always available. The conversion route is
advertised only when that attested closure also contains the exact qualified
`nirs4all-tools` distribution and its required format readers; the sidecar
invokes it only via bounded stdio and keeps HTTP, activation, and rollback
state in Rust. Both the bake and sidecar capability gates execute a minimal
DuckDB query and a PyArrow Parquet memory round-trip; matching package names or
versions alone cannot advertise conversion.
Every public conversion execution path rechecks this attestation immediately
before spawn. Windows packages use the sidecar's internal Job Object launcher;
it joins a kill-on-close job before creating CPython, so descendants cannot race
the containment boundary or request breakaway.
The image does embed the exact `nirs4all-methods` ABI 2.5 library and its
`STUDIO_RUNTIME_CONTRACT.json`; native Archive V2 prediction therefore remains
independent of the plugin host. CI supplies that library through a local
BuildKit context built and tested from commit `4983c9a1…`, never from an
unverified URL. The image build verifies both the complete CPython closure and
the Methods digest before the runtime stage is assembled.

Persist native Studio configuration in `/var/lib/nirs4all-studio` and mount
scientific workspaces under `/workspaces`:

```bash
docker run --rm -p 8000:8000 \
  -v studio-state:/var/lib/nirs4all-studio \
  -v /path/to/workspaces:/workspaces \
  ghcr.io/gbeurier/nirs4all-studio:{version}
```

The OCI healthcheck calls the Rust-owned `/api/health` route through nginx, so
healthy status proves both processes and the reverse-proxy path are available.

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
- Linux builds: all-in-one tar.gz in current releases, with ZIP still accepted for legacy compatibility

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

- `resources/backend/python-runtime/PLUGIN_RUNTIME_READY.json`
- `resources/backend/python-runtime/PYTHON_PLUGIN_CLOSURE.json`

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
| `scripts/bake-python-plugin-runtime.cjs` | Builder/verifier for the pinned plugin-only CPython closure |
| `scripts/bake-standalone-backend.cjs` | Legacy compatibility backend builder; never used by Phase 2 desktop release |
| `scripts/copy-backend-source.cjs` | Legacy compatibility source copier; never used by Phase 2 desktop release |
| `scripts/smoke-archive-standalone.cjs` | Offline launch smoke test for extracted all-in-one bundles |
| `scripts/smoke-update-zip-permissions.py` | ZIP permission restoration smoke test |
| `api/update_downloader.py` | Download, checksum, and archive extraction logic |
| `api/updates.py` | GitHub/PyPI checks and asset selection logic |

## See Also

- [UPDATE_SYSTEM.md](UPDATE_SYSTEM.md)
- [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)
