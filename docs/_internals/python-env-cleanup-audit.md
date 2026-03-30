# Python Environment Handling — Cleanup Audit

Audit date: 2026-03-30
Scope: Three concerns raised about the webapp's Python environment management:
1. Confusing dual settings (`.env` path vs `python.exe` path)
2. Wizard should install only PyTorch for GPU; remove TensorFlow from installable profiles; review JAX impact
3. Recommended vs latest vs installed version visibility in Settings/Advanced

Related: `docs/venv-configuration-audit-2026-02-25.md` (env planes synchronization issues)

---

## 1. CONCERN: Confusing Dual Settings (env path vs python.exe)

### Current State

Three independent settings control "which Python":

| Setting | Where Stored | Who Manages | What It Means |
|---------|-------------|-------------|---------------|
| `customEnvPath` | `env-settings.json` (Electron userData) | `EnvManager` | Path to a Python environment **folder** |
| `customPythonPath` | `env-settings.json` (Electron userData) | `EnvManager` | Path to a Python **executable** |
| `custom_venv_path` | `venv_settings.json` (backend appData) | `VenvManager` | Path to a venv **folder** for pip operations |

The `EnvManager` (Electron-side) resolves the Python executable with this priority:
1. `customPythonPath` (direct .exe) — most reliable
2. `customEnvPath` (folder) — probes for `python.exe` inside
3. Managed venv at `{userData}/python-env/venv/` — default

The `VenvManager` (backend-side) defaults to `sys.prefix` (the running interpreter) and can be overridden to a different venv folder for package management.

### Problem

- **For the user**, these appear as two separate concepts in the UI: "Python Environment" (`PythonEnvPicker`) and "Virtual Environment Path" (`DependenciesManager` > venv path input). They *should* be the same thing.
- `customEnvPath` (folder) vs `customPythonPath` (exe) is a legacy split. The user just wants to point at "their Python". The distinction between folder and executable is an implementation detail that leaks into the UX.
- The `ConfigAlignment` component exists precisely because these can diverge — a symptom of the problem, not a solution.

### Proposed Cleanup

**A. Merge the two Electron-side settings into one: `pythonPath` (always an executable).**
- When the user browses for a folder, resolve the executable automatically (probe `Scripts/python.exe`, `bin/python`, etc.) and store the resolved exe path.
- Remove `customEnvPath` from `env-settings.json`. Migration: on load, if `customEnvPath` exists and `customPythonPath` does not, resolve and migrate.
- `EnvManager.useExistingEnv(folderPath)` becomes a convenience that internally calls `useExistingPython(resolvedExe)`.

**B. Auto-sync VenvManager target to the running interpreter.**
- On backend startup, `VenvManager` should always default to `sys.prefix` (already the case).
- Remove the ability to set a *different* custom venv path from the UI (`DependenciesManager` venv path input + `/updates/venv/path` POST endpoint). The venv for pip operations should always match the running interpreter. If the user wants a different Python, they change it in `PythonEnvPicker` and restart.
- This eliminates the "two planes" divergence documented in the Feb 2025 audit.

**C. Simplify the Settings UI.**
- `PythonEnvPicker`: single card showing current Python exe path + version. Actions: "Change" (browse for exe or folder), "Auto-setup" (download + create managed venv), "Restart Backend" after change.
- Remove the venv path input from `DependenciesManager`. Dependencies always target the active Python.
- `ConfigAlignment` component can be removed or reduced to a simple "Python OK" badge — divergence is no longer possible.

### Files Impacted

| File | Change |
|------|--------|
| `electron/env-manager.ts` | Merge `customEnvPath`/`customPythonPath` → `pythonPath`. Migration logic. Remove `useExistingEnv` (keep as internal helper). |
| `electron/main.ts` | IPC handlers: simplify to `env:usePython(exePath)` |
| `electron/preload.ts` | Update exposed API |
| `src/components/settings/PythonEnvPicker.tsx` | Remove folder-vs-exe distinction. Single "Change Python" flow. |
| `src/components/settings/DependenciesManager.tsx` | Remove venv path input section (~lines 580-670). Remove coherence check UI. |
| `src/components/settings/ConfigAlignment.tsx` | Simplify or remove. |
| `api/venv_manager.py` | Remove `set_custom_venv_path()`, `reset_to_runtime()`, `has_pending_path_change`. Always use `sys.prefix`. |
| `api/updates.py` | Remove `/updates/venv/path` POST, `/updates/venv/reset` POST endpoints. Keep GET for info. |
| `src/api/client.ts` | Remove `setVenvPath`, `resetVenvToRuntime` functions. |

