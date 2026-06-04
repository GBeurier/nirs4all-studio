# Diagnostics

nirs4all Studio has opt-in diagnostics for the renderer, Electron main process,
and FastAPI backend. No diagnostics should be sent unless the user enabled debug
data sharing and a Sentry DSN is configured.

## Surfaces

| Surface | Module |
| --- | --- |
| Renderer | `src/lib/diagnostics.ts` |
| Electron main | `electron/telemetry.ts` |
| Backend | `api/telemetry.py` |

## Consent model

Debug data sharing is disabled by default. Consent can be stored in:

- renderer local storage for renderer initialization
- app settings under `ui_preferences.debug_data_sharing_enabled`
- installer marker file `installer_debug_data_sharing_consent`

When consent changes in the UI, the renderer forwards the new value to Electron
and the backend path applies it from app settings.

## Environment variables

Renderer:

```text
VITE_SENTRY_DSN
VITE_NIRS4ALL_SENTRY_DSN
VITE_SENTRY_RELEASE
VITE_APP_VERSION
VITE_SENTRY_ENVIRONMENT
VITE_SENTRY_TRACES_SAMPLE_RATE
VITE_SENTRY_PROFILES_SAMPLE_RATE
VITE_SENTRY_MAX_EVENTS_PER_SESSION
```

Backend and Electron main:

```text
NIRS4ALL_SENTRY_DSN
SENTRY_DSN
SENTRY_RELEASE
SENTRY_ENVIRONMENT
NIRS4ALL_ENV
SENTRY_TRACES_SAMPLE_RATE
SENTRY_PROFILES_SAMPLE_RATE
SENTRY_MAX_EVENTS_PER_SESSION
```

## Scrubbing rules

Diagnostics code removes or filters:

- user objects
- request cookies
- request bodies
- query strings
- authorization headers
- cookie headers
- token-like headers
- key-like headers

Renderer breadcrumbs ignore normal console, click, and successful fetch noise.
Backend and Electron filters drop expected local environment and user-actionable
errors that would otherwise pollute diagnostics.

## Event limits

Each surface caps accepted events per session. The default cap is `20`. Set the
surface-specific max events environment variable to tune this during controlled
debug sessions.

## Development guidance

When adding diagnostics:

- keep context structured with tags and small extras
- prefer stable IDs over full payloads
- avoid raw dataset values, spectra arrays, credentials, and request bodies
- mark the surface with a tag
- filter expected user errors before sending
- add tests for consent and scrubbing behavior when changing filters

## Tests

Relevant backend tests include diagnostics and telemetry filter coverage under
`tests/`. Run:

```bash
pytest tests/test_telemetry_filters.py
pytest tests/test_app_config_diagnostics.py
```
