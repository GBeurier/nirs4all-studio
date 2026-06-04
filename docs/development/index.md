# Developer overview

This section is the maintainer manual for nirs4all Studio. It explains how the
application is put together, which layer owns which responsibility, and which
commands and contracts matter when changing the code.

## Start here

Read in this order when onboarding:

1. [Development Setup](../getting-started/development.md) for local commands and
   environment assumptions.
2. [Architecture](architecture.md) for the runtime model and data flow.
3. [Repository Map](repository-map.md) for where code lives.
4. [Backend](backend.md) and [Frontend](frontend.md) for layer conventions.
5. [Pipeline Editor](pipeline-editor.md) if you touch operators, validation, or
   run configuration.
6. [Jobs and WebSockets](jobs-websockets.md) if you touch long-running work.
7. [Testing](testing.md) before opening a pull request.

## Non-negotiable boundary

The backend does not reimplement nirs4all scientific logic. The Studio
repository owns orchestration and UI. The `nirs4all` library owns NIRS parsing,
preprocessing, models, predictions, SHAP, synthetic generation, and library
workspace storage.

When a route needs scientific behavior:

- call the library
- add a thin adapter if the UI shape differs from the library shape
- handle missing library imports explicitly
- keep JSON response formatting in Studio
- keep domain computation in nirs4all

## Main development loops

| Task | Primary loop |
| --- | --- |
| UI work | `npm run dev`, then targeted Vitest or Storybook checks. |
| Backend route work | `npm run dev:api`, then targeted `pytest`. |
| Full web workflow | `npm run start:web`. |
| Desktop workflow | `npm run start:desktop` or `npm run dev:electron`. |
| Pipeline editor nodes | edit `src/data/nodes`, run `npm run validate:nodes`. |
| Release packaging | build frontend, backend, Electron, then package. |
| RTD docs | edit `docs/`, run `mkdocs build`. |

## Pull request checklist

Before merging a meaningful change:

- the affected runtime starts locally
- changed node definitions pass `npm run validate:nodes`
- affected frontend tests pass
- affected backend tests pass
- the production build still passes when shared contracts changed
- docs are updated when user-visible behavior, commands, routes, or packaging
  flow changed

## Common change paths

| Change | Read |
| --- | --- |
| Add a backend endpoint | [Backend](backend.md), [API Overview](../reference/api.md) |
| Add a frontend screen | [Frontend](frontend.md), [Architecture](architecture.md) |
| Add a pipeline operator | [Pipeline Editor](pipeline-editor.md), [Custom Nodes](custom-nodes.md) |
| Add a long-running action | [Jobs and WebSockets](jobs-websockets.md), [Backend](backend.md) |
| Change native desktop behavior | [Electron Desktop](electron.md) |
| Change diagnostics | [Diagnostics](diagnostics.md), [Configuration](../reference/configuration.md) |
| Prepare a release | [Packaging and Releases](releasing.md), [Testing](testing.md) |
| Change RTD docs | [Docs Site](docs-site.md) |
