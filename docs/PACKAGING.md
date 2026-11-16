# Packaging & Release System

This document describes how nirs4all Studio is packaged: an Electron
application, the Rust sidecar that is its product backend, and the tools Studio
needs to create and maintain the user's Python environment. Installers ship no
Python. Product version metadata, the release tag, the runtime contract, and
published asset names must agree exactly; the release workflow verifies that
identity before creating a GitHub Release.

The source of truth is:

- `.github/workflows/release-unified.yml`
- `electron-builder.installer.yml`
- `electron-builder.offline.yml`
- `scripts/build-release.cjs`
- `scripts/fetch-uv.cjs`
- `scripts/python-wheel-lock.cjs`
- `scripts/build-wheelhouse.cjs`
- `scripts/build-offline-payload.cjs`
- `scripts/studio-document-adapters.cjs`
- `scripts/build-native-sidecar.cjs`
- `scripts/native-runtime-contract.cjs`
- `scripts/macos-attested-runtime.cjs`
- `recommended-config.json` (`required`, `optional`)

## Overview

| Product | Target platforms | Asset patterns | Runtime model |
|---|---|---|---|
| Installer | Windows x64, macOS x64/arm64, Linux x64 | `.exe` (NSIS), `.dmg`, `.deb` | Electron + Rust `native/studio-sidecar` + `uv`, the wheels of the required packages and the document adapters. The Python environment is created or selected at first launch. |
| Offline installer | Same | Same, with the `-offline` suffix | The installer plus the offline payload: the pinned Python runtime archive and the wheels of the default package set, so the environment is created without network access. |
| Docker | Linux x64 | `ghcr.io/gbeurier/nirs4all-studio:*` | nginx static UI + loopback Rust sidecar + a Python environment built at image build time from the same catalogue; no Python HTTP backend. |

The all-in-one archive lane (`scripts/build-archive-standalone.cjs`,
`electron-builder.archive.yml`, `scripts/smoke-self-update.cjs`,
`.github/workflows/macos-intel-hotfix.yml`) is not part of the published
release and has not been converted to this model.

## Terminology

- `Installer`: standard OS install flow (`.exe`, `.dmg`, `.deb`). Also called
  the light installer.
- `Offline installer`: the installer with the offline payload; its file name
  ends in `-offline`.
- `Required cohort`: the packages listed under `required` in
  `recommended-config.json` (`nirs4all`, `nirs4all-core`, `dag-ml`,
  `dag-ml-data`, `nirs4all-io`, `nirs4all-methods`, `nirs4all-formats`) at
  their `install` versions.
- `Recommended packages`: the packages listed under `optional`. Those with
  `default_install: true` are preselected when Studio creates an environment.
- `Wheelhouse`: `resources/backend/wheels/`, one wheel per package of the
  required cohort.
- `Offline payload`: `resources/backend/offline/`.

## Packaged Layouts

### Installer

```text
resources/
└── backend/
    ├── native/
    │   ├── studio-sidecar[.exe]
    │   ├── libn4m.so / libn4m.dylib / n4m.dll
    │   └── STUDIO_RUNTIME_CONTRACT.json
    ├── tools/
    │   └── uv[.exe]
    ├── wheels/
    │   └── one wheel per package of the required cohort
    └── adapters/
        └── studio_document_adapters/
```

- `native/` holds the Rust product backend, the native Methods library and the
  contract that content-addresses both.
- `tools/uv` is the pinned `uv` 0.10.4 release for the target, redistributed
  unmodified. It is the only tool Studio uses to create environments and
  install packages.
- `wheels/` holds exactly the required cohort for the target. Studio installs
  the required packages from it; their dependencies and every recommended
  package come from the package index.
- `adapters/studio_document_adapters/` is Studio's own document-translation
  package. The sidecar adds this directory to the scientific host's import
  path; it is never copied into the user's environment.

