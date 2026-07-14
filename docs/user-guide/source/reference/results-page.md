# Results Page

The Results page displays experiment outcomes grouped by dataset. It provides a structured view of model performance, allowing you to compare preprocessing chains, scores, and metrics across all experiments in the workspace.

```{figure} ../_images/results/res-scores-overview.png
:alt: Results page overview
:width: 100%

The Results page showing dataset cards with expandable chain lists and score comparisons.
```

---

## Page layout

1. **Header** -- Title, summary statistics, and a refresh button.
2. **Search bar** -- Text input to filter datasets by name.
3. **Dataset cards** -- Collapsible cards, one per dataset, listing the top-performing chains.

---

## Summary statistics

Displayed as compact stat cards at the top of the page:

| Stat | Description |
|------|-------------|
| **Datasets** | Number of datasets with results. |
| **Total models** | Total number of chains (preprocessing + model combinations) across all datasets. |
| **Best final score** | The highest final (refit) test score found across all datasets, with its metric name and model type. |
| **Best CV score** | The highest cross-validation score found, with its metric name. |

---

## Search

The search input filters the dataset card list by dataset name (case-insensitive substring match). Only datasets whose names match the query are displayed.

---

## Dataset cards

Each dataset that has experiment results is shown as a collapsible card. The first dataset is expanded by default.

### Card header

| Element | Description |
|---------|-------------|
| **Dataset name** | Name of the dataset. |
| **Metric** | The primary evaluation metric for this dataset (e.g., R2, RMSE, accuracy). Auto-detected based on task type (regression vs. classification). |
| **Chain count** | Number of unique preprocessing+model chains evaluated for this dataset. |
| **Expand/collapse** | Chevron icon to toggle the chain list visibility. |

### Chain list

When expanded, the card shows a ranked list of the top-performing chains (sorted by score, best first). Each chain entry displays:

| Column | Description |
|--------|-------------|
| **Rank** | Position in the ranking (1 = best). |
| **Chain description** | Preprocessing steps and model name displayed as a chain (e.g., "SNV > SavitzkyGolay(d=1) > PLSRegression(10)"). |
| **Model name** | The model used in this chain (e.g., PLSRegression, Ridge, RandomForest). |
| **CV score** | Average cross-validation score across all folds. This is the primary ranking metric. |
| **CV std** | Standard deviation of the cross-validation scores across folds, indicating score stability. |
| **Final test score** | Score from the final refit model evaluated on held-out test data. Shown only when a refit was performed. Highlighted with a distinct badge. |
| **Fold count** | Number of cross-validation folds used. |

:::{note}
Chains with a final test score are highlighted because the final score is evaluated on data the model has never seen during cross-validation, making it the most reliable performance estimate.
:::

---

## Score formatting

Scores are formatted based on the metric type:

| Metric | Format | Better direction |
|--------|--------|-----------------|
| **R2** | Decimal (e.g., 0.9542) | Higher is better |
| **RMSE** | Decimal (e.g., 0.312) | Lower is better |
| **MAE** | Decimal (e.g., 0.245) | Lower is better |
| **Accuracy** | Percentage (e.g., 95.4%) | Higher is better |
| **F1** | Decimal (e.g., 0.921) | Higher is better |

The sorting logic accounts for the metric direction -- chains are always ranked with the best score first, regardless of whether lower or higher values are better.

---

## Native conformal prediction results

