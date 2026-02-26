# Support Runbook: Environment Mismatch

Internal support guide for diagnosing "installed but can't import" issues.

## Triage Questions

1. **What mode?** Electron installed / portable / web dev / Docker / standalone
2. **Did they recently change the Python environment?** (wizard, custom path, terminal pip)
3. **Is there an amber "Environment mismatch detected" banner?** (Settings > Advanced)
4. **What OS?** Windows / macOS / Linux

## Diagnostic Steps

### Step 1: Check coherence endpoint

```
GET /api/system/env-coherence
```

Key fields:
- `coherent: false` → mismatch confirmed
- `python_match: false` → VenvManager targets a different Python executable
- `prefix_match: false` → VenvManager targets a different venv/prefix
- `venv_manager.is_custom: true` → custom path is set
- `venv_manager.has_pending_change: true` → path change waiting for restart

### Step 2: Check venv_settings.json

Location (varies by platform):

| Platform | Path |
|----------|------|
| Windows  | `%LOCALAPPDATA%\nirs4all-webapp\venv_settings.json` |
| macOS    | `~/Library/Application Support/nirs4all-webapp/venv_settings.json` |
| Linux    | `~/.local/share/nirs4all-webapp/venv_settings.json` |

Check contents:
- `custom_venv_path` pointing to a non-existent path → **stale settings**
- `custom_venv_path: null` → default (using `sys.prefix`), settings are not the problem
- File doesn't exist → good, no custom override

### Step 3: Check env-settings.json (Electron only)

Location: `{userData}/env-settings.json` (use `app.getPath("userData")` in Electron)

- `customPythonPath` / `customEnvPath` should point to an existing Python
- If empty/null: managed env at `{userData}/python-env/venv/`

### Step 4: Check build info

```
GET /api/system/build
```

- `is_frozen: true` → standalone mode, packages can't be modified
- `build_flavor` → CPU or GPU build

### Step 5: Resolution

| Action | When to use |
|--------|------------|
| `POST /api/updates/venv/reset` | Custom path is set but wrong |
| Delete `venv_settings.json` | Backend can't be reached, need manual fix |
| Restart backend | Pending path change needs to activate |
| Re-run setup wizard | Electron env is misconfigured |

## Common Scenarios

| Scenario | Root Cause | Automatic Fix | Manual Fix |
|----------|-----------|---------------|------------|
| User set custom venv path, didn't restart | Deferred activation | N/A | Restart backend |
| App update changed Python path | Stale `venv_settings.json` | `clearBackendVenvSettings()` on startup | Delete `venv_settings.json`, restart |
| Portable .exe relocated | `env-settings.json` has stale absolute paths | `validatePortableState()` clears settings | Re-run wizard |
| pip install from terminal | Installed in wrong venv | N/A | Use runtime Python path from coherence endpoint |
| Standalone mode, package needed | Frozen environment | N/A | Use installed (non-standalone) version |

## Log Locations

| Platform | Log Path |
|----------|----------|
| Windows  | `%APPDATA%\nirs4all-webapp\logs\nirs4all-YYYY-MM-DD.log` |
| macOS    | `~/Library/Application Support/nirs4all-webapp/logs/nirs4all-YYYY-MM-DD.log` |
| Linux    | `~/.config/nirs4all-webapp/logs/nirs4all-YYYY-MM-DD.log` |

Look for:
- `[EnvManager] Portable path drift detected` — portable mode relocation
- `[EnvManager] Cleared stale backend venv settings` — cleanup happened
- `Environment coherence check` — startup coherence result
