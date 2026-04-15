# Pipeline Preset Authoring

Pipeline presets live in [`api/presets/`](../../api/presets/) as YAML or JSON
files. Each preset now exposes one or two task variants so the UI can offer a
dedicated **Regression** and/or **Classification** action on the same template
card.

## Current schema

```yaml
id: pls_basic
name: Basic PLS Pipeline
description: Simple PLS templates for regression and classification
default_variant: regression
variants:
  regression:
    format: yaml
    pipeline:
      - nirs4all.operators.transforms.scalers.StandardNormalVariate
      - sklearn.model_selection._split.KFold
      - model:
          class: sklearn.cross_decomposition._pls.PLSRegression
          params:
            n_components: 10
  classification:
    format: yaml
    pipeline:
      - nirs4all.operators.transforms.scalers.StandardNormalVariate
      - class: sklearn.model_selection._split.StratifiedKFold
        params:
          n_splits: 5
          shuffle: true
          random_state: 42
      - model:
          class: nirs4all.operators.models.sklearn.plsda.PLSDA
          params:
            n_components: 10
```

Rules:

- `id`, `name`, and `description` are required.
- `variants` may contain `regression`, `classification`, or both.
- Every variant must contain `format` and a canonical `pipeline` list.
- `default_variant` must reference one of the available variants.
- The legacy single-variant shape (`task_type` + `pipeline`) is still accepted
  by the loader and normalized internally, but new presets should use
  `variants`.

## Authoring from Python

The recommended path is to build normal nirs4all pipelines and serialize them
with `serialize_component`. The helper script
[`scripts/presets_generation/presets.py`](../../scripts/presets_generation/presets.py)
already emits the shipped presets in the correct dual-variant format.

```bash
d:\nirs4all\.venv\Scripts\python.exe nirs4all-webapp\scripts\presets_generation\presets.py
```

The script overwrites the preset files in `api/presets/`.

## Runtime contract

- `GET /pipelines/presets` returns:
  - `default_variant`
  - `available_variants`
  - `variants`
  - a compatibility `pipeline` / `task_type` pair materialized from the default
    variant for preview rendering
- `POST /pipelines/from-preset/{preset_id}` accepts a body with:
  - `variant`
  - optional `name`
- The created pipeline persists the selected `task_type`.

## Notes

- Variant pipelines are stored directly in nirs4all canonical syntax.
- Generator-heavy presets are supported; the advanced shipped preset uses
  `_cartesian_` plus finetuning metadata.
- If you add a new preset id and want a custom icon in the UI, update
  [`PresetSelector.tsx`](../../src/components/pipelines/PresetSelector.tsx).