When a run or chain includes a native nirs4all `CalibratedRunResult` artifact, the result detail panel and chain detail panel can show a **Conformal prediction** section alongside the usual metrics and artifacts. Studio renders the materialized interval levels, a coverage strip, attached conformal coverage metrics when present, the explicit guarantee badge, the calibration replay provenance carried by `conformal_guarantee_status.calibration_replay_source` (falling back to the artifact-level `metadata.calibration_replay_source` used by nirs4all's public accessors), and the optional tuning calibration provenance recorded by `metadata.tuning_calibration_source`.

| Field | Meaning |
|-------|---------|
| **Guarantee badge** | Active/invalidated state from nirs4all, selected coverage, effective engine, requested-engine mismatch when present, invalidation reasons, and declared limitations. |
| **Coverage strip** | Visual projection of the calibrated, selected and materialized coverage levels. Marker positions are presentational and derived from the coverages already listed in the artifact; unavailable calibrated levels keep `qhat` and width empty. |
| **Coverage metrics** | Optional attached `ConformalMetricSet` rows, displayed as target coverage, observed coverage, coverage gap, width, interval score and missed-above/below counts. Studio validates and displays these rows but does not recompute observed coverage or interval scores. |
| **Metrics CSV** | Downloads the attached coverage metric rows as a stable CSV with target coverage, observed coverage, gap, gap direction, widths, interval score, covered count, misses and unit. |
| **Coverage chips** | Calibrated, selected and materialized interval levels. Studio only shows levels already present in the artifact. |
| **Interval summaries** | Per-coverage `qhat`, mean interval width and sample count, computed from the attached interval arrays for display only. |
| **Calibration replay provenance** | Optional `calibration_replay_source` from nirs4all, read first from guarantee metadata and then from artifact metadata: provided arrays, `PredictResult`, dataset-backed `y_pred`, `predictor`, `predictor_bundle`, `predictor_result`, or `predictor_chain_id`, including the route such as `predictor.predict` or `nirs4all.predict`. |
| **Tuning calibration provenance** | Optional `tuning_calibration_source` from nirs4all. For native tuning winners, Studio labels `source=tuning.winner` with `score_data_used=false` as “tuning winner; score_data ranked trials only”, making clear that HPO `score_data` selected the winner but was not reused as conformal calibration data. |
| **Fingerprint** | Calibrated result fingerprint used for audit and reload checks. |

:::{important}
Studio reads the conformal artifact produced by nirs4all. It does not recalibrate, refit, select new interval levels, replay the calibration source locally from `calibration_replay_source`, or reinterpret tuning provenance from `tuning_calibration_source`.
:::

---

## Native tuning results

When a run includes a native nirs4all tuning result or lightweight `nirs4all.tuning.summary` artifact, the result detail panel and chain detail panel can show a **Native tuning** section alongside the usual metrics and artifacts.

| Field | Meaning |
|-------|---------|
| **Optimizer** | The tuning backend recorded by nirs4all, such as Optuna or n4m. |
| **Direction and metric** | Whether the study minimized or maximized the selected metric. |
| **Best value** | The winning trial value, formatted like the metric used by the study. |
| **Sampler, pruner and seed** | Optional optimizer controls published by `TuningResult.summary_artifact()` and full tuning results when present. Missing values are shown as unavailable metadata, not inferred from trials. |
| **Persistence flags** | Metadata-only optimizer persistence state: whether resume was requested, whether storage was configured, whether optimizer-state resume is supported by the engine, and the study name. Studio never displays or persists the raw storage URI from tuning artifacts. |
| **Best params** | The parameter values selected by the native optimizer. |
| **Trial status timeline** | Compact status strip showing completed, failed, pruned, or running trials in recorded order. |
| **Trial rows** | A compact list of trial numbers, statuses, values, and parameter summaries when the full `TuningResult` is attached. Lightweight `tuning.summary` artifacts expose only trial number, status, and value. |
| **Trials CSV** | Downloads the recorded trial table with trial number, status, value, winner flag, params JSON, and diagnostics JSON. |

:::{important}
Studio reads the attached `TuningResult` or `TuningResult.summary_artifact()` payload. It does not rerun the optimizer, change the winner, infer missing trials locally, or fabricate params/diagnostics that are not present in the lightweight summary.
:::

---

## Native robustness summaries

When a run carries a native robustness launch plan, the result detail panel can show a **Robustness launch plan** section before any report exists. This section echoes the `robustness.mode`, requested `robustness.scenarios`, severities, distributions, optional `slice_by` fields, and optional `publish_evidence.spectral_replay` publication intent that Studio transported at launch time. Completed pipeline rows may also carry a `robustness_evidence_publication_trace` in their native result references. That trace records whether Studio saw the publication request, how many prediction rows were republished with replay evidence, and whether an exported predictor bundle path was available. It is audit metadata; actual replay readiness is still derived from prediction-array `X`/spectra and `result_metadata.robustness_evidence.predictor_bundle`.

For backend handoff, the execution job metadata can also contain `robustness_evidence_publication_handoff`. That object is the machine-readable driver contract for `publish_evidence.spectral_replay`: it records the destination, the fail-closed rule, the fields a driver should publish, and the accepted row-alignment strategies (`sample_indices`, full-dataset length, unique metadata identifiers, or explicit relation materialization identifiers). It is not proof that evidence exists; the proof remains the stored prediction arrays and bundle metadata.

The launch plan is metadata only. It proves what was requested and handed to execution drivers, but it is not a robustness report and does not contain metrics. Each scenario is tagged as `baseline`, `prediction_replay`, or `spectral_replay`; spectral replay scenarios show an extra reminder that row-aligned `X` spectra and a frozen predictor replay surface are required. When Studio has a launch plan but no attached report, it also shows a robustness execution status such as `needs_prediction_evidence` or `needs_spectral_replay_evidence`. These statuses explain which native evidence is still missing before `nirs4all.robustness()` can produce a verified `RobustnessReport`: row-aligned `PredictResult` or `CalibratedRunResult`, `y_true`, and, for spectral scenarios, the original `X` matrix plus a frozen predictor replay surface.

When a verified robustness summary artifact is attached, the launch plan status becomes `reported`. This means Studio found a `RobustnessReport` artifact produced by nirs4all; it still does not recompute or mutate the report locally.

When a run or chain includes a native nirs4all robustness summary, the result detail panel and chain detail panel can also show a **Robustness summary** section next to metrics, conformal, and tuning artifacts. Studio attaches these summaries both from direct run responses and from workspace-backed chain summary endpoints, so the section remains available after a workspace reload when the report artifact is still present in the nirs4all store. If the `summary.json` carries `conformal_guarantee_status`, Studio shows the same explicit guarantee badge used by conformal prediction views: active or invalidated status, selected coverage, effective engine, and invalidation reasons when present. If it carries `spectral_replay`, Studio also shows the replay provenance: in-memory predictor or saved bundle, replay route, saved bundle path when applicable, and whether sample ids were forwarded. Per-scenario cards display the summary-row execution scope when available (`baseline`, `prediction replay`, or `spectral/OOD replay`) and mark rows that require spectral/OOD replay evidence. Those badges are read from the artifact; Studio does not derive them from robustness metric rows or execute local replay. The section also includes a degradation heatmap, degradation matrix, and worst-slices table: the heatmap normalizes RMSE delta, MAE delta, and coverage-gap cells per metric for quick visual comparison, the matrix lists each recorded scenario's RMSE delta, MAE delta, coverage status, and worst-slice label from the summary rows, and the worst-slices table expands the scenario/slice/metric/value diagnostics carried by nirs4all. These views are compact visualizations of the attached report, not recomputations of robustness.

Studio can also request a native audit-only report for one stored prediction when that prediction already has row-aligned `y_true` and `y_pred` arrays. In the chain detail panel, the **Native robustness report** card always lets you choose stored-prediction scenarios such as `observed`, `prediction_bias`, and `prediction_noise`; when the selected prediction also carries row-aligned `X`/spectra plus a saved `predictor_bundle`/`model_path`, the same select exposes spectral/OOD scenarios such as `spectral_noise`, `spectral_shift`, `spectral_scale`, `spectral_offset`, and `spectral_slope`. Studio first reads those proofs from the prediction arrays themselves, then from published prediction/chain/pipeline metadata such as `result_metadata.robustness_evidence`, `metadata`, `runtime_manifest`, `native_result_refs`, `artifact_refs`, or `fold_artifacts`. Pipeline launches can request this publication explicitly with `robustness.publish_evidence.spectral_replay`; when the run exported a bundle, the Studio run driver republishes row-aligned `X` into the prediction-array sidecar and writes `result_metadata.robustness_evidence.predictor_bundle` only if rows align by stored `sample_indices`, by full-dataset coverage, by unique metadata identifiers such as `sample_id`, `physical_sample_id`, `row_id`, `unit_id`, or `observation_id`, or by explicit row-aligned identifiers in `result_metadata.relation_replay_manifest.materialization_manifest` / `relation_materialization_manifest`. Chain Detail remains fail-closed if any row cannot be aligned, if identifiers are duplicated or ambiguous, or if the bundle is missing. The scenario options and unavailable-scenario list are derived from the live nirs4all keyword registry when Studio can load it, with an explicit local fallback for offline/error states; Studio then filters that vocabulary through the backend evidence preflight and never invents spectral replay support locally. The same card lists registry-known scenarios that remain unavailable for the selected prediction, with the reason they are blocked. It also shows a dedicated **Spectral/OOD replay preflight** panel for the selected prediction: badges distinguish prediction-space readiness from spectral/OOD readiness, an evidence counter shows how many required inputs are present, stored-prediction and spectral scenario families are listed separately, and each requirement is displayed as present or missing with its source and detail. The panel now includes a **Native replay handoff plan** with three explicit steps: stored-prediction audit availability, spectral/OOD replay evidence, and native robustness handoff. Blockers remain listed explicitly. This preflight is diagnostic and fail-closed; spectral execution through the backend is accepted only when the stored arrays or published pipeline metadata carry row-aligned `X`/spectra and a saved `predictor_bundle`/`model_path`, and the UI exposes those scenario choices only in that ready state. The button calls the backend robustness-report endpoint, which delegates to `nirs4all.robustness()`, persists a real nirs4all `RobustnessReport` in the workspace, and immediately displays the returned summary. Once a report has been persisted, the card exposes **Export JSON**, **Export Markdown**, and **Export HTML** actions. The persisted workspace record also keeps the requested robustness plan, seed, scenario kinds, prediction id, and stored prediction context so later exports can audit which evidence produced the report. Studio's backend republishes the verified report without recomputing it, using the same `RobustnessReport` export methods from nirs4all. When Studio reattaches the report as a chain artifact, the same audit payload is exposed under the robustness artifact metadata, and the chain **Artifacts and provenance** panel shows a compact audit line with mode, scenarios, seed, prediction id, and context. That panel also exposes JSON, Markdown, and HTML exports for any attached robustness summary artifact, so reports remain exportable after a workspace reload. `observed` always uses severity `0`, `prediction_bias` applies a deterministic prediction offset, and `prediction_noise`/`spectral_noise` expose a distribution selector derived from the registry: `normal` uses seeded Gaussian noise with severity as sigma, while `uniform` uses bounded centered noise in `[-severity, +severity]`. Spectral scenarios require explicit `X` spectra and a frozen saved predictor replay surface.

| Field | Meaning |
|-------|---------|
| **Launch plan** | The native `robustness` payload transported by Studio, including `mode`, scenarios, severity, distribution, slices, and optional `publish_evidence.spectral_replay` evidence-publication intent. |
| **Scenario replay scope** | Per-scenario label: `baseline` for `observed`, `prediction_replay` for prediction-space scenarios, and `spectral_replay` for scenarios that require `X` plus a frozen predictor. |
| **Execution status** | Diagnostic status for the transported plan: `needs_prediction_evidence`, `needs_spectral_replay_evidence`, or `reported`. Missing evidence is listed as blockers. |
| **Spectral/OOD replay preflight** | Per-prediction diagnostic with readiness badges, present/total evidence count, stored-prediction scenario list, spectral/OOD scenario list, native replay handoff steps, and requirement cards for stored `y_true`, stored `y_pred`, row-aligned `X`/spectra, and frozen predictor evidence. Missing evidence blocks spectral/OOD scenarios. |
| **Mode and report version** | The robustness evaluation mode recorded by nirs4all, plus the summary report version. |
| **Conformal guarantee badge** | Optional `conformal_guarantee_status` carried by the robustness `summary.json`: active/invalidated state, selected coverage, effective engine, and invalidation reasons. |
| **Spectral replay provenance** | Optional `spectral_replay` carried by the robustness `summary.json`: source, route, saved bundle path and sample-id forwarding status. Studio displays it as metadata and does not replay spectra locally. |
| **Slices** | Metadata slices used by the robustness report, when available. |
| **Degradation matrix** | Metadata-only compact view of each scenario's `rmse_delta`, `mae_delta`, coverage status, and worst-slice label from `summary.json`. |
| **Worst-slices table** | Dedicated scenario/slice/metric/value table for the worst slice diagnostics already present in `summary.json`; Studio does not recompute slice metrics. |
| **Scenario cards** | One compact row per scenario with severity, sample count, RMSE, MAE, bias, coverage status, and worst slice. |
| **Coverage status** | The status computed by nirs4all from the robustness report summary. It is descriptive and does not create a new conformal guarantee. |
| **Scenarios CSV** | Downloads stable scenario rows with scenario identity, severity, sample count, metrics, coverage fields, worst-slice label/metric/value, and worst-slice JSON. |
| **Report export** | The persisted report can be republished as `json`, `markdown`, or `html`; Studio loads the verified workspace report and does not rerun robustness. |

:::{important}
Studio reads or explicitly asks nirs4all to produce robustness artifacts. It does not rerun perturbations locally, recompute coverage in the UI, infer robustness guarantees, or synthesize missing `y_true`, spectra, or predictors.
:::

---

## Export

| Action | Description |
|--------|-------------|
| **Export CSV** | Exports the full results table (all datasets, all chains) as a CSV file to the workspace `exports/` directory. |
| **View in Aggregated Results** | Link to the Aggregated Results page for cross-dataset comparison and advanced filtering. |

---

## Interaction with other pages

- **From History**: After an experiment completes, the History page provides a "View Results" link that navigates here.
- **To Aggregated Results**: The Results page links to the Aggregated Results page for deeper analysis.
- **To Predictions**: Individual chains can be selected to generate predictions on new data via the Predictions page.

:::{tip}
If you have run the same pipeline on multiple datasets, use the search bar to quickly locate a specific dataset's results. For cross-dataset comparison, use the Aggregated Results page instead.
:::

:::{seealso}
- {doc}`history-page` -- Viewing all experiment runs
- {doc}`run-progress-page` -- Monitoring experiments in real time
- {doc}`experiment-wizard` -- Creating new experiments
:::
