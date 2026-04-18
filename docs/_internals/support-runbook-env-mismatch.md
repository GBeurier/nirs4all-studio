# Support Runbook: Environment Mismatch

Internal support guide for diagnosing "installed but can't import" issues.

## Triage Questions

1. **What mode?** Electron installed / portable / web dev / Docker / standalone
2. **Did they recently change the Python environment?** (wizard, custom path, terminal pip)
3. **Does Python Runtime show different configured and running paths?** (Settings > Advanced)
4. **What OS?** Windows / macOS / Linux

## Diagnostic Steps

### Step 1: Check coherence endpoint

```
GET /api/system/env-coherence
```

Key fields:
- `coherent: false` or `configured_matches_running: false` → mismatch confirmed
- `configured_python` → interpreter Electron expects on the next launch
- `running_python` → interpreter the backend is using right now
- `missing_core_packages` → runtime cannot fully boot the backend
- `missing_optional_packages` → only some features are unavailable

### Step 2: Check env-settings.json (Electron only)

Location: `{userData}/env-settings.json` (use `app.getPath("userData")` in Electron)

- `pythonPath` should point to an existing Python executable if the user has
  selected an external runtime
- if `pythonPath` is absent, Electron should fall back to the managed runtime
  or bundled default runtime, depending on build type

### Step 3: Check build info

```
GET /api/system/build
```

- `runtime_mode: bundled` with `is_bundled_default: true` in coherence →
  embedded bundled runtime still active
- `runtime_mode: pyinstaller` → packaged backend mode, read-only

### Step 4: Resolution

| Action | When to use |
|--------|------------|
| Re-run Python Runtime switch flow | Configured path is wrong or stale |
| Restart backend / relaunch app | Configured path is correct but backend still runs elsewhere |
| Re-run managed runtime setup | No usable runtime exists |
| Install package into `running_python` manually | Terminal install landed in the wrong environment |

## Common Scenarios

| Scenario | Root Cause | Automatic Fix | Manual Fix |
|----------|-----------|---------------|------------|
| User selected a different Python but has not restarted yet | Configured and running interpreters differ | Restart through the shared switch flow | Restart backend |
| App update or manual edits left `pythonPath` stale | `env-settings.json` points to a missing executable | `validateConfiguredState()` clears it | Re-run setup or choose a runtime again |
| Portable .exe relocated | `env-settings.json` has stale absolute paths | `validatePortableState()` clears settings | Re-run wizard |
| pip install from terminal | Installed in wrong Python | N/A | Use `running_python` from coherence endpoint |
| Bundled embedded runtime needs extra packages | Embedded runtime is read-only | N/A | Switch to an external runtime first |

## Log Locations

| Platform | Log Path |
|----------|----------|
| Windows  | `%APPDATA%\nirs4all-webapp\logs\nirs4all-YYYY-MM-DD.log` |
| macOS    | `~/Library/Application Support/nirs4all-webapp/logs/nirs4all-YYYY-MM-DD.log` |
| Linux    | `~/.config/nirs4all-webapp/logs/nirs4all-YYYY-MM-DD.log` |

Look for:
- `[EnvManager] Portable path drift detected` — portable mode relocation
- `Using configured Python runtime` — backend launch used the configured interpreter
- `Backend runtime packages missing` — startup repair path ran
