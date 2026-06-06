# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the React/TypeScript app: `pages/`, `components/`, `hooks/`, `context/`, `lib/`, `data/nodes/`, `locales/`, and `assets/`. `api/`, `websocket/`, and `main.py` provide the FastAPI backend. `electron/` contains the desktop shell, `public/` stores static assets and node-registry data, and `scripts/` holds build helpers. Backend tests live in `tests/`; frontend unit tests live beside source as `*.test.ts(x)` or under `__tests__/`; Playwright specs are in `e2e/tests/`. Treat `dist/`, `backend-dist/`, `storybook-static/`, `test-results/`, and `playwright-report/` as generated output.

## Build, Test, and Development Commands

Use Node 24 from `.nvmrc` when possible; `package.json` requires Node >=20 and npm >=10. Install JavaScript dependencies with `npm install`. For Python, create `.venv` and install `pip install -r requirements-cpu.txt` or the GPU requirements file.

- `npm run dev`: start the Vite frontend.
- `python main.py --no-reload`: start the FastAPI backend.
- `npm run start:desktop`: launch Electron desktop mode.
- `npm run build` / `npm run build:electron`: create web or Electron frontend builds.
- `npm run lint:parallel`: run ESLint, TypeScript, node-registry validation, Ruff, and Python syntax checks.
- `npm run test:parallel`: run Vitest and pytest together.
- `npm run test:e2e`: run Playwright web Chromium tests.

## Coding Style & Naming Conventions

Use TypeScript strict mode, React functional components, and the `@/` alias for imports from `src/`. Keep TypeScript/TSX indentation at two spaces; use PascalCase for components and contexts, `use*` for hooks, and camelCase for utilities. Prefer existing shadcn/ui, Radix, TanStack Query, and local helpers before adding patterns. Python targets 3.11+, follows PEP 8 with Google-style docstrings, and is checked by Ruff (`line-length = 220`).

## Testing Guidelines

Add focused tests with behavior changes. Use Vitest for frontend files matching `src/**/*.test.{ts,tsx}` and pytest for backend files named `test_*.py`. Mark slow or integration-heavy pytest cases with the existing markers in `pytest.ini`. Keep Playwright tests deterministic; the config runs serially because backend state is shared.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit style, for example `fix(packaging): ...`, `fix(datasets): ...`, `feat: ...`, and `chore: release ...`. Keep subjects imperative and scoped when useful. PRs should include a summary, change list, testing checklist, linked issues when applicable, and screenshots for visible UI changes.

## Architecture & Configuration Notes

The backend is a thin orchestration layer for HTTP routes, jobs, WebSockets, workspace state, and UI-facing adapters. Do not reimplement scientific computation that belongs in the `nirs4all` Python library. Do not commit secrets, workspace data, or generated artifacts.
