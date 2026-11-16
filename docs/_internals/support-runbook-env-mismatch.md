# Support Runbook: Python Environment

Internal support guide for "analyses, training or predictions are unavailable"
and "the Python environment needs attention" reports on the desktop
application. Model and vocabulary:
[environment-architecture.md](environment-architecture.md).

## Triage Questions

1. **Which installer?** Standard, or offline (`-offline` in the file name).
2. **What does Settings > Python show?** The selected environment, its phase
   and the problem message.
3. **Which kind of environment is selected?** Created by Studio, a virtual
   environment, conda, or a system Python.
4. **Did anything change the environment outside Studio?** A terminal
   `pip`/`uv`/`conda` command, a moved or deleted folder, an operating-system
   Python upgrade.
5. **What OS?** Windows / macOS / Linux.

## Diagnostic Steps

### Step 1: Read the state

The selected interpreter is stored in `<userData>/env-settings.json`:

```json
{ "pythonPath": "..." }
```

The main-process log records every state change on one line:

```text
[EnvManager] Python environment: phase=<phase> | path=<interpreter> | <required package versions> | <problem code>: <message>
```

`phase` is `unconfigured`, `ready` or `needs_attention` (`busy` is shown in
the interface only while an operation runs). The problem message is the same
text the user sees.

### Step 2: Resolve by problem code

| Phase | Problem code | Cause | Resolution |
|---|---|---|---|
| `unconfigured` | none | No environment has been selected yet. | Choose or create an environment on the setup page. |
| `unconfigured` | `interpreter_missing` | The selected interpreter file no longer exists (environment deleted, moved or renamed). | Select the environment at its new location, or create a new one. |
| `needs_attention` | `interpreter_unusable` | The interpreter could not be inspected in time, did not return a package listing, or is older than Python 3.11. | Retry when the disk is less busy; otherwise select a Python 3.11+ environment or create a new one. |
| `needs_attention` | `required_not_installable` | A required package is missing or out of range and Studio may not install it: the environment is read-only or managed by the operating system, or a required package is an editable install. | Install or update the listed packages in that environment yourself, or select another environment. The message lists what is not satisfied. |
| `needs_attention` | `required_update_failed` | Studio tried to install the required packages and `uv` failed (no network, proxy or certificate error, resolver conflict, locked files). | Read the install log on the Python page, fix the cause, then Retry. Without network, use the offline installer. |
| `needs_attention` | `host_failed` | The required packages are in range but the sidecar could not start the scientific host on this interpreter. | Use the reason code in the message (Step 3), then Retry. |

Retry (banner or Python page) re-runs the startup check: it installs the
required packages when Studio may, then restarts the analysis backend.

### Step 3: `host_failed` reason codes

The message ends with the sidecar's reason code in parentheses. The same
outcome is logged as `[Native sidecar] Studio scientific host refused: ...`.

| Reason code | Meaning | Resolution |
|---|---|---|
| `studio_adapters_unavailable` | The application's own `studio_document_adapters` package is missing or does not match its manifest. It lives in `resources/backend/adapters/`, not in the user's environment. | Reinstall the application. Changing the Python environment does not help. |
| `scientific_distribution_missing` | `nirs4all` is not visible to the scientific worker in this environment. | Retry; if it persists, select or create another environment. |
| `scientific_distribution_inconsistent` | More than one `nirs4all` distribution is visible, or the imported code is not the one the metadata describes. | Reinstall `nirs4all` in that environment, or select another environment. |
| `scientific_distribution_version_unsupported` | The `nirs4all` version is outside the range Studio requires. | Retry so that Studio installs the required version; for an editable install, update it yourself. |
| `scientific_library_import_failed` | `nirs4all` is installed but its import fails (broken dependency, incompatible binary). | Read the sidecar log line for the import error; repair the environment or create a new one. |
| `python_host_version_unsupported` | The interpreter is older than Python 3.11. | Select a Python 3.11+ environment. |
| `python_host_windows_system_root_unavailable` | The process environment Studio was started from has no `SystemRoot`, which Python needs on Windows. | Start Studio from its shortcut; collect the log if it persists. |

Other codes are shown as-is; the sidecar log line carries the detail.

### Step 4: Check the running host

Both routes are served by the Rust sidecar on its loopback port:

```text
GET /api/system/readiness
GET /api/system/env-coherence
```

- `readiness`: `ml_loading: true` while the host is being acquired (up to
  180 seconds on a cold disk); `ml_ready: true` once it runs; otherwise
  `ml_error` holds the reason code.
- `env-coherence`: `configured_python` is the interpreter Electron selected,
  `running_python` the one the host reports, and `coherent` whether they are
  the same. `core_ready: false` with `missing_core_packages: ["nirs4all"]`
  means the import failed. The route answers `503` with
  `reason: "not_configured"` when the sidecar was started without a Python
  host.

## Common Scenarios

| Scenario | What the user sees | Resolution |
|---|---|---|
| First launch | Setup page | Choose a detected environment or create one. |
| First launch after updating from a release that had an included runtime | Setup page, once | Choose or create an environment. Workspaces and settings are kept. |
| Environment folder deleted or moved | Setup page with "The selected Python environment was not found" | Select it again or create a new one. |
| System Python on Linux (externally managed) | `required_not_installable` | Create a Studio environment or use a virtual environment. |
| Developer with an editable `nirs4all` out of range | `required_not_installable` | Update the checkout; Studio never modifies editable installs. |
| No network on first launch with the standard installer | Creation fails while downloading the Python runtime or packages | Install the offline variant, or connect once. |
| Corporate proxy with a private certificate authority | `required_update_failed` with a certificate message | Add the authority to the system certificate store; `uv` and Studio use the system store. |
| Package installed from a terminal into another Python | Package still shown as missing | Install it into the interpreter shown in Settings > Python, or use the page's checkboxes. |
| "Python packages can be updated" toast | Recommended packages are older than recommended | Optional: review on Settings > Python. |
| Environment operation refused while a run is in progress | "Wait for the end of the run or stop it" | Let the run finish or stop it, then try again. |

## Log Locations

| Platform | Log Path |
|----------|----------|
| Windows  | `%APPDATA%\nirs4all-webapp\logs\nirs4all-YYYY-MM-DD.log` |
| macOS    | `~/Library/Application Support/nirs4all-webapp/logs/nirs4all-YYYY-MM-DD.log` |
| Linux    | `~/.config/nirs4all-webapp/logs/nirs4all-YYYY-MM-DD.log` |

Look for:

- `[EnvManager] Python environment: phase=...` — the state after each check.
- `[EnvManager] <operation> failed: ...` — a failed creation, installation,
  required update or switch.
- `[Native sidecar] Studio scientific host ...` — the host acquisition outcome.

The install log (the `uv` output of the last operation) is on the Python page
under the collapsible log; credentials in URLs are redacted.
