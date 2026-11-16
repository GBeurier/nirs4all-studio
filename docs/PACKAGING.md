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
| Installer | Windows x64, macOS arm64 (Apple Silicon), Linux x64 | `.exe` (NSIS), `.dmg`, `.deb` | Electron + Rust `native/studio-sidecar` + `uv`, the document adapters and, on Windows and Linux, the wheels of the required packages; on macOS the required packages come from the package index. The Python environment is created or selected at first launch. |
| Offline installer | Windows x64, Linux x64 | `.exe`, `.deb` with the `-offline` suffix | The installer plus the offline payload: the pinned Python runtime archive and the wheels of the default package set and of PyTorch, so the environment is created, and PyTorch added later, without network access. |
| Docker | Linux x64 | `ghcr.io/gbeurier/nirs4all-studio:*` | nginx static UI + loopback Rust sidecar + a Python environment built at image build time from the same catalogue; no Python HTTP backend. |

macOS is supported on Apple Silicon only. A macOS application embeds no wheels,
because wheels are archives that contain unsigned binaries and such archives
fail Apple notarisation. Studio installs its required packages from the
package index there, so a macOS application needs an internet connection at
first launch and has no offline installer.

Installers are the only desktop product: there is no portable executable and
no all-in-one archive.

## Terminology

- `Installer`: standard OS install flow (`.exe`, `.dmg`, `.deb`). Also called
  the light installer.
- `Offline installer`: the Windows or Linux installer with the offline
  payload; its file name ends in `-offline`.
- `Required cohort`: the packages listed under `required` in
  `recommended-config.json` (`nirs4all`, `nirs4all-core`, `dag-ml`,
  `dag-ml-data`, `nirs4all-io`, `nirs4all-methods`) at their `install`
  versions. Every one of them publishes a wheel for each of the three targets.
- `Recommended packages`: the packages listed under `optional`. Those with
  `default_install: true` are preselected when Studio creates an environment.
  PyTorch is not one of them: Studio offers to install it when the user
  selects a neural-network model.
- `offline_payload: true` on a recommended package keeps its wheels in the
  offline installers although it is not installed by default. PyTorch carries
  it, so that it can be added on a machine without network access.
- `Wheelhouse`: one wheel per package of the required cohort. Windows and
  Linux installers embed it as `resources/backend/wheels/`; a macOS
  application has none.
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
    ├── wheels/                 (Windows and Linux)
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
- A macOS application has no `wheels/` directory: Studio installs the
  required packages at the same exact versions from the package index.
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

The offline installer exists for Windows and Linux. It is the installer plus:

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
  the required cohort, the `default_install` recommended packages and the
  `offline_payload` ones (`torch`, locked as CPU wheels), with their
  dependencies.

With this payload Studio creates the environment and installs the required
packages and every default recommended package without network access, and
later installs PyTorch the same way when the user asks for it: the payload is
the closure that `uv` resolved for exactly that set, and the release workflow
installs it with `--offline --no-index` on each platform before publication,
the default packages first and PyTorch afterwards into the same environment.
Studio tries the payload first for every installation; a package that is not
in it (any other recommended package) is then requested from the package
index. PyTorch installed from the payload is the CPU build; with the standard
installer `uv` selects the CPU, CUDA or Metal build for the machine.

It is built with `electron-builder.offline.yml`, which `extends`
`electron-builder.installer.yml` and adds `offline/**/*` to the packaged
resources.

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
the required wheels (on macOS: no embedded wheels), the attested adapters and
the native Methods library.

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
   copied runtime contract, including the Python payload (`uv` and the
   adapters, and the absence of embedded wheels), and selects
   `native/libn4m.dylib`.
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

Without a signing identity, Electron Builder's ad-hoc signature for Apple
Silicon is mirrored for the library, and the hook still re-attests the bytes
in the final `.app`. Custom macOS signing hooks are
rejected because their identity cannot be proven equal to the one used for
this pre-sign phase. This ordering preserves byte attestation; it does not
replace the release workflow's application-signature, notarization, staple,
or extracted-artifact verification gates.

### Payload sizes

