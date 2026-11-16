# Environment Architecture

Internal reference for how nirs4all Studio finds, prepares and uses Python.
The renderer/main contract is `src/types/pythonEnvironment.ts`; the working
specification is
[python-environment-redesign-2026-11-16.md](python-environment-redesign-2026-11-16.md).

## Core Model

Studio uses exactly one Python environment: the interpreter the user selected,
or the one Studio created for them. The selection is one persisted value:

```text
<userData>/env-settings.json   { "pythonPath": "..." }
```

Installers ship no Python. They ship the tools Studio needs to create and
maintain that environment: `uv`, the wheels of the required packages and the
document adapters (see [PACKAGING.md](../PACKAGING.md)).

The state of the environment is derived from a package listing (distribution
metadata). Studio never imports a package to decide whether an environment is
usable.

## Package Catalogue

`recommended-config.json` is the single source of package names, ranges and
versions for the Electron main process, the build scripts and the Rust sidecar.

| Block | Entry shape | Meaning |
|---|---|---|
| `required` | `{ name, range, install }` | Packages Studio cannot run without: `nirs4all`, `nirs4all-core`, `dag-ml`, `dag-ml-data`, `nirs4all-io`, `nirs4all-methods`, `nirs4all-formats`. `range` is the accepted version specifier (may be empty); `install` is the exact version Studio installs. |
| `optional` | `min`, `recommended`, `category`, `description`, `default_install`, optional `python` | The recommended catalogue. Each package is a per-package choice; `default_install` preselects it when Studio creates an environment. |

Two rules follow from the `required` shape:

- **Admission is a range.** An environment is usable when every required
  package is installed within its `range`.
- **Installation is exact.** When Studio installs or repairs the required
  packages, it installs every one of them at its `install` version in a single
  resolver call, so the cohort stays mutually coherent.

`recommended-config.json` also carries a `profiles` block. Only the
transitional FastAPI tooling under `api/` reads it; the product does not.

## Main Components

### Electron main process

`electron/env-manager.ts` (`EnvManager`) coordinates the environment. The
mechanics live in `electron/env/`:

| Module | Responsibility |
|---|---|
| `env-settings.ts` | Read and atomically write `env-settings.json`; the last valid file is kept as `env-settings.json.bak`. |
| `catalogue.ts` | Required and recommended package specifications from `recommended-config.json`. |
| `python-discovery.ts` | Candidate interpreters: `PATH`, common home virtual environments, conda, pyenv, the Windows `py` launcher and nearby project directories. |
| `env-detection.ts` | One inventory per candidate (four at a time), sorted and de-duplicated by environment root, cached in memory for 30 seconds. |
| `inventory.ts` | One subprocess per interpreter (`python -I -B -c <probe>`) that lists distributions, editable installs, the PEP 668 marker and whether the package directory is writable; `evaluateInventory` turns the listing into a `PythonEnvReport`. |
| `inventory-cache.ts` | `<userData>/python-inventory.json`: the inventory of the selected environment, keyed by interpreter, required catalogue and environment fingerprint, so an ordinary launch spawns no Python. |
| `uv.ts` | Locates `uv` and the shipped wheels; runs `uv venv` and `uv pip install`. |
| `provisioning.ts` | Creates a Studio environment. |
| `python-runtime-installer.ts` | Downloads, extracts and un-quarantines the python-build-standalone archive. |
| `runtime-paths.ts` | Layout of a Studio environment and classification of an environment root (`studio`, `conda`, `venv`, `system`). |
| `studio-adapters.ts` | Location of the `studio_document_adapters` package. |
| `scientific-host.ts` | Confirms through the sidecar that the scientific host runs the selected interpreter; counts active runs. |
| `install-log.ts` | Bounded, redacted install log shared by every environment operation. |

### uv

`uv` is the only tool Studio uses to create environments and install packages.
It is resolved from `NIRS4ALL_UV`, then `resources/backend/tools/uv[.exe]`,
then `backend-dist/tools/`, then `PATH` (development). Every call names the
target interpreter with `--python`, sets `UV_LINK_MODE=copy` and
`UV_NATIVE_TLS=1` (system certificate store), and streams its output to the
install log.

`resources/backend/wheels/` is passed as `--find-links`. When the installation
carries the offline payload (`resources/backend/offline/`), its `wheels/`
directory is a second `--find-links` source and installs are first attempted
with `--offline --no-index`; what the shipped wheels cannot satisfy is then
requested from the package index. `torch` is installed with
`--torch-backend auto` when it comes from the package index; offline wheels
are used as shipped.

### Rust sidecar

The sidecar runs the scientific host. It receives the selection through four
variables set by Electron, and nothing else about the environment:

| Variable | Value |
|---|---|
| `NIRS4ALL_PYTHON_PLUGIN_HOST` | Selected interpreter, exactly as selected. |
| `NIRS4ALL_PYTHON_PLUGIN_SITE_PACKAGES` | Package directory of that environment (`purelib` from the inventory). |
| `NIRS4ALL_STUDIO_ADAPTERS_DIR` | Directory that contains `studio_document_adapters/`. |
| `NIRS4ALL_SCIENTIFIC_EXECUTOR` | `cpython-stdio-v1`. |

