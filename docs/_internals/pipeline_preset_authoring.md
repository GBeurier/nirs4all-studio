# Pipeline Preset Authoring

The webapp ships a small set of pipeline presets that users can pick from
the **Pipelines → Use Template** flow. Presets are no longer hardcoded —
they live as YAML or JSON files in [`api/presets/`](../../api/presets/) and
are authored in **nirs4all's own canonical pipeline format**.

The authoring workflow is designed so that anyone with a working nirs4all
Python pipeline can produce a preset file with two lines of code, no
manual translation involved.

---

## File location

```
nirs4all-webapp/api/presets/
├── pls_basic.yaml
├── pls_derivative.yaml
├── rf_standard.yaml
├── kennard_stone_pls.yaml
└── advanced_nirs.yaml
```

The loader scans `*.yaml`, `*.yml`, and `*.json`. Files starting with `.`
or `_` are skipped. The filename is purely a convention — the preset's
identity comes from the `id` field inside the file.

## File schema

```yaml
id: pls_basic                            # Required. Stable identifier used by the API.
name: Basic PLS Pipeline                 # Required. Display name in the UI.
description: Simple PLS regression…      # Required. Short tagline shown on the card.
task_type: regression                    # Required. "regression" | "classification".
pipeline:                                # Required. Canonical nirs4all step list.
  - nirs4all.operators.transforms.scalers.StandardNormalVariate
  - sklearn.model_selection._split.KFold
  - model:
      class: sklearn.cross_decomposition._pls.PLSRegression
      params:
        n_components: 10
```

The `pipeline` block is **byte-identical** to what
[`nirs4all.pipeline.config.component_serialization.serialize_component`](../../../nirs4all/nirs4all/pipeline/config/component_serialization.py)
produces. That means anything described in
[nirs4all/examples/pipeline_samples/README.md](../../../nirs4all/examples/pipeline_samples/README.md)
is, in principle, valid here — although the file-based preset path has
the limitations listed at the bottom of this doc.

## Authoring from a Python pipeline (recommended)

The fastest path: build the pipeline in normal nirs4all syntax, then
serialize it.

```python
# nirs4all-webapp/scripts/generate_seed_presets.py — run from the repo root
import yaml
from sklearn.cross_decomposition import PLSRegression
from sklearn.model_selection import KFold
from nirs4all.operators.transforms import StandardNormalVariate
from nirs4all.pipeline.config.component_serialization import serialize_component

# 1. Build the pipeline using normal nirs4all syntax
pipeline = [
    StandardNormalVariate(),
    KFold(n_splits=5),
    {"model": PLSRegression(n_components=10)},
]

# 2. Wrap with preset metadata + canonical pipeline
preset = {
    "id": "pls_basic",
    "name": "Basic PLS Pipeline",
    "description": "Simple PLS regression with SNV preprocessing",
    "task_type": "regression",
    "pipeline": serialize_component(pipeline),
}

# 3. Write the YAML
with open("nirs4all-webapp/api/presets/pls_basic.yaml", "w") as f:
    yaml.safe_dump(preset, f, sort_keys=False, default_flow_style=False)
```

This is exactly how the 5 shipped presets are generated — see
[`scripts/generate_seed_presets.py`](../../scripts/generate_seed_presets.py)
for the full script that emits all of them in one shot.

> **Why `serialize_component`?** It is the same function nirs4all uses
> internally to round-trip pipelines. It produces canonical internal module
> paths (e.g. `sklearn.preprocessing._data.StandardScaler` rather than the
> public re-export `sklearn.preprocessing.StandardScaler`), strips default
> parameters, and converts tuples to lists for clean YAML/JSON output.
> Whatever you write in Python becomes a deterministic preset file.

## Authoring by hand

If you do not want to round-trip through Python, you can write the YAML
directly. Use [`nirs4all/examples/pipeline_samples/01_basic_regression.yaml`](../../../nirs4all/examples/pipeline_samples/01_basic_regression.yaml)
as a template — the `pipeline:` block uses the exact same shape.

Three step shapes are accepted by the loader:

| Shape | Example |
|---|---|
| Bare class path string | `- sklearn.preprocessing._data.StandardScaler` |
| Class with params | `- {class: sklearn.model_selection._split.KFold, params: {n_splits: 5}}` |
| Model wrapper | `- {model: {class: sklearn.cross_decomposition._pls.PLSRegression, params: {n_components: 10}}}` |

Any path that the Python `importlib` machinery can resolve will work.
Public paths (`sklearn.preprocessing.StandardScaler`) are also accepted —
the loader resolves them at preset-instantiation time.

## Bulk export from existing nirs4all pipeline files

If you already have nirs4all sample files (JSON or YAML) and want to
promote them to webapp presets, the
[`export_canonical.py`](../../../nirs4all/examples/pipeline_samples/export_canonical.py)
script in the nirs4all repo will read any pipeline file and emit the
canonical form via `PipelineConfigs` + `serialize_component`. The only
extra step is wrapping the result with `id` and `task_type` and dropping
it into `api/presets/`.

## Currently unsupported (Strategy A limits)

The webapp's preset → pipeline storage path downgrades each canonical
step into the legacy `{name, type, params}` format consumed by
[`build_full_pipeline`](../../api/nirs4all_adapter.py) (see the docstring
at lines 11-13). Any canonical keyword that has no legacy equivalent
will cause `POST /pipelines/from-preset/{id}` to return a 400 with a
clear error naming the offending keyword.

Currently rejected:

- `branch` (parallel/separation branches)
- `y_processing` (target scaling)
- `merge` (combine branches)
- `feature_augmentation`, `sample_augmentation`, `concat_transform`
- `metadata_partitioner`, `exclude`, `tag`
- `rep_to_sources`, `rep_to_pp`
- All generator keywords: `_or_`, `_range_`, `_log_range_`, `_grid_`,
  `_cartesian_`, `_zip_`, `_chain_`, `_sample_`

In short, file-based presets must currently be a flat list of
`preprocessing → splitter → model` steps. Lifting this restriction is a
future task that requires routing stored pipelines through
[`build_native_pipeline`](../../api/nirs4all_adapter.py) instead of
`build_full_pipeline`.

## How the loader uses the file

```text
api/presets/<id>.yaml
        │
        │   yaml.safe_load + schema validation
        ▼
preset_loader.load_preset(id)            ──► dict with canonical 'pipeline'
        │
        │   canonical_to_legacy_steps()
        ▼
[{name, type, params}, …]               ──► PipelineCreate
        │
        │   pipelines.create_pipeline()
        ▼
<workspace>/pipelines/<pipeline_id>.json (legacy format, ready for the editor)
```

The frontend listing endpoint (`GET /pipelines/presets`) returns only
`{id, name, description, task_type, steps_count}` — the full pipeline
block stays on disk until the user clicks **Use Template**.

## Adding a new preset (checklist)

1. Decide on a stable `id` (snake_case, matches the filename for clarity).
2. Either run the Python snippet above or write the YAML by hand.
3. Drop the file in `nirs4all-webapp/api/presets/`.
4. (Optional) Add an icon mapping in
   [`PresetSelector.tsx`](../../src/components/pipelines/PresetSelector.tsx)
   if you want a custom lucide icon. Otherwise the default branch icon is used.
5. Restart the backend (the loader scans the directory on each request,
   but new files in dev mode require an HMR refresh).
6. Verify in the UI that **Pipelines → Use Template** lists your new
   preset and that clicking it creates a usable pipeline.

If `canonical_to_legacy_steps` rejects your preset because of an
unsupported keyword, the response body names the keyword and points back
to this doc.
