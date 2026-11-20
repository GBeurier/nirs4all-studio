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
| Offline installer | Windows x64, Linux x64 | `.exe`, `.deb` with the `-offline` suffix | The installer plus the offline payload: the pinned Python runtime archive and the wheels of the default package set, of XGBoost and of PyTorch, so the environment is created, and XGBoost or PyTorch added later, without network access. |
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
  selects a neural-network model. XGBoost is not one either: the user installs
  it in Settings > Python.
- `offline_payload: true` on a recommended package keeps its wheels in the
  offline installers although it is not installed by default. PyTorch and
  XGBoost carry it, so that they can be added on a machine without network
  access.
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
  `offline_payload` ones (`xgboost`; `torch`, locked as CPU wheels), with
  their dependencies.

With this payload Studio creates the environment and installs the required
packages and every default recommended package without network access, and
later installs XGBoost or PyTorch the same way when the user asks for them:
the payload is the closure that `uv` resolved for exactly that set, and the
release workflow installs it with `--offline --no-index` on each platform
before publication, the default packages first and XGBoost and PyTorch
afterwards into the same environment.
Studio tries the payload first for every installation except PyTorch; a
package that is not in it (any other recommended package) is then requested
from the package index.

PyTorch is the exception because the payload carries its CPU build only.
Studio asks the package index first, with `--torch-backend auto` as on the
standard installer, so that `uv` selects the CPU or CUDA build for the
machine; when the index cannot be reached, or cannot satisfy the request,
Studio installs the CPU build from the payload instead. Both attempts keep the
installed required packages pinned. When PyTorch is requested together with
other packages it is resolved first and on its own, and the other packages
then follow the payload-first order.

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
one content-addressed native Methods library at ABI 2.24
(`nirs4all-methods` 1.5.1). Every release gate invokes
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

PyTorch and XGBoost are no longer installed by default but stay in the offline
payload, so the payload has the size it had when they were default packages.

Time to create the default environment (Python runtime, required cohort and
default recommended packages), measured on 2026-11-17 on the same machine with
an empty `uv` cache:

| Source | Default environment | Adding XGBoost and PyTorch afterwards |
|---|---|---|
| Offline installer, no network | 2 s, 1.2 GB on disk | 3 s for both from the payload (PyTorch as the CPU build), 1.6 GB more: XGBoost 0.8 GB, PyTorch 0.7 GB |
| Standard installer, package index | 57 s, 1.2 GB on disk | XGBoost: about 1 min 10 s, 0.8 GB more. PyTorch: 6 min 22 s on a machine with an NVIDIA GPU (CUDA build), 4.5 GB more (measured on 2026-11-16) |

The second row is download time on that machine's connection (about 0.3 GB
for the default environment, 0.6 GB for XGBoost with `nvidia-nccl-cu12`, about
2.5 GB for the CUDA build of PyTorch); it varies with the network. With
XGBoost among the default packages, as before, the same measurement took
2 min 6 s on 2026-11-17 and 4 min 22 s on 2026-11-16, for 2.0 GB on disk; the
XGBoost figure of the second row is the difference of the two measurements of
2026-11-17. An offline installer on a machine with a network installs PyTorch
like the second row.

A `resources/backend/` that carries a complete Python runtime weighs about
1.5 GB.

The Windows and macOS payloads were not measured on their platforms. The
following are download sizes: the sum of the sizes that the package index and
the python-build-standalone release report for the files named in the wheel
locks and in `scripts/python-runtime-config.cjs`, queried on 2026-11-16. The
locks record names, URLs and hashes, not sizes.

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

### Version constraints

Studio follows the ecosystem versioning rule. Versions are `X.Y.Z`: a patch
(`Z`) carries fixes and purely additive, backward-compatible features; a minor
(`Y`) carries any compatibility break (API signature, ABI break or ABI version
change, wire/schema/fixture, renamed ids, changed numerical results).
Cross-repository constraints accept every patch of one tested minor series,
`>=X.Y[.Z],<X.(Y+1)`, with a patch floor only when a fix or feature from that
patch is required; moving to a new minor series is an explicit, tested Studio
decision. For 1.x owners the caret forms that stop at the next major (npm
`^1.x`, Cargo `"1.x"`, `<2`) are not used.

