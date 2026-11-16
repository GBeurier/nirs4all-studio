# Installation

nirs4all Studio is a desktop application. It is distributed as installers,
attached to each release.

## Install Studio

1. Open the [nirs4all Studio releases
   page](https://github.com/GBeurier/nirs4all-studio/releases/latest).
2. Download the installer for your platform.
3. Run it and launch Studio.

| Platform | Installer | Offline installer |
|----------|-----------|-------------------|
| Windows x64 | `nirs4all.Studio-<version>-win-x64.exe` | `nirs4all.Studio-<version>-win-x64-offline.exe` |
| macOS (Apple Silicon) | `nirs4all.Studio-<version>-mac-arm64.dmg` | none |
| Linux x64 | `nirs4all.Studio-<version>-linux-amd64.deb` | `nirs4all.Studio-<version>-linux-amd64-offline.deb` |

The installer contains no Python, and you do not need Python on your machine.

On Windows and Linux, the **offline installer** (file name ending in
`-offline`) is for machines without network access: it also carries the
Python runtime and the packages Studio installs by default, so nothing is
downloaded at first launch.

```{note}
macOS is supported on Apple Silicon only and needs an internet connection at
first launch. The application is not signed: when macOS blocks its first
opening, open **System Settings > Privacy & Security** and choose **Open
Anyway**.
```

## First launch: the Python environment

Studio runs its analyses in one Python environment. On first launch it lists
the Python environments found on your machine; pick one, or let Studio create
one for you. Studio then installs `nirs4all` and its companion packages
automatically and keeps them up to date at each launch.

Other packages are optional and installed on request. PyTorch is one of them:
Studio offers to install it when you select a neural-network model, in the
build that matches your machine (CPU, CUDA or Apple Metal). With the offline
installer it is installed from the installer's own files, as the CPU build.

You can switch environment or add packages at any time in **Settings >
Python**.

## Update Studio

**Settings > Updates** shows the installed version and checks for a newer
release. To update, download the installer of the newer version from there,
close Studio and run it. An update replaces the application only: your Python
environment, workspaces and settings stay in place.

## Develop from source

This route is for contributors, not an alternative end-user installation:

```bash
git clone https://github.com/GBeurier/nirs4all-studio.git
cd nirs4all-studio
npm install
npm run dev:electron
```

The product-shaped desktop development command starts Electron and the Rust
sidecar. Some repository diagnostics retain a Python/FastAPI source server to
compare historical contracts; those diagnostics are opt-in contributor tools
and are not the current product backend. Follow the root `README.md` and
`docs/PACKAGING.md` for their explicit scope.

The separate [nirs4all Web application](https://web.nirs4all.org/) is a
client-side browser/WASM product. It does not turn Studio's historical Python
server into a deployment mode.

## After installation

Once the Python environment is ready, Studio shows its welcome screen.

```{figure} /_images/getting-started/gs-first-launch.png
:alt: nirs4all Studio first launch screen
:width: 80%

The nirs4all Studio welcome screen on first launch.
```

Head to {doc}`first-launch` to create your first workspace.
