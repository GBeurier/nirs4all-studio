# Configuration

Configuration is split between app settings, workspace state, runtime
environment variables, and build-time environment variables.

## App config folder

Default location:

- Linux and macOS: `~/.nirs4all/`
- Windows: `%APPDATA%\nirs4all\`

Files include:

| File | Purpose |
| --- | --- |
| `app_settings.json` | UI preferences, linked workspaces, active workspace, favorites. |
| `dataset_links.json` | Global dataset registry and dataset groups. |
| `config_redirect.txt` | Optional redirect to a custom config folder. |
| `installer_debug_data_sharing_consent` | Installer-created consent marker for diagnostics. |

Resolution order:

1. `NIRS4ALL_CONFIG`
2. portable `.nirs4all` next to the executable
3. redirect file in the default config folder
4. default platform-specific config folder

## Workspace data

The user-selected nirs4all workspace contains library-owned data such as:

- `workspace.json`
- `store.sqlite`
- `runs/`
- `arrays/`
- `artifacts/`
- `exports/`
- `library/templates/`

Studio should treat these as library data and use nirs4all APIs or adapters
instead of inventing parallel storage formats.

## Runtime environment variables

| Variable | Purpose |
| --- | --- |
| `NIRS4ALL_CONFIG` | Override the app config folder. |
| `NIRS4ALL_PORT` | Backend port used by `main.py`. Defaults to `8000`. |
| `NIRS4ALL_DESKTOP` | Set to `true` in Electron mode. Disables backend reload behavior. |
| `NIRS4ALL_ELECTRON` | Marks backend execution launched by Electron. |
| `NIRS4ALL_WORKSPACE` | Fallback active workspace path when the library cannot be initialized. |
| `NIRS4ALL_USE_VENV` | Force Electron backend startup to use the local venv fallback. |
| `NIRS4ALL_ENV` | Diagnostics environment label fallback. |

## Diagnostics environment variables

Diagnostics are opt-in. Events are sent only when a DSN is configured and the
user has enabled debug data sharing.

Backend and Electron main process:

| Variable | Purpose |
| --- | --- |
| `NIRS4ALL_SENTRY_DSN` or `SENTRY_DSN` | Sentry DSN. |
| `SENTRY_RELEASE` | Release identifier. |
| `SENTRY_ENVIRONMENT` | Environment label. |
| `SENTRY_TRACES_SAMPLE_RATE` | Tracing sample rate from `0` to `1`. |
| `SENTRY_PROFILES_SAMPLE_RATE` | Profiling sample rate from `0` to `1`. |
| `SENTRY_MAX_EVENTS_PER_SESSION` | Event cap per session. Defaults to `20`. |

Renderer:

| Variable | Purpose |
| --- | --- |
| `VITE_SENTRY_DSN` or `VITE_NIRS4ALL_SENTRY_DSN` | Renderer Sentry DSN. |
| `VITE_SENTRY_RELEASE` | Renderer release identifier. |
| `VITE_APP_VERSION` | Fallback application version for release naming. |
| `VITE_SENTRY_ENVIRONMENT` | Renderer environment label. |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | Renderer tracing sample rate. |
| `VITE_SENTRY_PROFILES_SAMPLE_RATE` | Renderer profiling sample rate. |
| `VITE_SENTRY_MAX_EVENTS_PER_SESSION` | Renderer event cap per session. |

Diagnostics scrub request URLs, headers, cookies, user data, request bodies, and
query strings before events leave the machine.

## Managed Python environment

The update/dependency manager defaults to the current Python environment
(`sys.prefix`). A custom virtual environment can be configured from Settings or
through the updates API. Custom venv settings are stored in the platform user
data directory for `nirs4all-studio`.

## Build-time configuration

| File | Purpose |
| --- | --- |
| `vite.config.ts` | Vite server, proxy, aliases, Electron build plugins, Sentry source map upload. |
| `electron-builder.yml` | Desktop packaging targets and bundled resources. |
| `backend.spec` | PyInstaller backend bundle. |
| `requirements-cpu.txt` | CPU backend dependency set. |
| `requirements-gpu.txt` | CUDA backend dependency set. |
| `requirements-gpu-macos.txt` | macOS GPU/Metal dependency set. |