`scripts/python-runtime-config.cjs`, `scripts/tls-trust.cjs` and
`recommended-config.json` are packaged at the application root (inside the
asar): the Electron main process reads the pinned Python runtime identity, the
system trust helper and the package catalogue from them.

At first launch the user selects a Python environment or lets Studio create
one under `userData/python-env/`. See
[environment architecture](_internals/environment-architecture.md).

### Offline installer

The offline installer is the installer plus:

```text
resources/
└── backend/
    └── offline/
        ├── cpython-<version>+<tag>-<triple>-install_only.tar.gz
        └── wheels/
```

- The archive is the pinned python-build-standalone runtime declared in
  `scripts/python-runtime-config.cjs`.
- `offline/wheels/` holds the rest of the locked closure: the dependencies of
  the required cohort, and the `default_install` recommended packages with
  their dependencies. `torch` is locked as CPU wheels.

With this payload Studio creates the environment and installs the required
packages and the default recommended packages without network access. A
package that is not in the payload is requested from the package index.

It is built with `electron-builder.offline.yml`, which `extends`
`electron-builder.installer.yml` and adds `offline/**/*` to the packaged
resources. Intel macOS has no `torch` wheel for the catalogue version, so its
offline payload omits `torch`.

### Sidecar and Methods contract

Packaged startup verifies the sidecar size and SHA-256 from
`STUDIO_RUNTIME_CONTRACT.json` before spawning it. A missing or altered sidecar
fails product startup before the renderer window is created. On signed
Windows/macOS release payloads, a valid Authenticode/code-signature
verification is accepted when the signing step has necessarily changed the
pre-signing byte hash; tampering then invalidates that platform signature and
remains fail-closed.

The sidecar builder refuses to emit a product tree unless the build supplies
one content-addressed native Methods library at ABI 2.22
(`nirs4all-methods` 1.3.15). Every release gate invokes
`native-runtime-contract.cjs` with `--require-python-payload` and
`--require-bundled-methods`, so an installer cannot be published without `uv`,
the required wheels, the attested adapters and the native Methods library.

The `nirs4all-methods` wheel in `wheels/` is installed into the user's
environment; it is not the native dispatch library of the sidecar. That
library is `native/libn4m` (`n4m.dll` on Windows), staged by the build and
recorded in the runtime contract.

Windows builds make both Studio-owned native binaries independent of a
machine-wide Visual C++ Redistributable: Methods is configured with CMake's
`MultiThreaded` (`/MT`) runtime and the Rust sidecar with
`target-feature=+crt-static`. The packaged runtime contract records that exact
profile, and a bounded PE import-table gate refuses `MSVCP*` or `VCRUNTIME*`
imports in either `n4m.dll` or `studio-sidecar.exe`. Windows 10/11 still supply
the Universal CRT API-set imports as an operating-system component. No
additional Microsoft redistributable files or licence payloads are introduced
by this static-link profile; the ordinary third-party licence inventory remains
the publication authority.

On Windows the sidecar starts CPython through its internal Job Object
launcher; it joins a kill-on-close job before creating CPython, so descendants
cannot race the containment boundary or request breakaway.

### macOS signing order for attested native bytes

macOS code signing changes Mach-O bytes. The packaged runtime therefore uses a
strict order that differs from the default recursive Electron signing pass:

1. Electron Builder copies the packaged part of `backend-dist/` into the
   unsigned `.app`.
2. `scripts/macos-attested-runtime.cjs`, registered as `afterPack`, verifies the
   copied runtime contract, including the Python payload (`uv`, the required
   wheels and the adapters), and selects `native/libn4m.dylib`.
3. When Electron Builder has selected a signing identity, the hook signs that
   library first with the same identity, hardened-runtime options, inherited
   entitlements, keychain, and timestamp policy. Any unresolved requested
   identity, non-Mach-O library, signing error, or verification error aborts
   packaging.
4. Only after that signature is final does the hook regenerate
   `STUDIO_RUNTIME_CONTRACT.json`, then verify the copied tree again.
