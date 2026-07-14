# Pipeline Editor Page

The Pipeline Editor is the visual drag-and-drop builder for creating and editing analysis pipelines. It uses a three-panel layout to give you simultaneous access to the step palette, the pipeline structure, and step configuration.

```{figure} ../_images/pipelines/pe-overview.png
:alt: Pipeline Editor overview
:width: 100%

The Pipeline Editor showing the Step Palette (left), Pipeline Tree (center), and Configuration Panel (right).
```

---

## Toolbar

The toolbar runs across the top of the editor.

| Control | Description |
|---------|-------------|
| **Back link** | Returns to the Pipelines page. |
| **Pipeline name** | Editable text input for the pipeline name. |
| **Save** | Saves the current pipeline to the workspace. Disabled when there are no unsaved changes. |
| **Undo / Redo** | Step-level undo and redo for all editing actions. |
| **Variant count badge** | Displays the total number of pipeline variants that generators will produce. Color-coded: green (low), amber (moderate), red (high). |
| **Favorite toggle** | Star icon to mark the pipeline as a favorite. |
| **Use in Experiment** | Navigates to the {doc}`experiment-wizard` with this pipeline pre-selected. |
| **More menu** | Dropdown with additional actions: Load Sample, Import, Export (JSON/YAML), Delete, Keyboard Shortcuts, Dataset Binding. |

---

## Step Palette (left panel)

The left panel lists all available pipeline nodes organized by category. Drag a node from the palette onto the Pipeline Tree to add it.

| Category | Contents |
|----------|----------|
| **NIRS Core** | SNV, MSC, EMSC, Detrend, SavitzkyGolay, FirstDerivative, SecondDerivative |
| **Baseline** | BaselineCorrection, ASLSBaseline, AirPLS, ArPLS, SNIP, RollingBall, ModPoly, IModPoly |
| **Scaling** | StandardScaler, MinMaxScaler, RobustScaler, MaxAbsScaler |
| **Derivatives** | SavitzkyGolay, FirstDerivative, SecondDerivative |
| **Filters** | YOutlierFilter, XOutlierFilter, SpectralQualityFilter, HighLeverageFilter, MetadataFilter |
| **Splitting** | KFold, StratifiedKFold, RepeatedKFold, ShuffleSplit, LeaveOneOut, GroupKFold, KennardStone, SPXY, and more |
| **Models** | PLSRegression, Ridge, Lasso, ElasticNet, SVR, SVC, RandomForest, XGBoost, LightGBM, CNN1D, LSTM, Transformer, and more |
| **Augmentation** | GaussianAdditiveNoise, MultiplicativeNoise, BaselineShift, WavelengthShift, and more |
| **Branching** | ParallelBranch, SourceBranch |
| **Merge** | MergePredictions, MergeSources |
| **Generators** | ChooseOne (`_or_`), Cartesian (`_cartesian_`), Range (`_range_`) |
| **Y Processing** | Target scaling transforms (StandardScaler, MinMaxScaler applied to y) |

Each palette item shows its name, a brief description, and a category color badge. A search input at the top of the palette filters nodes by name or tag.

---

## Pipeline Tree (center panel)

The center panel displays the pipeline as a visual tree structure. Steps are shown as connected nodes from top to bottom.

| Feature | Description |
|---------|-------------|
| **Tree layout** | Steps appear as nodes connected by vertical lines. Branch nodes expand horizontally to show parallel paths. |
| **Drag to reorder** | Drag a step node up or down to change its position in the sequence. |
| **Click to select** | Clicking a node selects it and opens its configuration in the right panel. |
| **Context menu** | Right-click a node to access: Duplicate, Delete, Move Up, Move Down, Wrap in Generator. |
| **Drop zones** | When dragging from the palette, highlighted drop zones appear between existing steps to indicate valid insertion points. |
| **Generator badges** | Nodes inside a generator (`_or_`, `_range_`, `_cartesian_`) show a badge indicating the generator type and variant count. |
| **Validation indicators** | Warning and error icons appear on nodes that have validation issues (e.g., missing required parameters, invalid combinations). |

---

## Configuration Panel (right panel)

When a step is selected in the tree, the right panel shows its editable parameters.

| Element | Description |
|---------|-------------|
| **Node name and type** | Header showing the selected node's name, category badge, and source (nirs4all, sklearn, etc.). |
| **Parameters** | Type-specific controls for each parameter: number inputs, dropdowns, toggles, text fields. |
| **Sweep toggles** | Parameters marked as sweepable show a sweep icon. Clicking it configures a parameter sweep (range or discrete values). |
| **Advanced section** | Some nodes have advanced parameters collapsed by default. Expand to access them. |
| **Finetune toggle** | Parameters marked as finetunable show an Optuna icon. Enables hyperparameter optimization for that parameter during training. |
| **Description** | Each parameter shows its description on hover or below the input. |

---

## Validation

