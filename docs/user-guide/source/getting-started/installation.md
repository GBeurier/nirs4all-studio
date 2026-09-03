# Installation

nirs4all Studio is a desktop product with an Electron interface and a
Rust-owned control-plane sidecar. A packaged build includes the exact runtime
declared by its release manifest: users do not install or start a Python HTTP
backend.

```{important}
The final R4 candidate is locally prepared but not published. Do not infer
platform availability from examples, source configuration, or old releases.
Only platforms and files listed in a signed release manifest and attached to
the matching release are available.
```

## Install a published desktop release

1. Open the [nirs4all Studio releases
   page](https://github.com/GBeurier/nirs4all-studio/releases/latest).
2. Verify that the release contains a signed manifest for your operating system
   and architecture.
3. Download the exact installer or portable archive named by that manifest and
   verify its checksum.
4. Follow the operating system's normal installation flow and launch Studio.

The package contains the Rust HTTP/WebSocket, job, scheduler, persistence, and
workspace owner. Its bounded, content-addressed CPython runtime is only a stdio
library/plugin host for explicitly supported scientific calls. It cannot own a
product port, discover a user Python environment, install packages at runtime,
or serve as a fallback.

If no signed artifact matches your platform, that platform is not available
for the release. Building configuration in the repository is not evidence of a
qualified downloadable artifact.

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

## GPU and optional Python libraries

Native Methods training, including the bounded PLS product path, is CPU-based.
An optional Python library/plugin capability may have different hardware and
dependency requirements, but it is usable only when the packaged capability
manifest and preflight report it as available. Studio never modifies the
embedded runtime to add a backend after installation.

## After installation

Once the application is installed, launch it and you will see the initial
screen.

```{figure} /_images/getting-started/gs-first-launch.png
:alt: nirs4all Studio first launch screen
:width: 80%

The nirs4all Studio welcome screen on first launch.
```

Head to {doc}`first-launch` to create your first workspace.