Measured on disk on Linux x64 on 2026-11-16:

| Part | Size |
|---|---|
| `tools/uv` | 53 MB |
| `wheels/` (required cohort) | 45 MB |
| `adapters/` | 1.5 MB |
| `native/libn4m.so` | 6.6 MB |
| `native/studio-sidecar` (release build) | about 40 MB |
| `resources/backend/` of the installer | about 150 MB |
| `offline/` | 1.10 GB: 54 wheels, 1.05 GB, of which `xgboost` and `nvidia-nccl-cu12` 590 MB and CPU `torch` with its own dependencies 188 MB; Python archive 46 MB |

PyTorch is no longer installed by default but stays in the offline payload, so
the payload has the size it had when PyTorch was a default package.

Time to create the default environment (Python runtime, required cohort and
default recommended packages), measured the same day on the same machine with
an empty `uv` cache:

| Source | Default environment | Adding PyTorch afterwards |
|---|---|---|
| Offline payload, no network | 7 s, 2.0 GB on disk | 2 s, CPU build, 0.7 GB more |
| Standard installer, package index | 4 min 22 s, 2.0 GB on disk | 6 min 22 s on a machine with an NVIDIA GPU (CUDA build), 4.5 GB more |

The second row is download time on that machine's connection (about 1 GB,
then about 2.5 GB); it varies with the network.

A `resources/backend/` that carries a complete Python runtime weighs about
1.5 GB.

Not measured on their platforms: the following are the download sizes of the
locked files, summed from the locks.

| Target | Required cohort | Offline wheels | Python archive |
|---|---|---|---|
| Windows x64 | 38 MB | about 580 MB | 45 MB |
| macOS arm64 | 61 MB (downloaded from the package index at first launch) | no offline installer | 18 MB (downloaded at first launch) |

## Build Entry Points

### Installer-oriented local builds

Use `scripts/build-release.cjs` for installer packaging:

```bash
npm run release -- --clean --platform win
npm run release -- --clean --platform mac
npm run release -- --clean --platform linux
npm run release -- --clean --platform linux --offline
```

On macOS the script stages no wheels and refuses `--offline`.

The script stages the build inputs below into `backend-dist/`, verifies the
runtime contract with the Python payload and the native Methods library, builds
the frontend, then packages with `electron-builder.installer.yml`
(`electron-builder.offline.yml` with `--offline`).

Notes:

- only the CPU flavor and the matching host platform are accepted (x64 on
  Windows and Linux, arm64 on macOS); cross-host and `--platform all` builds
  are rejected
- `--skip-backend` reuses the payload already in `backend-dist/`;
  `--skip-frontend` reuses `dist/` and `dist-electron/`
- without `--offline`, `backend-dist/offline/` is removed so that a light
  installer cannot pick up a payload left by an offline build

### Build inputs

Every build input writes under `backend-dist/`, which electron-builder copies
to `resources/backend/`:

| Command | Output | Target options |
|---|---|---|
| `node scripts/fetch-uv.cjs` | `tools/uv[.exe]` (pinned `uv` 0.10.4, SHA-256 verified) | `--platform`, `--arch` |
| `node scripts/build-wheelhouse.cjs` | `wheels/` (required cohort; Windows and Linux, the macOS target is refused) | `--platform`, `--arch` |
| `node scripts/studio-document-adapters.cjs --install backend-dist/adapters` | `adapters/studio_document_adapters/` | none |
| `node scripts/build-native-sidecar.cjs` | `native/` and `STUDIO_RUNTIME_CONTRACT.json` | `--target <rust-target-triple>` |
| `node scripts/build-offline-payload.cjs` | `offline/` (offline variant, Windows and Linux) | `--platform`, `--arch` |
| `node scripts/build-offline-payload.cjs --image` | `offline/` with the closure of the Docker image instead | `--platform`, `--arch` |

`--platform` and `--arch` name one of the three targets (`win32` `x64`,
`linux` `x64`, `darwin` `arm64`) and default to the host.

### Wheel locks

