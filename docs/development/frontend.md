# Frontend

The frontend is a React 19 application built with Vite and TypeScript. It uses
TanStack Query for server state, React Context for app state, Tailwind for
styling, shadcn/ui and Radix primitives for UI components, and i18next for
localization.

## Routing

Routes are defined in `src/App.tsx`.

| Route | Page |
| --- | --- |
| `/` | Dashboard |
| `/datasets` | Datasets |
| `/datasets/:id` | Dataset detail |
| `/playground` | Playground |
| `/pipelines` | Pipeline library |
| `/pipelines/new` | New pipeline editor |
| `/pipelines/:id` | Existing pipeline editor |
| `/runs` | Runs |
| `/runs/new` | New experiment |
| `/runs/:id` | Run progress |
| `/results` | Results |
| `/results/aggregated` | Aggregated results |
| `/predictions` | Predictions |
| `/analysis` | Analysis |
| `/analysis/transfer` | Transfer analysis |
| `/analysis/importance` | Variable importance |
| `/synthesis` | Spectra synthesis |
| `/settings` | Settings |

## Provider stack

`src/main.tsx` wraps the app with:

- `QueryClientProvider`
- `BrowserRouter` or `HashRouter`
- `ThemeProvider`
- `LanguageProvider`
- `UISettingsProvider`
- `DiagnosticsConsentProvider`
- `DeveloperModeProvider`
- `ActiveRunProvider`
- Sentry error boundary
- toast provider

Electron mode uses `HashRouter`. Web mode uses `BrowserRouter`.

## API access

Use `src/api/client.ts` for backend calls. The client handles:

- relative `/api` URLs in web mode
- dynamic backend URLs in Electron mode
- JSON serialization
- consistent `ApiRequestError` errors
- diagnostics breadcrumbs when opt-in diagnostics are enabled

Avoid one-off fetch wrappers in feature code.

## UI conventions

- Prefer existing shadcn/ui components.
- Keep feature state close to feature components unless it is shared.
- Use TanStack Query for server data and cache invalidation.
- Use context for cross-cutting UI state only.
- Keep i18n keys in `src/locales/<lang>/index.ts`.
- Preserve the app's dense, work-focused layout. This is an operational
  scientific tool, not a marketing site.

## Pipeline editor

The pipeline editor is driven by node definitions, validation rules, and shared
parameter controls. When adding operator UI, first check whether a node
definition or renderer already covers the case.

Important directories:

| Path | Purpose |
| --- | --- |
| `src/components/pipeline-editor/` | Editor UI and domain components. |
| `src/components/pipeline-editor/validation/` | Validation engine and UI. |
| `src/data/nodes/` | Node definitions, schema, registry, custom nodes. |
| `public/node-registry/extended.json` | Generated extended operator catalog. |

## Local frontend commands

```bash
npm run dev
npm run lint
npm run validate:nodes
npm run test
npm run storybook
```