---

## 2. CONCERN: GPU Profiles — PyTorch Only, Remove TensorFlow, Review JAX

### Current State

**Profiles in `recommended-config.json`:**
- `cpu` — nirs4all only
- `gpu-cuda-torch` — nirs4all + torch + keras
- `gpu-cuda-tf` — nirs4all + tensorflow + keras
- `gpu-metal` — nirs4all + tensorflow-macos + tensorflow-metal + keras

**Optional packages (deep_learning category):**
tensorflow, torch, keras, jax, jaxlib, flax, tabpfn

**Wizard flow** (`EnvSetup.tsx` step 4 "profile"):
- GPU detected → recommends `gpu-cuda-torch` or `gpu-cuda-tf` or `gpu-metal`
- User picks profile → installs profile packages
- Step 5 "extras" → user can add optional packages (including TF, JAX)

### Decision: Limit Webapp to PyTorch

**Rationale:** Simplify the GPU story. One DL backend to support, test, and troubleshoot.

**Changes to profiles:**

| Profile | Current | Proposed |
|---------|---------|----------|
| `cpu` | nirs4all | nirs4all (unchanged) |
| `gpu-cuda-torch` | nirs4all + torch + keras | nirs4all + torch + keras (unchanged) |
| `gpu-cuda-tf` | nirs4all + tensorflow + keras | **REMOVE** |
| `gpu-metal` | nirs4all + tf-macos + tf-metal + keras | **Replace**: nirs4all + torch + keras (PyTorch MPS, built-in since 2.0) |

**Changes to optional packages:**
- Remove `tensorflow` from optional installable list
- Remove `tensorflow-macos`, `tensorflow-metal` (not currently listed but referenced in profiles)
- Keep `keras` (works with PyTorch backend via Keras 3)
- Keep `torch` in optional list for manual install on CPU profile
- JAX: see section below

**Changes to GPU detection** (`api/recommended_config.py`):
- CUDA detected → recommend `[gpu-cuda-torch, cpu]` (no `gpu-cuda-tf`)
- Metal detected → recommend `[gpu-metal, cpu]` (now PyTorch-based)
- No GPU → recommend `[cpu]`

### JAX Impact Review

**JAX in nirs4all library — two usage categories:**

#### A. JAX as optional PLS accelerator (13 sklearn models)

All PLS variants in `nirs4all/operators/models/sklearn/` use JAX as an **optional backend**:

| Model | JAX Role | Works Without JAX? |
|-------|----------|-------------------|
| IKPLS | JIT + GPU/TPU acceleration | YES (numpy backend) |
| FCKPLS | Vectorized convolution | YES (scipy fftconvolve) |
| OPLS | JIT orthogonal filtering | YES (pyopls fallback) |
| SIMPLS | JIT SIMPLS algorithm | YES (numpy) |
| RobustPLS | JIT weighted iteration | YES (numpy, IRLS always numpy) |
| RecursivePLS | JIT online updates | YES (numpy) |
| OKLMPLS | JIT optimization | YES (numpy) |
| NLPLS | JIT kernel computations | YES (numpy) |
| LWPLS | Vectorized prediction (vmap) | YES (numpy) |
| KOPLS | JIT kernel OPLS | YES (numpy) |
| IPLS | JIT CV + selection | YES (numpy) |
| SparsePLS | JIT regularization | YES (numpy) |
| MBPLS | JIT single-block NIPALS | YES (numpy, multi-block always numpy) |

**Pattern:** Every model checks `_check_jax_available()` and falls back to NumPy. Default `backend='numpy'`. JAX is never auto-selected — user must explicitly request `backend='jax'`.

