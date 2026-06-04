# Development setup

This repository is a single application with three runtimes:

- React, Vite, and TypeScript for the renderer
- FastAPI and Python for the backend
- Electron for the packaged desktop shell

The backend is a thin orchestration layer over the `nirs4all` Python library.
Do not reimplement NIRS, parsing, preprocessing, modeling, prediction, SHAP,
synthetic generation, or workspace storage logic in `api/`.

## Day-to-day commands

| Command | Purpose |
| --- | --- |
| `npm run start:web` | Start Vite and FastAPI together in web development mode. |
| `npm run start:desktop` | Start Electron development mode. |
| `npm run dev` | Start Vite only. |
| `npm run dev:api` | Start FastAPI only with `python main.py`. |
| `npm run dev:electron` | Build Electron main/preload and launch desktop mode. |
| `npm run status` | Show launcher-managed process status. |
| `npm run stop` | Stop launcher-managed processes. |
| `npm run clean` | Clean launcher state and logs. |

## Quality gates

Run the smallest useful check before committing. Use the broader checks when
you touch shared behavior or release paths.

```bash
npm run lint
npm run validate:nodes
npm run test
pytest
```

Build checks:

```bash
npm run build
npm run build:backend:cpu
npm run electron:preview
```

End-to-end checks:

```bash
npm run e2e:web
npm run e2e:desktop
```

Storybook:

```bash
npm run storybook
```

## Repository map

| Path | Role |
| --- | --- |
| `src/` | React application, pages, hooks, API client, UI components, i18n. |
| `src/data/nodes/` | Pipeline editor node registry and validation schema. |
| `api/` | FastAPI routers, request models, adapters, job orchestration. |
| `electron/` | Main process, preload bridge, backend lifecycle manager. |
| `scripts/` | Launch, build, validation, and release helpers. |
| `public/` | Static assets and extended node registry. |
| `docs/` | Read the Docs source. |
| `tests/` | Python backend tests. |
| `e2e/` | Playwright tests. |

## Local nirs4all dependency

For development against a sibling checkout:

```bash
source .venv/bin/activate
pip install -e ../nirs4all
```

The app intentionally guards imports of `nirs4all` so frontend work can continue
without the library installed. Backend features that call the library should
fail with explicit "library unavailable" errors rather than import-time crashes.

## Node registry workflow

The visual pipeline editor is fed by two registries:

- static definitions under `src/data/nodes/definitions/`
- generated extended definitions in `public/node-registry/extended.json`

After changing node definitions, run:

```bash
npm run validate:nodes
npm run registry:snapshot
```

Regenerate the extended registry when operator discovery changes:

```bash
npm run generate:extended-registry
npm run registry:snapshot:update
```

## Environment assumptions

The web development mode relies on Vite proxy rules:

- `/api` goes to `http://127.0.0.1:8000`
- `/ws` goes to `ws://127.0.0.1:8000`

Electron mode does not use that proxy. The renderer asks the Electron preload
bridge for the dynamic backend URL.
