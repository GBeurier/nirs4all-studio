<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/horizontal-dark.svg">
  <img src="assets/brand/horizontal.svg" width="380" alt="nirs4all-studio">
</picture>
<br><br>
<img src="public/logo-cirad-en.jpg" width="260" alt="CIRAD Logo">

**Unified NIRS Analysis Desktop Application**

A modern desktop application for Near-Infrared Spectroscopy (NIRS) data analysis, with a Rust-owned product control plane, React UI, native Methods execution, and bounded CPython stdio interoperability for explicit libraries/plugins.

[![License: CECILL-2.1 OR AGPL-3.0-or-later](https://img.shields.io/badge/license-CeCILL--2.1%20OR%20AGPL--3.0--or--later-blue.svg)](LICENSES)
[![Node 20+](https://img.shields.io/badge/node-20+-green.svg)](https://nodejs.org/)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)

[Download](https://github.com/GBeurier/nirs4all-studio/releases/latest) •
[User Guide](docs/user-guide/) •
[nirs4all Library](https://github.com/GBeurier/nirs4all) •
[Website](https://nirs4all.org)

</div>

---

<div align="center">
<img src="https://nirs4all.org/assets/screenshots_studio/playground-page.png" width="900" alt="Playground — Interactive spectral exploration">
<br><em>Playground — Interactive spectral exploration with PCA, distributions, and preprocessing preview</em>
</div>

---

## Which nirs4all do you need?

nirs4all comes in two flavors — pick the one that fits your workflow:

| | **nirs4all Studio** (Desktop App) | **nirs4all** (Python Library) |
|---|---|---|
| **Best for** | Researchers, technicians, and anyone who prefers a visual interface | Developers, data scientists, and anyone who writes Python scripts |
| **What it is** | A Rust-owned desktop product with drag-and-drop pipelines, interactive charts, and bounded native training; CPython is a stdio library/plugin host only | A `pip install` Python package with a declarative API for building NIRS pipelines in code |
| **Install** | [Download the installer](https://github.com/GBeurier/nirs4all-studio/releases/latest) for Windows, macOS (Apple Silicon) or Linux | `pip install nirs4all` |
| **Repository** | **You are here** | [GBeurier/nirs4all](https://github.com/GBeurier/nirs4all) |

> **Not sure?** If you've never written Python code, start here with **nirs4all Studio**.
> Studio exposes a deliberately bounded product surface rather than mirroring
> every Python-library capability.

---

## Installation

Studio is distributed as installers, attached to each
[release](https://github.com/GBeurier/nirs4all-studio/releases/latest).
Download the one for your platform and run it.

### Installers

| Platform | Installer | Offline installer |
|----------|-----------|-------------------|
| **Windows x64** | `nirs4all.Studio-<version>-win-x64.exe` | `nirs4all.Studio-<version>-win-x64-offline.exe` |
| **macOS** (Apple Silicon) | `nirs4all.Studio-<version>-mac-arm64.dmg` | none |
| **Linux x64** | `nirs4all.Studio-<version>-linux-amd64.deb` | `nirs4all.Studio-<version>-linux-amd64-offline.deb` |

The installer contains the application and its Rust sidecar, the product
backend. It ships no Python. **You don't need Python installed on your
machine**: on first launch Studio lists the Python environments it finds and
you either pick one or let Studio create one for you.

- **One environment, chosen by you.** Studio uses exactly one Python
  environment. When it creates one, it downloads a pinned Python runtime and
  builds the environment with the `uv` tool shipped in the installer.
- **Required packages are automatic.** `nirs4all` and its companion packages
  are installed from wheels shipped in the installer (on macOS, from the
  package index) and kept up to date at each launch.
- **Recommended packages are your choice.** Deep-learning, boosting,
  explainability and other optional packages are installed one by one, on
  request. PyTorch is not installed when the environment is created, which
  keeps the first setup short: Studio offers to install it when you select a
  neural-network model, in the build that matches your machine (CPU, CUDA or
  Apple Metal).
- **Application updates are small.** To update, download the installer of the
  newer version (**Settings > Updates** offers it), close Studio and run it.
  It replaces the application only; your environment stays in place.

On Windows and Linux, pick the **offline installer** (file name ending in
`-offline`) for machines without network access: it also carries the Python
runtime and the wheels of the default package set, so the environment is
created without downloading anything, and the CPU build of PyTorch, which can
then be installed on request without network access too. Updates always use
the standard installer.

macOS is supported on Apple Silicon only and needs an internet connection at
first launch: Studio downloads the Python runtime and its required packages.
If macOS blocks the first opening of the application, open
**System Settings > Privacy & Security** and choose **Open Anyway**.

You can switch environment at any time in **Settings > Python**. Development
(editable) installs are never modified by Studio.

### Developer setup from source

For contributors, or if you want to hack on the code. Requires **Node.js 20+** and **Python 3.11+**.

```bash
git clone https://github.com/GBeurier/nirs4all-studio.git
cd nirs4all-studio
npm install
```

The optional Python commands in [Getting Started](#getting-started) start only
the transitional web-development or explicit whole-session diagnostic server.
Packaged desktop mode uses the Rust sidecar and can never select that Python
HTTP process as a product route or fallback.

### Installation comparison

| | Installer | Offline installer | Developer |
|---|---|---|---|
| **Install required** | Yes | Yes | Clone + npm install |
| **Python required beforehand** | No (Studio creates an environment, or uses one of yours) | No | Yes (3.11+) |
| **Network on first launch** | Yes, when Studio creates the environment (always on macOS) | No (Windows and Linux only) | Yes |
| **Updates** | Standard installer of the newer version | Standard installer of the newer version | git pull |
| **Best for** | End users | Machines without network access | Contributors |

### Docker image

The product container serves the compiled frontend with nginx on port `8000`.
Requests under `/api` and `/ws` are proxied to the Rust sidecar bound only to
`127.0.0.1:8001` inside the container. The image contains no FastAPI/Uvicorn
runtime or Python backend source.
Startup requires a mounted password file or an explicit trusted-local-only
configuration; see [Docker access](docs/NATIVE_HTTP_ACCESS.md#docker). Do not
publish an unauthenticated container port on a shared network.
It does include the content-addressed `nirs4all-methods` ABI 2.22 library used by
the Rust/Core Archive V2 prediction path, and a Python environment built at
image build time with `uv` from the same package catalogue as the desktop
product (the required packages plus `shap`, `matplotlib` and `lightgbm`).

The image is tagged `ghcr.io/gbeurier/nirs4all-studio:<version>`.

The image's Python environment is used only for bounded Rust-to-Python stdio
calls. It never owns an HTTP port, scheduler, store, or fallback route. See
[Docker packaging](docs/PACKAGING.md#docker-asset) for the exact boundary.

---

## Getting Started

> This section is strictly for **developers running from source**. Python and
> FastAPI commands below start the transitional browser-development or explicit
> diagnostic stack only. They are not installation instructions for the
> desktop product and cannot become its backend or fallback.

### Prerequisites

- Node.js 20+ (recommended: use `nvm` + the version in `.nvmrc`)
- Python 3.11+
- nirs4all library (optional for UI development)

### Cross-Platform Support

This project supports development on:
- **Windows Native** - PowerShell, cmd.exe, or Windows Terminal
- **Linux** - Any distribution with Node.js and Python
- **macOS** - Apple Silicon
- **WSL2** - Windows Subsystem for Linux

---

### Windows Native Setup

1. **Install Node dependencies:**
   ```cmd
   npm install
   ```

2. **Install Python dependencies:**
   ```cmd
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements-cpu.txt
   ```

3. **Check your environment:**

   ```cmd
   npm run doctor
   ```

4. **Start development servers (diagnostic web stack only):**

   Use the cross-platform launcher for the full web stack:

   ```cmd
   scripts\launcher.cmd start web:dev
   scripts\launcher.cmd stop
   ```

   Or run the frontend and the diagnostic-only FastAPI server separately:
   ```cmd
   npm run dev          REM Frontend (Vite) at http://localhost:5173
   ```

   Terminal 2:
   ```cmd
   .venv\Scripts\activate
   python -m uvicorn main:app --reload --port 8000
   ```

   Desktop mode:

   ```cmd
   npm run start:desktop
   ```

---

### Linux / macOS Setup

1. **Install Node dependencies:**
   ```bash
   npm install
   ```

2. **Install Python dependencies:**
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements-cpu.txt  # or requirements-gpu.txt for GPU
   ```

3. **Check your environment:**

   ```bash
   npm run doctor
   ```

4. **Start development servers (diagnostic web stack only):**

   Use the cross-platform launcher for the full web stack:

   ```bash
   ./scripts/launcher.sh start web:dev
   ./scripts/launcher.sh stop
   ```

   Or run the frontend and the diagnostic-only FastAPI server separately:
   ```bash
   npm run dev          # Frontend (Vite) at http://localhost:5173
   ```

   Terminal 2:
   ```bash
   source .venv/bin/activate
   python -m uvicorn main:app --reload --port 8000
   ```

   Desktop mode:

   ```bash
   npm run start:desktop
   ```

---

### WSL2 Setup (Windows Subsystem for Linux)

If you prefer using WSL2, make sure you're using Linux `node`/`npm` (not the Windows ones mounted under `/mnt/c`).

1. **One-time: permanently disable Windows PATH injection into WSL** (prevents UNC/cmd.exe install failures):
   ```bash
   sudo tee /etc/wsl.conf <<'EOF'
   [interop]
   appendWindowsPath=false
   EOF
   ```
   Then restart WSL from Windows:
   ```powershell
   wsl.exe --shutdown
   ```

2. **Install/use Node via nvm (WSL-native):**
   ```bash
   npm run setup:wsl
   nvm use
   ```

Quick check (should NOT point to `/mnt/c/...`):
```bash
which node
which npm
```

Then follow the Linux setup instructions above.

---

### Desktop Mode (Electron)

To run as a desktop application:

```bash
# Development mode (with hot reload)
npm run dev:electron

# Build and preview (production mode)
npm run electron:preview
```

Electron starts the Rust control-plane sidecar and creates the desktop window
without starting a Python HTTP server. In the normal desktop product every
renderer HTTP/WebSocket request is preselected for a qualified Rust route;
unmigrated routes fail closed before Python acquisition. The interpreter of the
selected Python environment is used only as the bounded stdio library/plugin
host invoked by Rust.

The desktop product has no Python HTTP activation flag, environment override,
IPC acquisition path, or renderer target. Web-development server sources remain
in the checkout, but they are outside the packaged Electron dependency graph
and absent from product installers.

The native sidecar is the packaged product backend, not an opt-in hybrid.
`npm run start:desktop` builds the Rust backend incrementally in release mode
before launching Electron, so backend changes take effect on the next launch.
The first Rust build takes longer; subsequent launches reuse unchanged build
artifacts. For development, `NIRS4ALL_NATIVE_SIDECAR_PATH` may point to a specific built
`studio-sidecar` binary and `NIRS4ALL_NATIVE_SIDECAR_PORT` may select its
loopback port (default `0`, an ephemeral port). Packaged Electron instead
verifies and starts the bundled content-addressed
`resources/backend/native/studio-sidecar`. It routes only explicitly migrated
UI calls through Rust; every other route family refuses before fetch in the
normal session. `STUDIO_RUNTIME_CONTRACT.json` content-addresses the sidecar
and the native Methods library. The Python interpreter is the one of the
environment selected in Studio (`userData/env-settings.json`); Electron passes
it to the sidecar when it starts it, and inherited environment values cannot
replace it. The sidecar admits the interpreter when it is CPython 3.11 or
newer and its `nirs4all` version is within the range Studio requires. The
worker starts with `-I -S -B` and receives the environment's package directory
and Studio's own document adapters explicitly, so the user site and bytecode
side effects are not acquisition paths. The bounded stdio worker,
Rust-owned terminal callback, and native saved-input resolver are implemented.
On qualified Unix launches, the resolver accepts only one train-only numeric
regression dataset and an explicit saved KFold + PLS pipeline, delegates
assembly to `nirs4all-io`, and passes a path-free matrix payload to CPython.
Other scientific shapes fail before job/event/durable mutation; Windows stays
unavailable until process-tree termination is qualified. The first UI-backed native
routes are `/api/health`, `/api/system/capabilities`, `/api/system/info`, and
`/api/system/env-coherence`, `/api/system/network`, `/api/updates/version`,
`/api/updates/settings`, plus `/api/app/settings`,
`/api/app/favorites`, `/api/app/config-path`, the `/api/workspaces` catalogue,
and native workspace activation/unlink mutations. They are served by Rust and
do not fall back to FastAPI after sidecar selection. Run discovery is also
served natively for `/api/workspaces/{workspace_id}/runs` when its query is
empty or contains only one `source=unified|manifests|parquet` and one
`refresh=true|false` value (in either order); duplicate or unknown query
parameters are not native-qualified and therefore refuse in the normal desktop
session. Workspace creation/selection/reload and the current-workspace document
are now native, as are the dataset catalogue (link/list/edit/unlink) and saved
pipeline CRUD. Their existing JSON documents survive upgrades; unlinking never
deletes dataset files. Newly linked datasets remain explicitly `unchecked` until
the library validates their contents. Editor branches, generators and tuning
fields are preserved without reducing them to the PLS execution profile.
Pruning, scientific parsing/import previews, and scientific surfaces not listed
above remain unavailable until migrated (or while the explicit R2 diagnostic
owner is selected).

The separate native researcher route `POST /api/training/native-archive-v2`
does not invoke CPython. It resolves one persisted IO dataset and one selected
dense source, executes the exact
`SNV(ddof=0) -> Savitzky-Golay(mode=interp) -> PLS` profile through
IO/DAG-ML/Methods/Core, writes Archive V2, and registers the artifact in the
workspace Store. It supports named multi-target regression within the bounded
native limits; fusion, N-D payloads, HPO, and fallback are not part of this
route.

> **Note**: The webapp can run **without nirs4all installed** for pure UI development. The backend will report missing capabilities but the frontend is fully functional.

---

## Screenshots

<div align="center">
<img src="https://nirs4all.org/assets/screenshots_studio/pipeline-page.png" width="900" alt="Pipeline Editor">
<br><em>Pipeline Editor — Drag-and-drop builder with component library, validation, and hyperparameter tuning</em>
</div>

<br>

<div align="center">
<img src="https://nirs4all.org/assets/screenshots_studio/results-page.png" width="440" alt="Results & Model Comparison">
<img src="https://nirs4all.org/assets/screenshots_studio/runs-page.png" width="440" alt="Runs Overview">
<br><em>Left: Results with model ranking and CV scores — Right: Runs overview and monitoring</em>
</div>

<br>

<div align="center">
<img src="https://nirs4all.org/assets/screenshots_studio/inspector-after-refresh.jpg" width="440" alt="Inspector">
<img src="https://nirs4all.org/assets/screenshots_studio/shap-page.png" width="440" alt="SHAP Analysis">
<br><em>Left: Inspector — prediction analysis and model diagnostics — Right: SHAP variable importance</em>
</div>

<br>

<div align="center">
<img src="https://nirs4all.org/assets/screenshots_studio/synthesis-page.png" width="440" alt="Spectra Synthesis">
<img src="https://nirs4all.org/assets/screenshots_studio/predictions-page.png" width="440" alt="Predictions">
<br><em>Left: Spectra Synthesis — realistic NIR data generation — Right: Predictions analysis</em>
</div>

---

## Features

- **Spectral Data Visualization** — Interactive charts for exploring NIRS spectra
- **Pipeline Builder** — Visual drag-and-drop pipeline construction
- **Experiment Wizard** — Guided experiment setup with preset templates
- **Prediction Engine** — Run trained models on new samples
- **SHAP Explainability** — Variable importance and model interpretation
- **Spectra Synthesis** — Generate realistic synthetic NIR data
- **Transfer Analysis** — Instrument transfer and domain adaptation tools
- **Workspace Management** — Organize datasets, pipelines, and results
- **Native Desktop Experience** — Runs as a standalone desktop app via Electron
- **Neural-network models** — PyTorch is installed on request, in the build that matches your machine (CPU, CUDA or Apple Metal)

---

## Tech Stack

### Frontend
- **React 19** with TypeScript (strict mode)
- **Vite** for fast development and optimized builds
- **Tailwind CSS** with custom scientific design system
- **shadcn/ui** component library
- **TanStack Query** for API state management
- **Framer Motion** for smooth animations

### Desktop Shell
- **Electron 40** for cross-platform desktop experience
- **Chromium** for consistent WebGL support across all platforms
- **IPC Bridge** for secure main/renderer communication

### Product Backend and Python Interop
- **Rust sidecar** for packaged HTTP/WS orchestration, jobs, scheduling, and storage
- **[nirs4all](https://github.com/GBeurier/nirs4all)** in a bounded CPython library/plugin host over stdio, running in the Python environment selected in Studio
- **[uv](https://github.com/astral-sh/uv)** shipped with the application to create that environment and install its packages
- **FastAPI/WebSocket Python source** retained only for web development and explicit whole-session diagnostics

---

## Project Structure

```
nirs4all_webapp/
├── src/                    # React frontend source
│   ├── components/         # UI components
│   │   ├── layout/         # App layout (sidebar, header)
│   │   ├── pipeline-editor/# Pipeline Editor (see Architecture)
│   │   └── ui/             # shadcn/ui components
│   ├── context/            # React context providers
│   ├── data/               # Data models and registries
│   │   └── nodes/          # Node registry system
│   ├── lib/                # Utilities and helpers
│   ├── api/                # API client
│   ├── types/              # TypeScript type definitions
│   │   └── electron.d.ts   # Electron IPC types
│   └── pages/              # Route components
├── electron/               # Electron main process
│   ├── main.ts             # Main entry point (window management)
│   ├── preload.ts          # Secure IPC bridge (contextBridge)
│   ├── native-sidecar-manager.ts # Rust sidecar lifecycle
│   ├── env-manager.ts      # The one Python environment: selection, checks, installs
│   ├── env/                # Detection, package inventory, uv, environment creation
│   └── logger.ts           # Persistent file logging
├── api/                    # Legacy web-dev/diagnostic FastAPI routes
│   ├── workspace.py        # Workspace management routes
│   ├── datasets.py         # Dataset operations
│   ├── pipelines.py        # Pipeline CRUD
│   ├── predictions.py      # Prediction storage
│   └── system.py           # Health, system info, and GPU detection
├── scripts/                # Build and utility scripts
│   ├── fetch-uv.cjs        # Stages the pinned uv release
│   ├── build-wheelhouse.cjs # Stages the wheels of the required packages
│   ├── build-offline-payload.cjs # Stages the offline installer payload
│   └── build-release.cjs   # Installer build on the matching host
├── build/                  # Build configuration
│   ├── constraints/        # Hash-pinned wheel locks per target
│   └── entitlements.mac.plist  # macOS code signing entitlements
├── docs/                   # Documentation
│   └── _internals/         # Developer guides
├── public/                 # Static assets
├── main.py                 # Legacy web-dev/diagnostic FastAPI entry
├── recommended-config.json # Package catalogue (required and recommended packages)
├── electron-builder.installer.yml  # Electron packaging config (installer)
├── electron-builder.offline.yml    # Electron packaging config (offline installer)
└── package.json            # Node dependencies
```

---

## Scripts

### Launcher (Cross-Platform)

Use the unified launcher for all modes:

| Windows | Linux/macOS | Description |
|---------|-------------|-------------|
| `scripts\launcher.cmd start web:dev` | `./scripts/launcher.sh start web:dev` | Start frontend + diagnostic FastAPI server for web development only |
| `scripts\launcher.cmd start desktop:dev` | `./scripts/launcher.sh start desktop:dev` | Start Electron desktop (dev) |
| `scripts\launcher.cmd stop` | `./scripts/launcher.sh stop` | Stop all servers |
| `scripts\launcher.cmd status` | `./scripts/launcher.sh status` | Show server status |

Direct scripts are also available: `npm run dev` for Vite,
`python -m uvicorn main:app --reload --port 8000` for the diagnostic-development
server only, and `npm run start:desktop` for the Rust-owned Electron product
session.

### npm Scripts - Development

| Command | Description |
|---------|-------------|
| `npm run doctor` | Check Node, npm, Python, lockfile, and requirement files |
| `npm run dev` | Start Vite dev server |
| `npm run dev:electron` | Start Electron with hot reload |
| `npm run start:desktop` | Alias for Electron development mode |
| `npm run lint:parallel` | Run ESLint, TypeScript, node registry, Ruff, and dependency checks |
| `npm run test:frontend` | Run Vitest tests |
| `npm run test:backend` | Run pytest backend tests |
| `npm run test:routes` | Check FastAPI route table uniqueness |
| `npm run test:parallel` | Run Vitest and pytest together |
| `npm run test:e2e` | Run Playwright web Chromium tests |

### npm Scripts - Local Builds

| Command | Description |
|---------|-------------|
| `npm run build` | Build frontend for production |
| `npm run build:electron` | Build Electron app |
| `npm run electron:preview` | Preview Electron production build |
| `npm run release` | Build an installer locally |
| `npm run release:clean` | Clean and rebuild an installer locally |

### Desktop Release Profiles

`npm run release` builds an installer on the current host only; it publishes
nothing. There are two profiles of the same application:

| Profile | Command | Contents beside the application |
|---------|---------|---------------------------------|
| Installer | `npm run release -- --platform linux` | Rust sidecar, native Methods library, `uv`, Studio's document adapters, and, on Windows and Linux, the wheels of the required packages (a macOS application embeds none and installs them from the package index) |
| Offline installer (Windows, Linux) | `npm run release -- --platform linux --offline` | The same, plus the pinned Python runtime archive and the wheels of the default package set and of PyTorch (CPU); artifact name ends in `-offline` |

Neither profile installs a Python runtime with the application: Studio
creates or selects the user's environment at first launch. The offline
installer carries the Python runtime as an archive that Studio extracts into
that environment. The wheels come from
hash-pinned locks under `build/constraints/`; after changing the required
packages, or a recommended package that is installed by default or kept in the
offline payload, in `recommended-config.json`,
regenerate them with `node scripts/python-wheel-lock.cjs` (needs `uv` and
network access). See [docs/PACKAGING.md](docs/PACKAGING.md#build-entry-points).

Installers are the only desktop product. Non-CPU flavors, `--platform all`
and cross-host installer builds are rejected.

### npm Scripts - Packaging

| Command | Description |
|---------|-------------|
| `npm run release -- --platform win` | Package for Windows |
| `npm run release -- --platform mac` | Package for macOS (Apple Silicon host) |
| `npm run release -- --platform linux` | Package for Linux |
| `npm run release -- --platform <host>` | Package on the matching Linux, Windows, or macOS host |
| `npm run release -- --platform <host> --offline` | Package the offline installer on the matching Windows or Linux host |

---

## Logging and Crash Reporting

### Persistent Logs

In desktop mode, all main process logs are written to rotating log files:

| OS | Log location |
|----|-------------|
| Windows | `%APPDATA%\nirs4all-webapp\logs\` |
| macOS | `~/Library/Application Support/nirs4all-webapp/logs/` |
| Linux | `~/.config/nirs4all-webapp/logs/` |

### Sentry Crash Reporting (optional)

Automatic crash reporting via [Sentry](https://sentry.io/) can be enabled by setting the `SENTRY_DSN` environment variable. This captures errors from the Electron main process and React frontend; the transitional diagnostic Python backend reports only when it is explicitly running.

```bash
# Set before launching the app
SENTRY_DSN=https://your-key@o123456.ingest.sentry.io/1234567

# For the React frontend (build-time), add to .env.production:
VITE_SENTRY_DSN=https://your-key@o123456.ingest.sentry.io/1234567
```

When `SENTRY_DSN` is not set, crash reporting is completely disabled with zero overhead. See [docs/ELECTRON.md](docs/ELECTRON.md#crash-reporting-sentry) for details.

---

## Documentation

| Document | Description |
|----------|-------------|
| [docs/ELECTRON.md](docs/ELECTRON.md) | Electron architecture, logging, and crash reporting |
| [docs/PACKAGING.md](docs/PACKAGING.md) | Build system, CI/CD, and release process |
| [docs/UPDATE_SYSTEM.md](docs/UPDATE_SYSTEM.md) | Application update check and Python package updates |
| [docs/sources/custom-nodes-guide.md](docs/sources/custom-nodes-guide.md) | Custom node development |

---

## License

This project is dual-licensed under `CECILL-2.1 OR AGPL-3.0-or-later`: see [LICENSES/CeCILL-2.1.txt](LICENSES/CeCILL-2.1.txt) and [LICENSES/AGPL-3.0-or-later.txt](LICENSES/AGPL-3.0-or-later.txt).
Third-party notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and the corresponding license texts are bundled in [LICENSES/](LICENSES).

---

## Acknowledgments

- [CIRAD](https://www.cirad.fr/) for supporting this research
- The [nirs4all](https://github.com/GBeurier/nirs4all) library for the NIRS analysis engine
- The open-source scientific Python and React communities

<div align="center">
<br>
<strong>Made for the spectroscopy community</strong>
</div>

Studio 0.15.1 was never published and is superseded by 0.15.2. Its immutable tag is retained for diagnosis. Studio 0.15.2 aligns the Rust scientific host contract with the public SDK 1.4.7, DAG-ML 0.3.41 and Core 0.4.5 runtime cohort.