**Verdict:** Removing JAX from the webapp does NOT break any PLS functionality. Users lose GPU acceleration for PLS, but:
- PLS models are already fast on CPU (small matrices)
- The acceleration benefit is marginal for typical NIRS datasets (100-2000 samples, 200-2000 wavelengths)
- Power users who need JAX PLS acceleration can install it manually

#### B. JAX-only deep learning models

`nirs4all/operators/models/jax/`:
- `JaxMLPRegressor`, `JaxMLPClassifier` — Flax MLP implementations
- `nicon.py` — JAX/Flax CNN architecture (nicon)

**These require JAX.** Without JAX, these model classes are unavailable.

**Verdict:** These are niche models. The webapp already has PyTorch equivalents (`TorchMLPRegressor`, `TorchMLPClassifier`, PyTorch nicon). Losing JAX DL models is acceptable.

### Proposed JAX Decision

**Keep JAX in the optional installable list** but do NOT install it by default in any profile.

Rationale:
- JAX PLS acceleration is a power-user feature (must explicitly set `backend='jax'`)
- JAX DL models have PyTorch equivalents
- JAX installation is non-trivial (jax + jaxlib + platform-specific CUDA wheels)
- Users who want it can install via Settings > Advanced > Dependencies

**Changes to `recommended-config.json` optional section:**
- Keep `jax`, `jaxlib`, `flax` in the optional list (category: "deep_learning")
- Add a `"note"` field: `"Optional GPU accelerator for PLS models. PyTorch is recommended for deep learning."`

### Files Impacted

| File | Change |
|------|--------|
| `recommended-config.json` | Remove `gpu-cuda-tf` and old `gpu-metal` profiles. Update `gpu-metal` to use torch. Remove tensorflow from optional. |
| `api/recommended_config.py` | Update `_detect_gpu()` recommendations. Remove TF-specific profile logic. |
| `src/components/setup/EnvSetup.tsx` | Remove TF profile cards from step 4. Update Metal profile description. Remove TF from extras in step 5 (or just let config drive it). |
| `api/system.py` `/system/capabilities` | Keep `tensorflow` field but it will naturally be `false`. No code change needed. |
| `api/system.py` `/system/build` | Remove TF GPU detection logic (or keep for backward compat — minor). |
| `requirements-gpu.txt` | Remove `tensorflow[and-cuda]`. Add `torch`. |
| `requirements-gpu-macos.txt` | Remove `tensorflow-macos`, `tensorflow-metal`. Add `torch`. |

---

## 3. CONCERN: Version Visibility (Recommended vs Latest vs Installed)

### Current State

The `DependenciesManager` component currently shows per-package:
- **Installed version** (from `pip list --json`)
- **Latest available version** (from `pip list --outdated --json`)
- Actions: Install / Update (to latest) / Uninstall

There is **no concept of "recommended version"** separate from the minimum constraint (e.g., `>=2.1.0` for torch). The system always updates to the absolute latest on PyPI.

### Problem

- The webapp is tested against specific versions. Blindly updating to the latest PyPI version can introduce breaking changes (e.g., torch 3.0 breaking Keras 3 compatibility, or a new numpy deprecating APIs).
- Users have no way to know which version is *validated* for the webapp.
- There's no way to downgrade back to the recommended version after updating to latest.

### Proposed Design: Three-Column Version Display

Add a `"recommended"` field to each package in `recommended-config.json`:

```json
"torch": {
  "version": ">=2.1.0",
  "recommended": "2.6.0",
  "description": "PyTorch deep learning framework",
  "category": "deep_learning"
}
```

- `version`: minimum constraint (for fresh install)
- `recommended`: the version tested and validated for this webapp release
- Latest: fetched from PyPI at runtime

**UI in DependenciesManager — per package row:**

```
torch                    Installed: 2.5.1    Recommended: 2.6.0    Latest: 2.7.0
                         [Update to Recommended]  [Update to Latest]
```

**Three states per package:**