The editor performs real-time validation and displays feedback inline:

| Rule | Severity | Message |
|------|----------|---------|
| Pipeline must contain at least one model | Error | No model step found in the pipeline. |
| Pipeline must contain a splitter | Warning | No cross-validation splitter found. |
| Merge requires a preceding branch | Error | Merge step has no corresponding branch. |
| Generator must contain at least two items | Warning | Generator contains fewer than 2 variants. |
| Duplicate step types | Warning | Multiple steps of the same type detected. |
| Parameter out of range | Error | Value is outside the allowed range. |

Errors prevent saving; warnings allow saving but are highlighted.

---

## Finetuning overlay

When a pipeline contains finetunable parameters, the **Finetuning** panel (accessible from the toolbar or a dedicated button) shows a summary of all parameters configured for Optuna optimization, with their search ranges and distributions.

The model finetuning tab also shows a **Native nirs4all tuning contract** card. This card explains how the current Studio configuration maps to the native `run(tuning=...)` payload:

| Field | Meaning |
|-------|---------|
| `run.tuning` | Top-level native tuning block prepared by Studio when finetuning is enabled. |
| `run.tuning.space` | Search space derived from the selected tunable parameter rows. |
| `run.tuning.force_params` | Optional public decoded warm-start values for the first optimizer trial; keys must exist in `run.tuning.space`. |
| `run.tuning.n_trials` | Trial budget configured in the editor. |
| `run.tuning.score_data` | Explicit scoring cohort required by nirs4all at run time; Studio does not infer it from displayed metrics. |
| `run.tuning.calibration` | Optional final calibration attached after the winning predictor is selected. |
| `run.tuning.storage` | Optional Optuna storage URI transported as `finetune_params.storage`, for example `sqlite:///optuna-study.db`. Empty means an in-memory study. |
| `run.tuning.study_name` | Optional Optuna study name transported as `finetune_params.study_name`, for example `pls-baseline-v1`. |

In the model finetuning tab, **Advanced Settings → Optimizer Persistence** exposes these two native keywords directly:

```json
{
  "finetune_params": {
    "storage": "sqlite:///optuna-study.db",
    "study_name": "pls-baseline-v1"
  }
}
```

Studio preserves these values when importing/exporting canonical pipelines and when rendering the backend canonical preview. It does not open the Optuna database, create studies, or validate storage backends locally; nirs4all validates and executes the optimizer when the run is launched.

The **Native nirs4all tuning contract** card also shows a local ordered search-space preview consumed through `nirs4all-ui/tuning`:

| Preview item | Meaning |
|--------------|---------|
| `nirs4all.tuning.ordered_search_space` | Shared UI artifact shape used to display the ordered tuning parameters before launch. The card displays the format, schema version and ordered rows. |
| `model.<parameter>` | Default native preview path for a model finetuning row, for example `model.n_components`. |
| `train.<parameter>` | Default native preview path for a tunable training parameter row, for example `train.batch_size`. Model rows remain ordered before training rows. |
| `force_params` subset check | Studio rejects preview warm-start values whose keys are not present in the current search space. |
| `studio_preview_non_tcv1` | Fingerprint kind used by Studio-only previews. These hashes are deterministic display identifiers, not the authoritative Python TCV1 execution fingerprints. |

Use the Studio preview to inspect order, paths, serialized search-space specs, and optional forced values before launching. It is display-only: use the nirs4all Python API or CLI as the execution source of truth for final fingerprints, schema validation, optimizer behavior, and persisted Optuna state.

:::{important}
Studio loads the keyword/effect registry from nirs4all when available and falls back to the same public keyword names when it is not. Studio prepares and displays the native tuning configuration only. The optimizer runs in nirs4all, tuning happens before conformal calibration, and changing the selected predictor invalidates any previous calibrator.
:::

---

## Native assurance at execution

The execution dialog includes a **Native assurance contract** card. It displays the conformal and robustness keywords that may affect the launched run or its follow-up artifacts, plus the registry compatibility floor that hosts must preserve when mirroring nirs4all keyword metadata.

| Area | Keywords shown | Effect |
|------|----------------|--------|
| **Conformal / tuning floor** | `run.tuning.space`, `run.tuning.force_params`, `run.tuning.score_data.conformal_calibration`, `predict.coverage`, `predict.all_predictions`, `calibrate.calibration_data` | Shows how tuning search space, warm-started trials, prediction coverage selection, calibration evidence and temporary conformal scoring relate to native tuning. |
| **Robustness** | `robustness.mode`, `robustness.scenarios`, `robustness.scenarios.kind`, `robustness.scenarios.severity`, `robustness.scenarios.distribution`, `robustness.X`, `robustness.predictor`, `robustness.predictor_bundle`, `robustness.slice_by` | Shows audit-only scenario, explicit-X frozen-predictor spectral replay, and diagnostic slice controls. |