Electron removes inherited values of these variables before it starts the
sidecar. When no usable environment is selected, the sidecar starts without a
Python host: the product stays available and the scientific capabilities report
as unavailable. Host admission by the sidecar is described in
[sidecar/README.md](../../sidecar/README.md#python-environment-hand-off).

The document adapters ship with the application
(`resources/backend/adapters/studio_document_adapters/`). They are never copied
into the user's environment. In development, Electron materialises them once
per process into `<userData>/studio-adapters/`.

### Renderer

One page component (`src/components/python-env/PythonEnvironmentPage.tsx`)
serves the `/setup` route and the `Python` tab of Settings. It talks to the
main process only through `PythonEnvApi` (`window.electronApi.pythonEnv`).
Outside Electron (browser, Docker) the tab is a read-only summary built from
`/api/system/info`.

## Phases

`PythonEnvState.phase` is one of:

| Phase | Meaning |
|---|---|
| `unconfigured` | No environment is selected, or the selected interpreter file no longer exists (`problem.code` is then `interpreter_missing`). The setup page is shown. |
| `ready` | The selected environment satisfies every required package. |
| `busy` | A creation, installation, required update or switch is running; `activity` describes it. |
| `needs_attention` | The selected environment exists but cannot be used; `problem` says why. |

Problem codes:

| Code | Cause |
|---|---|
| `interpreter_missing` | The selected interpreter file no longer exists. |
| `interpreter_unusable` | The interpreter could not be inspected, or is older than Python 3.11. |
| `required_not_installable` | A required package is missing or out of range and Studio may not install it: the environment is read-only or externally managed, or a required package is an editable install. |
| `required_update_failed` | The automatic installation of the required packages failed. |
| `host_failed` | Packages are in range but the scientific host did not start on this interpreter. |

## Lifecycle

### First launch

1. The phase is `unconfigured`; the sidecar starts without a Python host and
   the renderer opens `/setup`.
2. The page lists detected environments with what each lacks, and describes
   the environment Studio would create (`describeNewEnvironment`, no
   subprocess).
3. The user either selects an environment (`apply`) or creates one (`create`).
   The user may also continue without Python for the session; a banner then
   links back to the setup page.

### Create

`create` builds a Studio environment under `<userData>/python-env/` (or
`<directory>/python-env/` when the user chooses a folder):

1. Obtain the pinned python-build-standalone archive
   (`scripts/python-runtime-config.cjs`): from the offline payload when
   present, otherwise by download.
2. Extract it to `python-env/python`.
3. `uv venv python-env/venv` on that interpreter.
4. Install the required packages, then the recommended packages the user
   chose.

An existing `venv` directory is never overwritten. A failed creation removes
what it created so that it can be retried.

### Select an existing environment

`apply` inspects the interpreter, installs the required packages when they are
missing or out of range, installs the chosen recommended packages, then
switches. Recommended packages are installed together with pins of the required
packages already present, so a conflicting recommended package fails the
resolution instead of changing `nirs4all` or its owners.

### Switch

A switch persists the new `pythonPath`, restarts the sidecar on it, waits for
`/api/system/readiness` to report `ml_ready`, and confirms that
`/api/system/env-coherence` reports the selected interpreter. On failure the
previous selection is persisted again and restarted.

Environment operations run one at a time and end by restarting the sidecar.
Except for an explicit backend restart, they are refused while a run is queued
or running.

### Later launches

1. Read `env-settings.json` and take the inventory of the selection (from
   `python-inventory.json` when the environment has not changed).
2. If a required package is missing or out of range, and the environment is
   writable and has no editable required package, install the required set
   (activity `updating_required`; the splash shows one progress line).
3. Start the sidecar on the selection, create the window, and confirm the host
   in the background.

A failure never blocks startup: Studio opens with the phase `needs_attention`
and a banner that offers Retry.

### Application update

An application update replaces the application files only. The environment
under `<userData>/python-env/` (or the user's own environment) and
`env-settings.json` are untouched. If the new version raises a required range,
the required packages are updated at the next launch through the step above.

An installation whose `env-settings.json` holds no `pythonPath`, as left by a
release that used an included runtime, starts `unconfigured`: the user chooses
or creates an environment once.

## Package Rules

- Required packages are installed and updated automatically. Their rows are
  locked on the page.
- Recommended packages are installed only on request, one checkbox per
  package. A recommended package below its `recommended` version has status
  `older`: Studio shows one warning toast per session and an indicator dot on
  the Settings sidebar entry and on the `Python` tab.
- Editable installs are never modified. An editable required package within
  range is `ok`. Any editable required package prevents Studio from installing
  the required set in that environment.
- Studio does not install into an externally managed (PEP 668) or read-only
  environment.

## Deployment Matrix

| Deployment | Environment | Managed by |
|---|---|---|
| Desktop installer | Selected or created by the user | Electron (`PythonEnvApi`) |
| Desktop offline installer | Same; creation and required installs work without network | Electron (`PythonEnvApi`) |
| Docker image | `/opt/nirs4all/python-env/{python,venv}`, built at image build time by `scripts/provision-environment.cjs` | The image |
| Browser development (`npm run dev`) | None owned by the renderer | The server it is pointed at |