5. `mac.signIgnore` in `electron-builder.installer.yml` matches exactly
   `libn4m.dylib`. Electron Builder signs the Rust sidecar, `uv`, Electron
   helpers, frameworks, and the outer application normally. The outer
   application signature seals the already signed and attested library.

Unsigned local x64 builds have no signing identity to apply, but the hook still
re-attests the bytes in the final `.app`. Apple Silicon's Electron Builder
ad-hoc fallback is mirrored for the library. Custom macOS signing hooks are
rejected because their identity cannot be proven equal to the one used for
this pre-sign phase. This ordering preserves byte attestation; it does not
replace the release workflow's application-signature, notarization, staple,
or extracted-artifact verification gates.

### Payload sizes

Measured on Linux x64 on 2026-11-16:

| Part | Size |
|---|---|
| `tools/uv` | 53 MB |
| `wheels/` (required cohort) | 50 MB |
| `adapters/` | 1.5 MB |
| `native/libn4m.so` | 6.6 MB |
| `native/studio-sidecar` (release build) | about 40 MB |
| `resources/backend/` of the installer | about 150 MB |

A `resources/backend/` that carries a complete Python runtime weighs about
1.5 GB.

Offline payload (`resources/backend/offline/`):

| Target | Size |
|---|---|
| Linux x64 | about 1.1 GB: wheels 1.05 GB, of which `xgboost` and `nvidia-nccl-cu12` about 590 MB and CPU `torch` about 180 MB; Python archive 46 MB |
| Windows x64 | about 630 MB |
| macOS arm64 | about 315 MB |

## Build Entry Points

### Installer-oriented local builds

Use `scripts/build-release.cjs` for installer packaging:

```bash
npm run release -- --clean --platform win
npm run release -- --clean --platform mac
npm run release -- --clean --platform linux
npm run release -- --clean --platform linux --offline
```

The script stages the build inputs below into `backend-dist/`, verifies the
runtime contract with the Python payload and the native Methods library, builds
the frontend, then packages with `electron-builder.installer.yml`
(`electron-builder.offline.yml` with `--offline`).

Notes:

- only the CPU flavor and the matching host platform are accepted; cross-host
  and `--platform all` builds are rejected
- `--skip-backend` reuses the payload already in `backend-dist/`;
  `--skip-frontend` reuses `dist/` and `dist-electron/`
- without `--offline`, `backend-dist/offline/` is removed so that a light
  installer cannot pick up a payload left by an offline build
- `--mode standalone` is rejected; portable and all-in-one releases are disabled

### Build inputs

Every build input writes under `backend-dist/`, which electron-builder copies
to `resources/backend/`:

| Command | Output | Target options |
|---|---|---|
| `node scripts/fetch-uv.cjs` | `tools/uv[.exe]` (pinned `uv` 0.10.4, SHA-256 verified) | `--platform`, `--arch` |
| `node scripts/build-wheelhouse.cjs` | `wheels/` (required cohort) | `--platform`, `--arch` |
| `node scripts/studio-document-adapters.cjs --install backend-dist/adapters` | `adapters/studio_document_adapters/` | none |
| `node scripts/build-native-sidecar.cjs` | `native/` and `STUDIO_RUNTIME_CONTRACT.json` | `--target <rust-target-triple>` |
| `node scripts/build-offline-payload.cjs` | `offline/` (offline variant only) | `--platform`, `--arch` |

`--platform` takes `win32`, `linux` or `darwin`; `--arch` takes `x64` or
`arm64`. Both default to the host.

### Wheel locks

The wheels are not resolved at build time. One hash-pinned lock per target
lives in `build/constraints/python-wheels-<platform>-<arch>.json`
(`linux-x64`, `win32-x64`, `darwin-arm64`, `darwin-x64`). For CPython 3.11 on
that target it names the exact file of every package in the offline closure:
the required cohort, the `default_install` recommended packages, and all their
dependencies. `build-wheelhouse.cjs` stages the entries of the required
cohort; `build-offline-payload.cjs` stages the rest. Both only download the
locked files and verify their SHA-256.