The wheels are not resolved at build time. One hash-pinned lock per target
lives in `build/constraints/python-wheels-<platform>-<arch>.json`
(`linux-x64`, `win32-x64`, `darwin-arm64`). For the CPython minor version
pinned in `scripts/python-runtime-config.cjs` on that target, it names the
exact file of every package Studio ships:

- `packages`: the required cohort and, for the targets that have an offline
  installer, the `default_install` and the `offline_payload` recommended
  packages and all their dependencies. The lock names the two groups
  separately (`requirements.recommended`, `requirements.offline_extras`). The
  macOS lock holds the required cohort only: nothing is staged from it, it
  proves that every required package publishes a macOS arm64 wheel, which is
  what lets Studio install them from the package index.
- `image_packages` (Linux only): the closure of the Docker image, that is the
  required cohort and the image extras (`shap`, `matplotlib`, `lightgbm`) with
  all their dependencies, at the same versions as `packages` wherever both
  need a package.

`build-wheelhouse.cjs` stages the entries of the required cohort;
`build-offline-payload.cjs` stages the rest of `packages`, or of
`image_packages` with `--image`. Both only download the locked files and
verify their SHA-256.

A lock also records what it was resolved from: the catalogue's exact
requirements, the Python version, and the rules of its target (resolution
platform, macOS deployment target, packages locked as source distributions).
The build scripts refuse a lock when any of these no longer matches.

Regenerate every lock after any change of `required`, or of a
`default_install` or `offline_payload` package, in `recommended-config.json`:

```bash
node scripts/python-wheel-lock.cjs
```

This needs `uv` (on `PATH`, or named by `NIRS4ALL_UV`) and network access.

`pyopls` publishes no wheel: it is pure Python, is locked as a source
distribution in the offline and image closures, and is built into a wheel with
a `uv`-managed Python when the payload is built. Every other locked file is a
wheel, and no required package is built from source on any target.

### Supported release formats

Publish NSIS for Windows and DEB for Linux, each with its offline variant, DMG
for macOS arm64, and Docker. Nothing else is built or published.

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
required package at its `install` version with no other wheel (for
`--platform darwin`: no `wheels/` directory), and the adapters against their
attested manifest
(`sidecar/contracts/studio_document_adapters_v1.json`).

Two smokes run on an unpacked application, and both are release gates:

```bash
node scripts/smoke-archive-standalone.cjs --extracted-root <unpacked app> --platform <platform>
node scripts/smoke-packaged-ui.cjs --extracted-root <unpacked app> --platform <platform> \
  --installer <installer file> --output <proof.json>
```

- `smoke-archive-standalone.cjs` checks the payload. A script
  (`provision-environment.cjs`) creates an environment with the shipped `uv`
  from the shipped wheels in a private profile; when the application carries
  `offline/`, nothing comes from the network (`--offline --no-index`), the
  default recommended packages are installed too and PyTorch is then added to
  that environment, which proves that the payload is complete on that
  platform. The packaged application is then
  launched on that environment: the smoke waits for `/api/system/readiness` to
  report `ml_ready`, checks `/api/system/env-coherence`, and exercises the
  Playground and dataset routes through the Rust sidecar.
- `smoke-packaged-ui.cjs` checks the application. On a fresh profile the
  renderer opens the setup page and Studio creates the environment itself,
  through `window.electronApi.pythonEnv.create` with the packages it
  preselects; `shap` and `matplotlib` are then added the same way. The smoke
  waits for the scientific host, saves a preference, reloads, restarts, and
  runs one real training followed by its SHAP analysis in the renderer. It
  needs `RELEASE_SOURCE_SHA`, `RELEASE_VERSION` and the cohort variables of
  the release workflow. `scripts/smoke-first-launch-ui.cjs` is the same run
  without the release identity checks and the SHAP journey.

On macOS both install the required packages from the package index.

The provisioning step is available on its own, and is also what the Docker
image uses:

```bash
node scripts/provision-environment.cjs --backend-root <dir> --env-dir <dir> [--recommended a,b]
```

`--backend-root` is `resources/backend` of an application or `backend-dist/`.
The script creates `<env-dir>/python` and `<env-dir>/venv`, installs the
required cohort and the named recommended packages at their catalogue
versions, and prints the environment's interpreter. With an `offline/`
directory in the backend tree it installs from that payload only.

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