| Installed | vs Recommended | vs Latest | Display | Actions |
|-----------|---------------|-----------|---------|---------|
| Not installed | — | — | "Not installed" | [Install Recommended] |
| < recommended | Behind | Behind | Yellow badge | [Update to Recommended] [Update to Latest] |
| = recommended | Match | Behind | Green badge | [Update to Latest] (with warning) |
| > recommended, < latest | Ahead | Behind | Blue "custom" badge | [Revert to Recommended] [Update to Latest] |
| = latest | Ahead or match | Match | Green badge | [Revert to Recommended] (if != recommended) |
| > latest | Ahead | Ahead | Orange "dev" badge | [Revert to Recommended] |

**Fresh install behavior:**
- Wizard step 6 installs the **recommended** version (pinned), not the minimum or latest.
- `pip install torch==2.6.0` instead of `pip install torch>=2.1.0`

**Update to Latest warning:**
- When user clicks "Update to Latest" and latest != recommended, show a confirmation:
  > "Version 2.7.0 is newer than the recommended 2.6.0. This version has not been validated with the webapp. You can always revert to the recommended version."

### Backend Changes

**`recommended-config.json` schema update:**
```json
{
  "schema_version": "1.2",
  "app_version": "0.2.1",
  "nirs4all": "0.7.1",
  "nirs4all_recommended": "0.7.1",
  "profiles": {
    "cpu": {
      "packages": {
        "nirs4all": { "min": ">=0.7.1", "recommended": "0.7.1" }
      }
    },
    "gpu-cuda-torch": {
      "packages": {
        "nirs4all": { "min": ">=0.7.1", "recommended": "0.7.1" },
        "torch": { "min": ">=2.1.0", "recommended": "2.6.0" },
        "keras": { "min": ">=3.0.0", "recommended": "3.8.0" }
      }
    }
  },
  "optional": {
    "torch": {
      "min": ">=2.1.0",
      "recommended": "2.6.0",
      "description": "...",
      "category": "deep_learning"
    }
  }
}
```

**New endpoint or extend existing:**
- `GET /updates/dependencies` response already returns `DependencyInfo` per package. Add fields:
  ```python
  class DependencyInfo(BaseModel):
      name: str
      installed: bool
      installed_version: str | None
      latest_version: str | None
      recommended_version: str | None    # NEW
      min_version: str | None            # NEW (the >= constraint)
      is_outdated: bool                  # installed < latest
      is_below_recommended: bool         # NEW: installed < recommended
      is_above_recommended: bool         # NEW: installed > recommended
      category: str
      description: str
      requires_restart: bool
  ```

- `POST /updates/dependencies/install` — add optional `target_version` parameter:
  ```python
  class InstallRequest(BaseModel):
      package: str
      target_version: str | None = None   # None = recommended, "latest" = latest
  ```

- `POST /updates/dependencies/revert` — new endpoint to pin back to recommended:
  ```python
  class RevertRequest(BaseModel):
      package: str
      # Always installs the recommended version from config
  ```

### Frontend Changes

**`DependenciesManager.tsx`:**
- Rework package row to show three version columns
- Add "Update to Recommended" / "Update to Latest" / "Revert to Recommended" buttons based on state
- Color-coded badges (green = at recommended, yellow = below, blue = above, orange = dev)
- Confirmation dialog for "Update to Latest" when latest != recommended

**`EnvSetup.tsx` step 6 (installation):**
- Use `recommended` versions for fresh install, not `min` constraints
- Show which versions will be installed in the summary

### Files Impacted

| File | Change |
|------|--------|
| `recommended-config.json` | Schema v1.2: add `recommended` field per package, restructure profile packages. |
| `api/updates.py` | Extend `DependencyInfo` model. Add `recommended_version`, `is_below_recommended`, `is_above_recommended`. Update `get_dependencies()` to compute these. Add `target_version` to install endpoint. Add `/dependencies/revert` endpoint. |
| `api/recommended_config.py` | Update config parsing for new schema. `align_config()` to use recommended versions. |
| `src/components/settings/DependenciesManager.tsx` | Three-column version display. New action buttons. Confirmation dialogs. Badge logic. |
| `src/components/setup/EnvSetup.tsx` | Step 6: install pinned recommended versions. Step 7 summary: show installed versions. |
| `src/api/client.ts` | Add `revertDependency()`, update `installDependency()` signature. |

---

## 4. IMPLEMENTATION ORDER