Regenerate every lock after any change of `required`, or of a
`default_install` package, in `recommended-config.json`:

```bash
node scripts/python-wheel-lock.cjs
```

This needs `uv` (on `PATH`, or named by `NIRS4ALL_UV`) and network access. The
build scripts refuse a lock that does not match the catalogue.

Packages that publish no wheel for a target are locked as source distributions
and built into wheels when the payload is built:

| Package | Targets | Build requirement |
|---|---|---|
| `pyopls` | all | none (pure Python) |
| `nirs4all-formats` | macOS arm64 | Rust toolchain on the macOS build host |
| `nirs4all-core`, `nirs4all-io`, `nirs4all-formats` | macOS x64 | Rust toolchain on the macOS build host |

Native packages only build on their target host.

### Supported release formats

Publish NSIS for Windows, DEB for Linux, DMG for each macOS architecture, each
with its offline variant, and Docker. Portable and all-in-one archives are
excluded from the release workflow and npm release commands.

### Verification

Verify a staged or packaged backend tree:

```bash
node scripts/native-runtime-contract.cjs \
  --backend-root <dir> --artifact-boundary-root <dir> \
  --platform <platform> --arch <arch> \
  --require-python-payload --require-bundled-methods
```

It checks the sidecar and `libn4m` against the contract and, with
`--require-python-payload`, the presence of `uv`, exactly one wheel per
required package at its `install` version with no other wheel, and the
adapters against their attested manifest
(`sidecar/contracts/studio_document_adapters_v1.json`).

Smoke an unpacked or installed application:

```bash
node scripts/smoke-archive-standalone.cjs --extracted-root <unpacked app> --platform <platform>
```

It creates the environment with the shipped `uv` from the shipped wheels in a
private profile (fully offline when the application carries `offline/`),
launches the packaged application on it, waits for `/api/system/readiness` to
report `ml_ready`, checks `/api/system/env-coherence`, and exercises the
Playground and dataset routes through the Rust sidecar.

The provisioning step is available on its own, and is also what the Docker
image uses:

```bash
node scripts/provision-environment.cjs --backend-root <dir> --env-dir <dir> [--recommended a,b]
```

`--backend-root` is `resources/backend` of an application or `backend-dist/`.
The script creates `<env-dir>/python` and `<env-dir>/venv`, installs the
required cohort and the named recommended packages at their catalogue
versions, and prints the environment's interpreter.

## CI/CD Pipeline

The release workflow is `.github/workflows/release-unified.yml`.

### Trigger

- tag push matching `[0-9]*`
- manual `workflow_dispatch`

### Manual inputs

- `tag`
- `publish_existing_tag`
- `macos_arm64_only`
- `skip_docker`
- `include_macos_x64`

### Jobs

| Job | Purpose |
|---|---|
| `prepare` | Resolve version/tag, prerelease flag, and build switches |
| `quality` | Qualify the release commit |
| `installer-linux` | Linux DEB installer and its offline variant |
| `installer-windows` | Windows NSIS installer and its offline variant |
| `installer-macos-x64` | macOS Intel DMG and its offline variant, signed/notarized when secrets are available |
| `installer-macos-arm64` | macOS Apple Silicon DMG and its offline variant, signed/notarized when secrets are available |
| `docker` | Native container image with nginx, the Rust sidecar and its Python environment |
| `release` | Consolidates the `installer-*` artifacts into the GitHub Release |