The card is read-only. The **Required registry floor** line is a compatibility floor for Studio/custom hosts, not an execution claim. Studio does not recalibrate, refit, perturb spectra, drive optimizers, or infer guarantees from displayed diagnostics.

The same dialog also includes a **Robustness scenario draft** panel. It exposes the native `robustness.mode` and `robustness.scenarios` vocabulary as a small form:

| Field | Syntax | Effect |
|-------|--------|--------|
| **Mode** | `clean_frozen`; reserved modes such as `matched_recalibration` and `structural_refit` may appear disabled when the registry publishes them | Selects the native robustness execution contract. Studio only attaches executable modes; reserved modes are visible vocabulary, not runnable UI actions yet. |
| **Scenario kind** | `observed`, `prediction_noise`, `spectral_noise`, `spectral_offset`, `spectral_scale`, `spectral_slope`, `spectral_shift`, ... | Selects the audit perturbation family. Studio derives the displayed options from the live keyword registry when available, with a local fallback otherwise. |
| **Severity** | finite number, for example `0.1` | Records the intended perturbation magnitude in the draft payload. |
| **Distribution** | `normal` or `uniform` for stochastic scenarios only | Accepted for stochastic scenarios such as `prediction_noise` and `spectral_noise`; deterministic scenarios disable the control and clear the value. `normal` uses Gaussian noise; `uniform` uses centered bounded noise in `[-severity, +severity]`. |
| **Publish spectral/OOD replay evidence** | `robustness.publish_evidence.spectral_replay` with `X: "dataset_partition"`, `predictor_bundle: "exported_model_bundle"`, `destination: "result_metadata.robustness_evidence"`, `fail_closed: true` | Requests that native execution drivers persist the row-aligned dataset `X` matrix and exported predictor bundle reference needed by later spectral/OOD robustness replay. The checkbox is available only after the robustness draft is attached and valid. |

The **Attach this draft to launch metadata** checkbox sends the normalized payload as:

```json
{
  "robustness": {
    "mode": "clean_frozen",
    "scenarios": [
      { "kind": "prediction_noise", "severity": 0.1, "distribution": "uniform" }
    ],
    "publish_evidence": {
      "spectral_replay": {
        "X": "dataset_partition",
        "predictor_bundle": "exported_model_bundle",
        "destination": "result_metadata.robustness_evidence",
        "fail_closed": true
      }
    }
  }
}
```

This is a transport contract, not a local Studio computation. Studio validates the vocabulary and shape and stores the plan in run/execution metadata for downstream native execution drivers. It does not perturb spectra, recompute metrics, infer a predictor bundle, or create a robustness report by itself; report generation remains owned by the nirs4all robustness APIs and their required prediction/calibration evidence. When `publish_evidence.spectral_replay` is present, Studio also adds `robustness_evidence_publication_handoff` to execution metadata so local, cluster, or future remote drivers receive the same machine-readable publication contract: destination, fail-closed behavior, fields to publish, supported row-alignment strategies, registry keyword ids (`predict.save_to_workspace`, `predict.workspace_metadata`, `predict.workspace_result_metadata`) and required effects (`workspace_prediction_rows`, `prediction_arrays`, `result_metadata`, `workspace_prediction_id`, `prediction_sample_metadata`, `robustness_evidence`). The manifest also records `conformalArtifactPolicy="prediction_publisher_does_not_persist_conformal_artifacts"` to keep the boundary explicit: this publication path stores prediction/evidence metadata, not calibrated conformal artifacts or renewed coverage guarantees. Native future-backend launch payloads mirror this request in `nativePayload.manifest.robustnessEvidencePublicationHandoff`, and the launch diagnostics/projected payload details expose the same publication request as a `Robustness evidence publication` row, so cluster/wasm submitters and UI review screens can detect the required publication contract before materializing worker tasks. The current Studio run driver republishes row-aligned dataset `X` into prediction-array sidecars and writes `result_metadata.robustness_evidence.predictor_bundle` when an exported `.n4a` bundle exists and rows can be aligned by stored `sample_indices`, by full-dataset coverage, by unique metadata identifiers such as `sample_id`, `physical_sample_id`, `row_id`, `unit_id`, or `observation_id`, or by explicit row-aligned identifiers in `result_metadata.relation_replay_manifest.materialization_manifest` / `relation_materialization_manifest`. If alignment is unavailable or ambiguous, it fails closed and leaves Chain Detail blocked. Studio also records an auditable `robustness_evidence_publication_trace` on completed pipeline rows with the publication status and count; replay readiness still comes from the actual prediction-array `X` plus bundle metadata.

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save pipeline |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Delete` | Delete selected step |
| `Ctrl+D` | Duplicate selected step |
| `Ctrl+K` | Open command palette |

:::{seealso}
- {doc}`node-catalog` -- Detailed reference for every pipeline node
- {doc}`pipelines-page` -- Managing saved pipelines
- {doc}`experiment-wizard` -- Launching experiments with pipelines
:::