Recommended sequence to minimize risk and maximize incremental value:

### Phase 1: Profile cleanup (low risk, high clarity)
1. Update `recommended-config.json`: remove TF profiles, update Metal to torch, remove TF from optional
2. Update `api/recommended_config.py`: simplify GPU recommendations
3. Update `EnvSetup.tsx`: remove TF profile cards
4. Update requirements-gpu files
5. Test: fresh wizard flow with CUDA and Metal detection

### Phase 2: Version management (medium risk, high value)
1. Add `recommended` versions to `recommended-config.json` (schema v1.2)
2. Extend `DependencyInfo` model in `api/updates.py`
3. Add `target_version` to install endpoint, add revert endpoint
4. Rework `DependenciesManager.tsx` for three-column display
5. Update `EnvSetup.tsx` to install recommended versions
6. Test: install, update-to-latest, revert-to-recommended flows

### Phase 3: Settings unification (higher risk, architectural)
1. Merge Electron env settings (`customEnvPath` + `customPythonPath` → `pythonPath`)
2. Add migration logic in `EnvManager`
3. Remove venv path UI from `DependenciesManager`
4. Remove or simplify `ConfigAlignment`
5. Remove `set_custom_venv_path` / `reset_to_runtime` from `VenvManager`
6. Remove corresponding API endpoints
7. Test: env switching, restart, wizard flow, settings coherence

---

## 5. RECOMMENDED VERSIONS BOOTSTRAP

Initial recommended versions to populate in `recommended-config.json` (to be validated by testing):

| Package | Min | Recommended | Notes |
|---------|-----|-------------|-------|
| nirs4all | >=0.7.1 | 0.7.1 | Current stable |
| torch | >=2.1.0 | 2.6.0 | Last tested stable |
| keras | >=3.0.0 | 3.8.0 | Keras 3 multi-backend |
| jax | >=0.4.20 | 0.4.38 | Optional, last tested |
| jaxlib | >=0.4.20 | 0.4.38 | Must match jax |
| flax | >=0.8.0 | 0.10.4 | Optional, last tested |
| tabpfn | >=2.0.0 | 2.0.3 | Torch-based |
| ikpls | >=1.1.0 | 1.3.0 | PLS acceleration |
| lightgbm | >=4.0.0 | 4.6.0 | Boosting |
| xgboost | >=2.0.0 | 3.0.0 | Boosting |
| catboost | >=1.2.0 | 1.2.7 | Boosting |
| shap | >=0.44 | 0.47.1 | Explainability |
| matplotlib | >=3.7.0 | 3.10.1 | Visualization |
| seaborn | >=0.12.0 | 0.13.2 | Visualization |
| plotly | >=5.0.0 | 6.0.1 | Visualization |
| umap-learn | >=0.5.0 | 0.5.7 | Dimensionality |
| autogluon | >=1.0.0 | 1.2.0 | AutoML |
| openpyxl | >=3.1.0 | 3.1.5 | Export |

*Note: These versions should be verified against the current test suite before committing.*

---

## 6. OPEN QUESTIONS

1. **Remote config updates:** Should `recommended-config.json` be fetchable from a remote URL so we can update recommended versions without a new webapp release? The current `api/recommended_config.py` already has some remote config logic — extend it?

YES !

2. **Keras without TF:** Keras 3 supports PyTorch backend natively. Should we auto-configure `KERAS_BACKEND=torch` in the webapp's environment? This would make Keras models work out-of-the-box with the PyTorch-only setup.

YES

3. **Apple Metal profile naming:** If Metal now uses PyTorch MPS, should the profile be renamed from `gpu-metal` to `gpu-mps` or kept as `gpu-metal` for user familiarity?

rename

4. **JAX PLS in the webapp pipeline editor:** The webapp's node registry likely doesn't expose the `backend='jax'` parameter for PLS nodes. If JAX is optional-installable, should the pipeline editor show a "JAX acceleration" toggle on PLS nodes when JAX is detected as installed?

yes. More so, the NN nodes such as nicon, decon, etc. should point out to torch version.


Last remarks:
- I don't care about backward compatibility. The webapp is not diffused yet so any big change is welcome. No backward compatibility or dead code.