Each installer job stages the [build inputs](#build-inputs) for its target,
verifies the runtime contract, packages the installer and the offline
installer, and smokes the packaged application as described under
[Verification](#verification).

## Asset Name Contract

These patterns describe outputs of the release workflow. The workflow must
produce and smoke-test them before they may be attached to a release.
electron-builder writes the product name with a space
(`nirs4all Studio-...`); the published asset uses a dot
(`nirs4all.Studio-...`). `scripts/finalize-release-assets.cjs` enforces the
published set.

### Installer assets

| Platform | Installer | Offline installer |
|---|---|---|
| Windows x64 | `nirs4all.Studio-{version}-win-x64.exe` | `nirs4all.Studio-{version}-win-x64-offline.exe` |
| macOS Apple Silicon | `nirs4all.Studio-{version}-mac-arm64.dmg` | `nirs4all.Studio-{version}-mac-arm64-offline.dmg` |
| macOS Intel (optional) | `nirs4all.Studio-{version}-mac-x64.dmg` | `nirs4all.Studio-{version}-mac-x64-offline.dmg` |
| Linux x64 | `nirs4all.Studio-{version}-linux-amd64.deb` | `nirs4all.Studio-{version}-linux-amd64-offline.deb` |

The in-app update check always selects the installer, never an `-offline`
asset. See [UPDATE_SYSTEM.md](UPDATE_SYSTEM.md#asset-selection-rules).

### Docker asset

| Runtime | Tag |
|---|---|
| Native Rust | `ghcr.io/gbeurier/nirs4all-studio:{version}` |

The container has one public listener: nginx on port `8000`. It serves the
compiled React application and proxies `/api/*` and `/ws*` to
`studio-sidecar` on `127.0.0.1:8001`. The sidecar is the sole product HTTP,
WebSocket, job/control, scheduler and state owner. Its loopback port is neither
exposed nor configurable by container users.

The image's Python environment is built at image build time by
`scripts/provision-environment.cjs`, with `uv` and the same catalogue as the
desktop product: the pinned Python runtime, the required cohort from the locked
wheels, and the recommended packages `shap`, `matplotlib` and `lightgbm`. It
lives at `/opt/nirs4all/python-env/{python,venv}`; the adapters are at
`/opt/nirs4all/backend/adapters`. The sidecar receives it through the same four
variables Electron sets on the desktop:

| Variable | Value in the image |
|---|---|
| `NIRS4ALL_PYTHON_PLUGIN_HOST` | `/opt/nirs4all/python-env/venv/bin/python` |
| `NIRS4ALL_PYTHON_PLUGIN_SITE_PACKAGES` | `/opt/nirs4all/python-env/venv/lib/python3.11/site-packages` |
| `NIRS4ALL_STUDIO_ADAPTERS_DIR` | `/opt/nirs4all/backend/adapters` |
| `NIRS4ALL_SCIENTIFIC_EXECUTOR` | `cpython-stdio-v1` |

The image contains no FastAPI, Uvicorn, `main.py` or `websocket/` sources, and
no `python` command on `PATH`. The sidecar invokes the interpreter only through
the bounded stdio protocol; it never owns a port, scheduler, store, or fallback
route.
The image also embeds the exact `nirs4all-methods` ABI 2.22 library and its
`STUDIO_RUNTIME_CONTRACT.json`; native Archive V2 prediction therefore remains
independent of the Python host. CI supplies that library through the local
BuildKit context `methods-runtime`, never from an unverified URL. The image
build verifies the Methods digest and the attested adapters before the runtime
stage is assembled.

Persist native Studio configuration in `/var/lib/nirs4all-studio` and mount
scientific workspaces under `/workspaces`:

```bash
docker run --rm -p 127.0.0.1:8000:8000 \
  -e NIRS4ALL_STUDIO_TRUSTED_LOCAL_ONLY=1 \
  -v studio-state:/var/lib/nirs4all-studio \
  -v /path/to/workspaces:/workspaces \
  ghcr.io/gbeurier/nirs4all-studio:{version}
```

This explicit local-only mode trusts local users. The default container instead
requires a readable, non-empty password file mounted at
`/run/secrets/studio.htpasswd`; it refuses startup without either configuration.
For shared access, use the password-file mode behind TLS, configure the exact
external origin, and keep the host port bound to loopback behind that proxy.
See [native access configuration](NATIVE_HTTP_ACCESS.md#docker).

The OCI healthcheck calls the Rust-owned `/api/health` route through nginx's
loopback-restricted `/_studio_health`, so healthy status proves both processes
and the reverse-proxy path are available without a public authentication bypass.

Each downloadable artifact must ship with a
`.sha256` sidecar produced by the same release workflow.

## Code Signing And Notarization

### Windows

Windows release jobs optionally import a certificate from:

- `WINDOWS_CERT_BASE64`
- `WINDOWS_CERT_PASSWORD`

When configured, electron-builder signs the generated executables.

### macOS installers

Installer jobs package DMGs with `electron-builder.installer.yml`
(`electron-builder.offline.yml` for the offline variant), then:

1. sign the `.app`
2. build the `.dmg`
3. notarize the `.dmg`
4. staple the notarization ticket

## Update Compatibility

The update contract uses GitHub Releases. An application update is the
installer of the newer version: the update check selects the installer asset
for the platform, never an `-offline` asset, and Studio offers its download.
Running it replaces the application; the user's Python environment and
settings under `userData` are kept. See [UPDATE_SYSTEM.md](UPDATE_SYSTEM.md).

## Troubleshooting

### The release build refuses the wheel lock

`build-wheelhouse.cjs` or `build-offline-payload.cjs` reports that
`build/constraints/python-wheels-<target>.json` does not match
`recommended-config.json`. The catalogue changed after the locks were
generated; run `node scripts/python-wheel-lock.cjs` and commit the locks.

### Contract verification reports files outside the required cohort

`backend-dist/wheels/` must contain exactly one wheel per required package at
its `install` version. Run `node scripts/build-wheelhouse.cjs` again: it
removes every file that is not in the lock.

### The packaged application opens the setup page

Expected on the first launch: no Python environment is selected yet. With the
offline installer, creating the environment needs no network access.

## Files Reference

| File | Purpose |
|---|---|
| `.github/workflows/release-unified.yml` | Source of truth for artifact construction, qualification, and publication |
| `electron-builder.installer.yml` | Installer packaging config |
| `electron-builder.offline.yml` | Offline installer packaging config; extends the installer config |
| `scripts/build-release.cjs` | Local installer build helper (`npm run release`) |
| `scripts/fetch-uv.cjs` | Stages the pinned `uv` release |
| `scripts/python-wheel-lock.cjs` | Generates and reads the hash-pinned wheel locks |
| `scripts/build-wheelhouse.cjs` | Stages the wheels of the required cohort |
| `scripts/build-offline-payload.cjs` | Stages the offline payload |
| `scripts/studio-document-adapters.cjs` | Attests and installs the document adapters |
| `scripts/build-native-sidecar.cjs` | Builds the Rust sidecar and writes the runtime contract |
| `scripts/native-runtime-contract.cjs` | Writes and verifies `STUDIO_RUNTIME_CONTRACT.json` and the Python payload |
| `scripts/macos-attested-runtime.cjs` | macOS `afterPack` pre-signing and re-attestation |
| `scripts/python-runtime-config.cjs` | Pinned python-build-standalone runtime identity |
| `scripts/provision-environment.cjs` | Creates an environment from a backend tree (smokes, Docker image) |
| `scripts/smoke-archive-standalone.cjs` | First-launch smoke test of an unpacked or installed application |
| `scripts/finalize-release-assets.cjs` | Published asset names and checksum sidecars |
| `build/constraints/python-wheels-<platform>-<arch>.json` | Wheel locks |
| `recommended-config.json` | Package catalogue (`required`, `optional`) |
| `Dockerfile` | Native container image |
| `sidecar/src/native_updates.rs` | Release discovery and asset selection for application updates |

## See Also

- [UPDATE_SYSTEM.md](UPDATE_SYSTEM.md)
- [Environment architecture](_internals/environment-architecture.md)
