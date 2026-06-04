# Packaging and releases

nirs4all Studio packages a React frontend, an Electron shell, and a PyInstaller
Python backend into desktop installers.

## Build outputs

| Output | Location |
| --- | --- |
| React build | `dist/` |
| Electron main/preload build | `dist-electron/` |
| PyInstaller backend | `backend-dist/` |
| Desktop installers | `release/` |

## Build flavors

| Flavor | Purpose |
| --- | --- |
| CPU | Smaller, most compatible build without bundled GPU ML stacks. |
| GPU | CUDA-oriented Linux and Windows builds. |
| GPU Metal | macOS-oriented GPU build path. |

Commands:

```bash
npm run build:backend:cpu
npm run build:backend:gpu
npm run build:backend:gpu-metal
```

Full release builds:

```bash
npm run build:release:cpu
npm run build:release:gpu
npm run build:release:all
```

Clean build:

```bash
npm run build:release:clean
```

## Electron packaging

`electron-builder.yml` currently declares:

| Platform | Targets |
| --- | --- |
| Windows x64 | NSIS installer, portable package |
| macOS x64 and arm64 | DMG, ZIP |
| Linux x64 | AppImage, DEB |

The Python backend is included through `extraResources` from `backend-dist/` to
the packaged `resources/backend/` directory.

## Local release checklist

1. Confirm version numbers in `package.json` and `version.json`.
2. Install dependencies with `npm install` and Python requirements.
3. Run validation and tests.
4. Build the frontend.
5. Build the backend flavor.
6. Package Electron.
7. Start the packaged application.
8. Confirm backend health, dataset linking, a small run, and shutdown.

Commands:

```bash
npm run lint
npm run validate:nodes
npm run test
pytest
npm run build
npm run build:backend:cpu
npm run electron:build
```

## Release artifacts

Artifact names come from `electron-builder.yml` and include product name,
version, platform, architecture, and extension. If GPU suffixes are needed, keep
the naming logic consistent with the update manager's asset detection.

## Update system

The update system covers:

- webapp release checks against GitHub releases
- nirs4all package checks against PyPI
- dependency and virtual environment management
- staged webapp update downloads and cleanup routes

Updates are user initiated. The app checks for update availability but does not
apply updates silently.

## Code signing

Windows signing can be configured through electron-builder certificate
environment variables. macOS signing and notarization require Apple developer
credentials and hardened runtime settings.

Do not publish unsigned production installers to a user-facing release channel
unless that is an explicit project decision.