### Jobs

| Job | Purpose |
|---|---|
| `prepare` | Resolve version/tag, prerelease flag, and build switches |
| `quality` | Qualify the release commit |
| `installer-linux` | Linux DEB installer and its offline variant |
| `installer-windows` | Windows NSIS installer and its offline variant |
| `installer-macos-arm64` | macOS Apple Silicon DMG; signed/notarized when secrets are available |
| `docker` | Native container image with nginx, the Rust sidecar and its Python environment |
| `release` | Consolidates the `installer-*` artifacts into the GitHub Release |

The Linux and Windows jobs run once per variant (`standard`, `offline`). Each
leg stages the [build inputs](#build-inputs) for its target, verifies the
runtime contract, packages its installer, and runs both smokes described under
[Verification](#verification) on the unpacked application.

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
| macOS Apple Silicon | `nirs4all.Studio-{version}-mac-arm64.dmg` | none |
| Linux x64 | `nirs4all.Studio-{version}-linux-amd64.deb` | `nirs4all.Studio-{version}-linux-amd64-offline.deb` |

`expectedPublishedNames` in `scripts/finalize-release-assets.cjs` is that
exact set of five files; a release directory with a missing or an additional
payload is refused.

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
desktop product: the pinned Python runtime, the required cohort, and the
recommended packages `shap`, `matplotlib` and `lightgbm`. Every file comes
from the Linux lock (`image_packages`): `build-offline-payload.cjs --image`
downloads the Python archive and each distribution by pinned SHA-256, and the
environment is installed with `--offline --no-index`. It
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

The macOS job packages the DMG with `electron-builder.installer.yml`. When the
Apple secrets are configured it then:

1. signs the `.app`
2. builds the `.dmg`
3. notarizes the `.dmg`
4. staples the notarization ticket

Without those secrets the DMG is published unsigned. macOS then blocks the
first opening of the application: the user allows it in System Settings >
Privacy & Security > Open Anyway. The application embeds no wheels so that it
contains no unsigned binary inside an archive.

## Update Compatibility

The update contract uses GitHub Releases. An application update is the
installer of the newer version: the update check selects the installer asset
for the platform, never an `-offline` asset, and
Studio offers its download.
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
offline installer (Windows, Linux), creating the environment needs no network
access. On macOS it needs one: Studio downloads the Python runtime and
installs its required packages from the package index.

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
| `scripts/build-offline-payload.cjs` | Stages the offline payload, or the Docker image closure with `--image` |
| `scripts/studio-document-adapters.cjs` | Attests and installs the document adapters |
| `scripts/build-native-sidecar.cjs` | Builds the Rust sidecar and writes the runtime contract |
| `scripts/native-runtime-contract.cjs` | Writes and verifies `STUDIO_RUNTIME_CONTRACT.json` and the Python payload |
| `scripts/macos-attested-runtime.cjs` | macOS `afterPack` pre-signing and re-attestation |
| `scripts/python-runtime-config.cjs` | Pinned python-build-standalone runtime identity |
| `scripts/provision-environment.cjs` | Creates an environment from a backend tree (smokes, Docker image) |
| `scripts/smoke-archive-standalone.cjs` | Payload smoke of an unpacked or installed application |
| `scripts/smoke-first-launch-ui.cjs` | Application smoke: environment created by Studio from its setup page |
| `scripts/smoke-packaged-ui.cjs` | Release gate: the application smoke with release identity checks and a training + SHAP journey |
| `scripts/finalize-release-assets.cjs` | Published asset names and checksum sidecars |
| `build/constraints/python-wheels-<platform>-<arch>.json` | Wheel locks |
| `recommended-config.json` | Package catalogue (`required`, `optional`) |
| `Dockerfile` | Native container image |
| `sidecar/src/native_updates.rs` | Release discovery and asset selection for application updates |

## See Also

- [UPDATE_SYSTEM.md](UPDATE_SYSTEM.md)
- [Environment architecture](_internals/environment-architecture.md)
