# Troubleshooting: Missing Packages

## Symptom

A package is shown as installed in **Settings > Advanced > Dependencies** but training fails with `ImportError` or `ModuleNotFoundError`.

## Cause

The app may be configured for one Python interpreter while the backend is still
running under another. This happens when:

- the user selected a different Python runtime but the backend has not restarted yet
- the configured interpreter is stale or no longer valid
- A package was installed via `pip` in a terminal instead of through the app

## Diagnosis

1. Go to **Settings > Advanced > Python Runtime**
2. Compare **Configured Python** and **Running Python**
3. Check whether the card shows **Configured = Running** or **Mismatch**
4. If needed, call `GET /api/system/env-coherence`

Useful fields:

- `configured_python`
- `running_python`
- `configured_matches_running`
- `missing_core_packages`
- `missing_optional_packages`

## Solutions

### Re-run the Python Switch Flow

Open **Settings > Advanced > Python Runtime**, select the intended runtime
again, and complete the switch flow. This revalidates the interpreter and
restarts the backend under it.

### Restart the Backend

If the configured runtime is already correct, restart the backend or relaunch
the app so **Configured Python** and **Running Python** match.

### Manual Fix

If the above don't resolve the issue:
1. Note the **Running Python** path shown in Python Runtime or `/api/system/env-coherence`
2. Open a terminal and run: `<runtime-python-path> -m pip install <package>`
3. Restart the backend

### Verify the Fix

After applying any fix:
1. Check that **Configured = Running** is shown
2. Verify the package shows as installed in Dependencies
3. Try running your pipeline again

## Special Modes

### Bundled Embedded Runtime

If the bundled build is still using its embedded Python runtime, package
mutation is blocked because that embedded runtime is read-only. Switch to an
external Python runtime in **Settings > Advanced > Python Runtime** if you need
to install packages.

### Docker Mode

In Docker, install packages via the container's pip:
```bash
docker exec <container> pip install <package>
```
The webapp's package manager works against the container's Python environment.

### Web Dev Mode

When running the webapp in web-only mode (no Electron), the backend uses whatever Python environment it was started with (`sys.prefix`). Install packages in that environment directly.