The sidecar depends on `nirs4all = "0.6"` and `nirs4all-io = "0.3"` (0.x Cargo
caret ranges, which stop at the next minor). The `range` of a `required` package
in `recommended-config.json` (the versions an existing Python environment may
hold) follows the same rule, for example `nirs4all-io >=0.3,<0.4`; an empty
range accepts any version. The 1.x `nirs4all-methods`/`pls4all` ranges
`>=1.5.1,<1.6` accept the selected Methods series. These ranges are Studio's environment-admission
ranges: Studio reinstalls the required cohort at its `install` versions only
when an environment falls outside them, so the SDK range floor
(`>=1.6.0,<1.7`) is how a Studio release delivers the selected SDK series to existing
environments, and its minor cap is where Studio qualifies its Python host.
Exact versions are not constraints: the `install` versions, the hash-pinned
wheel locks above, `sidecar/Cargo.lock`, `build/runtime-cohort.json` and the
packaged Methods identity define exactly what Studio installs and ships, and
stay exact. An owner patch release therefore never forces a Studio release. The
full policy is
[`docs/contracts/release/VERSION_CONSTRAINTS.md`](https://github.com/GBeurier/nirs4all-ecosystem/blob/main/docs/contracts/release/VERSION_CONSTRAINTS.md) in
`nirs4all-ecosystem`. `tests/test_nirs4all_release_pin.py` checks the sidecar
ranges, the single source of the SDK range and the locks.

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
  default recommended packages are installed too and XGBoost and PyTorch are
  then added to that environment, which proves that the payload is complete on that
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
  then opens the public-datasets button, downloads the selected Canopy source
  through the Datasets owner into a fresh workspace cache, waits for Rust job
  registration, and previews the registered data before reloading the renderer.
  The proof records source identity, dimensions, targets and preview values. It
  needs `RELEASE_SOURCE_SHA`, `RELEASE_VERSION` and the cohort variables of
  the release workflow. `scripts/smoke-first-launch-ui.cjs` is the same run
  without the release identity checks or the training/SHAP and public-dataset journeys.

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

- `tag`: exact immutable source tag.
- `publish_existing_tag`: explicitly publish a qualified existing-tag retry;
  false (the default) only builds and smokes.
- `delivery_channel`: `all`, `linux-standard`, `linux-offline`,
  `windows-standard`, `windows-offline`, `macos-arm64`, or `docker`.
- `macos_arm64_only`: legacy macOS-only selection. Diagnostic runs skip the
  common source gate; publishing still requires that gate and the explicit
  `publish_existing_tag` input.
- `skip_docker`: omit Docker when selecting all channels.

### Jobs and independent deliveries

| Job | Purpose |
|---|---|
| `prepare` | Resolve the immutable source, version, runtime cohort and selected channels |
| `quality` | Shared frontend, backend, Rust fmt/clippy/tests and native-session authentication gates |
| `release-draft` | Prepare one source-verified draft under a per-tag lock; no installer assets or public release |
| `installer-linux` | Qualify and publish each selected DEB variant independently |
| `installer-windows` | Windows containment tests, then qualify and publish each selected NSIS variant independently |
| `installer-macos-arm64` | Qualify and publish the Apple Silicon DMG; signing/notarization rules remain unchanged |
| `docker` | Qualify and publish the exact tested native container image independently |
| `delivery-summary` | Report available, pending and failed channels after delivery; no producer depends on it |

The Linux and Windows jobs run once per selected variant (`standard`,
`offline`). Each leg stages the [build inputs](#build-inputs), verifies its
runtime contract, packages its installer, and runs both smokes described under
[Verification](#verification). Only a successful leg may attach its installer
and checksum. A failed Docker, macOS or sibling variant does not block a
qualified channel. Shared source gates still block every publication when they
fail; standalone CI also retains its full Docker and packaging checks.

One serialized metadata job prepares the draft before installer producers;
individual channels never create drafts. The first qualified installer makes
the GitHub Release public. Later channels
append their exact installer/checksum pair to the same immutable source tag;
existing assets are verified and never replaced. Release notes distinguish
attached assets from pending or failed channels and link the workflow evidence.
Retry a missing channel by dispatching this workflow with its original `tag`,
`publish_existing_tag=true` and the specific `delivery_channel`. Changes to
application source require a new version and tag. Docker retries use
`delivery_channel=docker`; package-index publication is an upstream owner
channel and does not wait for Studio delivery.

### Candidate package lane

`.github/workflows/multimodal-package-candidate.yml` is a manual, nonpublishing
lane. It qualifies unpublished candidates of `nirs4all`, `nirs4all-io` and
`dag-ml` inside the real product, before they are published and before Studio
pins them. It creates no release, tag or registry entry; installers and
identity files are kept as workflow artifacts for seven days.

Inputs `nirs4all_ref`, `nirs4all_io_ref` and `dag_ml_ref` are 40-character
commit SHAs of the candidate sources. An empty input selects the source commit
of the published cohort member recorded in `build/runtime-cohort.json`.

The candidates enter through the mechanism of the product:

1. The wheels are built from the selected commits (`dag-ml` with the unpublished
   version its own `scripts/prepare_python_candidate.py` assigns).
2. `scripts/prepare-multimodal-package-candidate.cjs` patches the disposable
   checkout: each candidate becomes the `install` version of its `required`
   entry in `recommended-config.json` and the file name and SHA-256 of its
   entry in the target's wheel lock, and is copied to `backend-dist/wheels/`.
   The accepted `range` is not changed: a candidate outside it is refused by
   the application, and the range is then a change for the Studio branch. The
   checkout also receives the app version `<version>-dev.0`.
3. `build-wheelhouse.cjs` keeps a staged wheel only when its SHA-256 is the
   locked one and downloads the other required wheels; the installer is built
   from the [build inputs](#build-inputs) and its runtime contract is verified
   with the Python payload.
4. `smoke-archive-standalone.cjs` checks the payload. The environment it
   provisions from the shipped `uv` and wheels must hold every file of the
   candidate wheels (`scripts/verify-installed-candidate-wheels.py`) and pass
   the candidate SDK's `tests/qualification/installed_multimodal_provider.py`.
5. `smoke-multimodal-ui.cjs` lets the application create its environment from
   the setup page and runs the multimodal journey in the renderer: import of a
   four-source cohort, a run, its `.n4a` export and a replay without training.
   The environment that the application created is compared with the candidate
   wheels as well, whatever the outcome of the journey.

A candidate may carry the version of a published release: `uv` 0.10.4 installs
the shipped wheel rather than the index file of the same version, and the
comparison of installed files is what proves it.

The lane covers Linux (installed DEB) and Windows (unpacked NSIS application).
macOS is excluded: a macOS application embeds no wheels and installs its
required packages from the package index, so it cannot ship an unpublished
candidate. Only the standard installer is built; the offline and Docker
closures of the patched lock still describe the published cohort. The Rust
sidecar and `native/libn4m` keep the sources and the Methods library pinned by
the checkout.

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

`expectedPublishedNames` in `scripts/finalize-release-assets.cjs` declares that
exact set of five files. The default full-set mode refuses missing or additional
payloads. An explicit installer channel requires exactly its one payload and
checksum; `scripts/stage-release-channel.cjs` verifies that pair before the
publisher appends it without replacing any existing asset.

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
The image also embeds the exact `nirs4all-methods` 1.5.1 ABI 2.24 library and its
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
| `scripts/smoke-packaged-ui.cjs` | Release gate: application setup, release identity, training/SHAP and public-source dataset import/preview |
| `scripts/smoke-public-dataset-journey.cjs` | Public button/catalogue, original-source acquisition, Rust registration and persisted preview journey |
| `scripts/finalize-release-assets.cjs` | Published asset names and checksum sidecars |
| `.github/workflows/multimodal-package-candidate.yml` | Manual nonpublishing qualification of unpublished Python candidates |
| `scripts/prepare-multimodal-package-candidate.cjs` | Selects candidate wheels in the catalogue and the wheel lock of a disposable checkout |
| `scripts/smoke-multimodal-ui.cjs` | Application smoke with the multimodal import, run, archive and replay journey |
| `scripts/verify-installed-candidate-wheels.py` | Compares an environment with the exact files of candidate wheels |
| `build/constraints/python-wheels-<platform>-<arch>.json` | Wheel locks |
| `recommended-config.json` | Package catalogue (`required`, `optional`) |
| `Dockerfile` | Native container image |
| `sidecar/src/native_updates.rs` | Release discovery and asset selection for application updates |

## See Also

- [UPDATE_SYSTEM.md](UPDATE_SYSTEM.md)
- [Environment architecture](_internals/environment-architecture.md)
