# Troubleshooting: Missing Packages

## Symptom

A package is shown as installed in **Settings > Advanced > Dependencies** but training fails with `ImportError` or `ModuleNotFoundError`.

## Cause

The package manager may be targeting a different Python environment than the one running the backend. This happens when:
- A custom venv path was set but the backend wasn't restarted
- The Electron app switched Python environments but stale settings remain
- A package was installed via `pip` in a terminal instead of through the app

## Diagnosis

1. Go to **Settings > Advanced > Dependencies**
2. Look for the amber **"Environment mismatch detected"** banner at the top
3. Check the **Runtime** information shown below the Python Environment path

If the banner is present, the package manager and the running backend are targeting different environments.

## Solutions

### Quick Fix: Reset to Current Environment

Click **"Reset to Current Environment"** in the mismatch banner. This aligns the package manager with the running backend so that packages installed through the UI will be importable.

### Restart Backend

Click **"Restart Backend"** (or restart the app). This restarts the backend process using the configured Python environment, ensuring packages and runtime match.

### Manual Fix

If the above don't resolve the issue:
1. Note the "Runtime" Python path shown in the coherence information
2. Open a terminal and run: `<runtime-python-path> -m pip install <package>`
3. Restart the backend

### Verify the Fix

After applying any fix:
1. Check that the mismatch banner is gone
2. Verify the package shows as installed in Dependencies
3. Try running your pipeline again

## Special Modes

### Standalone Mode

In standalone (bundled) mode, packages cannot be installed or removed. The bundled environment is read-only. If you need additional packages, use the installed (non-standalone) version of the application.

### Docker Mode

In Docker, install packages via the container's pip:
```bash
docker exec <container> pip install <package>
```
The webapp's package manager works against the container's Python environment.

### Web Dev Mode

When running the webapp in web-only mode (no Electron), the backend uses whatever Python environment it was started with (`sys.prefix`). Install packages in that environment directly.
