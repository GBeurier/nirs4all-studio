# Testing

Use focused tests while developing and broader tests before merging changes that
touch shared contracts.

## Frontend unit tests

```bash
npm run test
npm run test:watch
```

Run a single Vitest file:

```bash
npx vitest run src/data/nodes/NodeRegistry.test.ts
```

## Backend tests

```bash
pytest
pytest -m "not slow"
pytest tests/test_workspace_manager_startup.py
```

Backend tests use `pytest.ini`; async tests use `asyncio_mode=auto`.

## Validation checks

Node definitions gate the production build:

```bash
npm run validate:nodes
```

Registry snapshot checks detect unintended generated registry drift:

```bash
npm run registry:snapshot
```

Update the snapshot only when the registry change is intended:

```bash
npm run registry:snapshot:update
```

## End-to-end tests

```bash
npm run e2e:web
npm run e2e:desktop
npm run e2e:headed
npm run e2e:debug
```

Use the web project for browser flows and the desktop project for Electron or
FastAPI-served production flows.

## Storybook

```bash
npm run storybook
npm run build-storybook
```

Storybook is for component behavior and visual inspection. It does not replace
workflow tests.

## Release verification

Before release work, run:

```bash
npm run lint
npm run validate:nodes
npm run test
pytest
npm run build
npm run build:backend:cpu
npm run electron:preview
```

Add GPU and platform-specific checks when a release touches backend packaging,
native dependencies, or Electron resources.
