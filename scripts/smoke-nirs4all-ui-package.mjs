const [root, score, runtime, conformal, robustness, keywordRegistry, tuning, components] = await Promise.all([
  import("nirs4all-ui"),
  import("nirs4all-ui/score"),
  import("nirs4all-ui/runtime"),
  import("nirs4all-ui/conformal"),
  import("nirs4all-ui/robustness"),
  import("nirs4all-ui/keywordRegistry"),
  import("nirs4all-ui/tuning"),
  import("nirs4all-ui/components"),
]);

const checks = {
  "root.score": root.score,
  "root.runtime": root.runtime,
  "root.conformal": root.conformal,
  "root.robustness": root.robustness,
  "root.keywordRegistry": root.keywordRegistry,
  "root.tuning": root.tuning,
  "root.components": root.components,
  "score.canonicalMetricKey": score.canonicalMetricKey,
  "score.formatMetricValue": score.formatMetricValue,
  "runtime.getRuntimeResultStatusDisplay": runtime.getRuntimeResultStatusDisplay,
  "runtime.runtimeEngineLabel": runtime.runtimeEngineLabel,
  "conformal.parseCalibratedRunResultArtifact": conformal.parseCalibratedRunResultArtifact,
  "conformal.parseConformalMetricSet": conformal.parseConformalMetricSet,
  "conformal.createConformalCoverageOptions": conformal.createConformalCoverageOptions,
  "conformal.createConformalCoverageStrip": conformal.createConformalCoverageStrip,
  "conformal.createConformalGuaranteeView": conformal.createConformalGuaranteeView,
  "conformal.createConformalIntervalSummaryRows": conformal.createConformalIntervalSummaryRows,
  "conformal.createConformalMetricRows": conformal.createConformalMetricRows,
  "conformal.createConformalPredictionRows": conformal.createConformalPredictionRows,
  "conformal.formatCalibrationReplaySource": conformal.formatCalibrationReplaySource,
  "conformal.getCalibrationReplaySource": conformal.getCalibrationReplaySource,
  "robustness.parseRobustnessSummaryArtifact": robustness.parseRobustnessSummaryArtifact,
  "robustness.createRobustnessSummaryCards": robustness.createRobustnessSummaryCards,
  "robustness.createRobustnessDegradationHeatmap": robustness.createRobustnessDegradationHeatmap,
  "robustness.createRobustnessWorstSliceRows": robustness.createRobustnessWorstSliceRows,
  "robustness.validateRobustnessScenarioDraft": robustness.validateRobustnessScenarioDraft,
  "robustness.getRobustnessModeOptions": robustness.getRobustnessModeOptions,
  "robustness.getRobustnessModeOptionsFromRegistry": robustness.getRobustnessModeOptionsFromRegistry,
  "robustness.getRobustnessScenarioKindOptionsFromRegistry": robustness.getRobustnessScenarioKindOptionsFromRegistry,
  "robustness.getRobustnessScenarioKindOptions": robustness.getRobustnessScenarioKindOptions,
  "robustness.getRobustnessScenarioDistributionOptions": robustness.getRobustnessScenarioDistributionOptions,
  "robustness.getRobustnessScenarioDistributionOptionsFromRegistry": robustness.getRobustnessScenarioDistributionOptionsFromRegistry,
  "keywordRegistry.parseKeywordRegistryDocument": keywordRegistry.parseKeywordRegistryDocument,
  "keywordRegistry.createKeywordRegistryFieldViews": keywordRegistry.createKeywordRegistryFieldViews,
  "keywordRegistry.createKeywordRegistryFormSections": keywordRegistry.createKeywordRegistryFormSections,
  "keywordRegistry.createKeywordRegistryOptimizerPersistenceFields": keywordRegistry.createKeywordRegistryOptimizerPersistenceFields,
  "keywordRegistry.findKeywordRegistryEntriesByScope": keywordRegistry.findKeywordRegistryEntriesByScope,
  "keywordRegistry.getKeywordRegistryValueOptions": keywordRegistry.getKeywordRegistryValueOptions,
  "keywordRegistry.resolveKeywordRegistryEntry": keywordRegistry.resolveKeywordRegistryEntry,
  "tuning.parseTuningResultArtifact": tuning.parseTuningResultArtifact,
  "tuning.parseTuningSummaryArtifact": tuning.parseTuningSummaryArtifact,
  "tuning.createTuningStudySummary": tuning.createTuningStudySummary,
  "tuning.createTuningSummaryCard": tuning.createTuningSummaryCard,
  "tuning.createTuningTrialRows": tuning.createTuningTrialRows,
  "tuning.createTuningSummaryTrialRows": tuning.createTuningSummaryTrialRows,
  "tuning.parseOrderedTuningSearchSpaceArtifact": tuning.parseOrderedTuningSearchSpaceArtifact,
  "tuning.createTuningSearchSpacePreview": tuning.createTuningSearchSpacePreview,
  "components.RuntimeDiagnosticList": components.RuntimeDiagnosticList,
  "components.RuntimeEngineBadge": components.RuntimeEngineBadge,
  "components.RuntimeResultStatusBadge": components.RuntimeResultStatusBadge,
};

for (const [name, value] of Object.entries(checks)) {
  if (value == null) {
    throw new Error(`Missing nirs4all-ui export: ${name}`);
  }
}

if (score.canonicalMetricKey("RMSEP") !== "rmse") {
  throw new Error("nirs4all-ui/score canonicalMetricKey smoke failed");
}

if (runtime.runtimeEngineLabel({ executed: true }) !== "executed by dag-ml") {
  throw new Error("nirs4all-ui/runtime runtimeEngineLabel smoke failed");
}

const calibratedArtifact = conformal.parseCalibratedRunResultArtifact({
  artifact: {
    calibration_size: 4,
    qhat_by_coverage: [{ coverage: 0.8, qhat: 0.5 }],
    spec: {
      coverage: [0.8],
      group_by: [],
      method: "split_absolute_residual",
      multi_target: "marginal",
      unit: "physical_sample",
    },
  },
  fingerprint: "tcv1-conformal",
  metadata: {
    conformal_guarantee_status: {
      artifact_fingerprint: "artifact-fp",
      calibrated_coverages: [0.8],
      calibration_data_fingerprint: "calibration-data-fp",
      calibration_replay_source: {
        dataset_backed: true,
        kind: "dataset_predictor_bundle",
        predictor_bundle: "model.n4a",
        requires_model_replay: true,
        route: "nirs4all.predict",
        version: 1,
      },
      coverage: [0.8],
      effective_engine: "nirs4all.conformal.v1",
      guarantee: "split_conformal_marginal_coverage",
      invalidation_reasons: [],
      limitations: ["finite-sample marginal coverage requires exchangeable calibration and prediction samples"],
      method: "split_absolute_residual",
      multi_target: "marginal",
      predictor_fingerprint: null,
      requested_engine: "nirs4all.conformal.v1",
      scope: "finite_sample_marginal_exchangeability",
      source_calibrated_result_fingerprint: null,
      status: "active",
      unit: "physical_sample",
      version: 1,
    },
  },
  prediction: {
    intervals: [{ coverage: 0.8, lower: [0, 1], qhat: 0.5, upper: [1, 2] }],
    method: "split_absolute_residual",
    unit: "physical_sample",
    y_pred: [0.5, 1.5],
  },
  sample_ids: ["pred-a", "pred-b"],
  version: 1,
});

if (conformal.createConformalGuaranteeView(conformal.getConformalGuaranteeStatus(calibratedArtifact)).tone !== "success") {
  throw new Error("nirs4all-ui/conformal guarantee view smoke failed");
}

if (conformal.getCalibrationReplaySource(calibratedArtifact)?.kind !== "dataset_predictor_bundle") {
  throw new Error("nirs4all-ui/conformal calibration replay source smoke failed");
}

if (conformal.createConformalGuaranteeView(conformal.getConformalGuaranteeStatus(calibratedArtifact)).calibrationReplayLabel !== "dataset predictor bundle via nirs4all.predict") {
  throw new Error("nirs4all-ui/conformal calibration replay label smoke failed");
}

if (conformal.createConformalIntervalSummaryRows(calibratedArtifact)[0]?.meanWidth !== 1) {
  throw new Error("nirs4all-ui/conformal interval summary smoke failed");
}

if (conformal.createConformalCoverageOptions(calibratedArtifact)[0]?.selected !== true) {
  throw new Error("nirs4all-ui/conformal coverage options smoke failed");
}

if (conformal.createConformalCoverageStrip(
  conformal.createConformalCoverageOptions(calibratedArtifact),
  conformal.createConformalIntervalSummaryRows(calibratedArtifact),
)[0]?.tone !== "selected") {
  throw new Error("nirs4all-ui/conformal coverage strip smoke failed");
}

if (conformal.createConformalPredictionRows(calibratedArtifact)[0]?.sampleId !== "pred-a") {
  throw new Error("nirs4all-ui/conformal prediction rows smoke failed");
}

const metricRows = conformal.createConformalMetricRows([
  conformal.parseConformalMetricSet({
    coverage: 0.8,
    coverage_gap: -0.05,
    fingerprint: "metric-fp",
    mean_interval_score: 1.5,
    mean_width: 1.25,
    median_width: 1,
    n_covered: 3,
    n_missed_above: 0,
    n_missed_below: 1,
    n_samples: 4,
    observed_coverage: 0.75,
    unit: "physical_sample",
    version: 1,
  }),
]);

if (metricRows[0]?.coverageGapDirection !== "under") {
  throw new Error("nirs4all-ui/conformal metric rows smoke failed");
}

if (robustness.ROBUSTNESS_SUMMARY_FORMAT !== "nirs4all.robustness.summary") {
  throw new Error("nirs4all-ui/robustness summary format smoke failed");
}

const robustnessSummaryArtifact = robustness.parseRobustnessSummaryArtifact({
  conformal_guarantee_status: calibratedArtifact.metadata.conformal_guarantee_status,
  fingerprint: "robustness-fp",
  format: "nirs4all.robustness.summary",
  mode: "clean_frozen",
  report_version: 1,
  schema_version: 1,
  slice_by: ["batch"],
  spectral_replay: {
    all_predictions: false,
    predictor_bundle: "model.n4a",
    route: "nirs4all.predict",
    sample_ids_forwarded: true,
    source: "predictor_bundle",
  },
  summary: [{
    bias: 0.01,
    conformal_max_abs_coverage_gap: 0.12,
    conformal_mean_width_mean: 0.31,
    conformal_min_observed_coverage: 0.85,
    delta_bias: 0,
    delta_mae: 0.03,
    delta_max_abs_error: 0.05,
    delta_rmse: 0.04,
    mae: 0.11,
    mae_ratio: 1.2,
    max_abs_error: 0.42,
    n_samples: 24,
    rmse: 0.18,
    rmse_ratio: 1.3,
    scenario: { distribution: "uniform", kind: "prediction_noise" },
    scenario_index: 1,
    scenario_label: "prediction noise (distribution=uniform)",
    severity: 0.4,
    worst_slice_key: { batch: "A" },
    worst_slice_label: "batch=A",
    worst_slice_metric: "rmse",
    worst_slice_value: 0.18,
  }],
});

if (robustness.getRobustnessSpectralReplay(robustnessSummaryArtifact)?.predictor_bundle !== "model.n4a") {
  throw new Error("nirs4all-ui/robustness spectral replay provenance smoke failed");
}

if (robustness.createRobustnessSummaryCards(robustnessSummaryArtifact)[0]?.distribution !== "uniform") {
  throw new Error("nirs4all-ui/robustness scenario distribution projection smoke failed");
}

const robustnessDegradationRows = robustness.createRobustnessDegradationRows([{
  bias: 0.01,
  coverage: {
    maxAbsGap: 0.12,
    meanWidth: 0.31,
    minObserved: 0.85,
  },
  distribution: "uniform",
  mae: 0.11,
  maeDelta: 0.03,
  maxAbsError: 0.42,
  nSamples: 24,
  rmse: 0.18,
  rmseDelta: 0.04,
  scenario: { distribution: "uniform", kind: "prediction_noise" },
  scenarioIndex: 1,
  scenarioLabel: "prediction noise (distribution=uniform)",
  severity: 0.4,
  status: "warning",
  worstSlice: {
    key: { batch: "A" },
    label: "batch=A",
    metric: "rmse",
    value: 0.18,
  },
}]);

if (
  robustnessDegradationRows[0]?.rmseDeltaLabel !== "+0.04"
  || robustnessDegradationRows[0]?.coverageStatusLabel !== "Coverage warning"
) {
  throw new Error("nirs4all-ui/robustness degradation rows smoke failed");
}

if (robustness.createRobustnessDegradationHeatmap(robustness.createRobustnessSummaryCards(robustnessSummaryArtifact))[0]?.metric !== "rmse_delta") {
  throw new Error("nirs4all-ui/robustness degradation heatmap smoke failed");
}

if (robustness.createRobustnessWorstSliceRows(robustness.createRobustnessSummaryCards(robustnessSummaryArtifact))[0]?.sliceLabel !== "batch=A") {
  throw new Error("nirs4all-ui/robustness worst-slice rows smoke failed");
}

if (!robustness.ROBUSTNESS_SCENARIO_KINDS.includes("spectral_shift")) {
  throw new Error("nirs4all-ui/robustness scenario vocabulary smoke failed");
}

if (robustness.ROBUSTNESS_EXECUTABLE_MODES.join("|") !== "clean_frozen") {
  throw new Error("nirs4all-ui/robustness executable mode vocabulary smoke failed");
}

if (robustness.validateRobustnessScenarioDraft({ kind: "spectral_shift", distribution: "normal" })[0]?.code !== "distribution_not_allowed") {
  throw new Error("nirs4all-ui/robustness scenario validation smoke failed");
}

const robustnessRegistry = {
  entries: [
    {
      aliases: [],
      canonical_term: "robustness_mode",
      changes: ["robustness_results"],
      docs_anchor: "planned-robustness-campaigns",
      engine_support: { "dag-ml": "partial", legacy: "unsupported" },
      id: "robustness.mode",
      invalidates_calibration: "mode_dependent",
      lifecycle_stage: "robustness",
      path: "robustness.mode",
      reads: ["external_test_or_production"],
      scope: "robustness_campaign",
      status: "partial",
      summary: "Selects the robustness execution mode.",
      surface: "robustness_argument",
      token: "mode",
      ui: { control: "select", group: "robustness", label: "Robustness mode", order: 210 },
      value_schema: {
        enum: ["clean_frozen", "matched_recalibration", "future_mode"],
        type: "string",
        "x-executable-values": ["clean_frozen"],
      },
    },
    {
      aliases: [],
      canonical_term: "robustness_scenarios",
      changes: ["robustness_results"],
      docs_anchor: "planned-robustness-campaigns",
      engine_support: { "dag-ml": "partial", legacy: "unsupported" },
      id: "robustness.scenarios",
      invalidates_calibration: "mode_dependent",
      lifecycle_stage: "robustness",
      path: "robustness.scenarios",
      reads: ["external_test_or_production"],
      scope: "robustness_campaign",
      status: "partial",
      summary: "Defines report cells for robustness diagnostics.",
      surface: "robustness_argument",
      token: "scenarios",
      ui: { control: "array", group: "robustness", label: "Robustness scenarios", order: 220 },
      value_schema: {
        items: {
          properties: {
            distribution: { enum: ["normal", "uniform"], type: "string" },
            kind: { enum: ["observed", "prediction_noise", "spectral_shift"], type: "string" },
          },
          required: ["kind"],
          type: "object",
        },
        minItems: 1,
        type: "array",
      },
    },
  ],
  registry_version: "1.0.0",
  schema_id: "https://nirs4all.org/schemas/keyword-effects/v1",
  schema_version: 1,
  scope: "lifecycle-v1",
};

const robustnessModeOptions = robustness.getRobustnessModeOptionsFromRegistry(robustnessRegistry);
if (robustnessModeOptions.map((option) => `${option.value}:${option.executable}`).join("|") !== "clean_frozen:true|matched_recalibration:false") {
  throw new Error("nirs4all-ui/robustness registry-derived mode vocabulary smoke failed");
}

if (robustness.getRobustnessScenarioKindOptionsFromRegistry(robustnessRegistry).map((option) => option.value).join("|") !== "observed|prediction_noise|spectral_shift") {
  throw new Error("nirs4all-ui/robustness registry-derived scenario vocabulary smoke failed");
}

if (robustness.getRobustnessScenarioDistributionOptionsFromRegistry(robustnessRegistry, "prediction_noise")[0]?.disabled !== false) {
  throw new Error("nirs4all-ui/robustness registry-derived stochastic distribution smoke failed");
}

if (robustness.getRobustnessScenarioDistributionOptionsFromRegistry(robustnessRegistry, "spectral_shift")[0]?.disabled !== true) {
  throw new Error("nirs4all-ui/robustness registry-derived deterministic distribution smoke failed");
}

const registry = keywordRegistry.parseKeywordRegistryDocument({
  entries: [
    {
      aliases: [{ canonical: "engine", kind: "token", mode: "read_only", name: "backend" }],
      canonical_term: "execution_backend",
      changes: ["execution_backend"],
      docs_anchor: "execution-engine-versus-optimizer-engine",
      engine_support: { "dag-ml": "partial", legacy: "supported" },
      id: "run.engine",
      invalidates_calibration: "if_predictor_changes",
      lifecycle_stage: "execution",
      path: "run.engine",
      reads: [],
      scope: "pipeline_execution",
      status: "supported",
      summary: "Selects the pipeline execution backend.",
      surface: "run_argument",
      token: "engine",
      ui: { control: "select", group: "execution", label: "Execution backend", order: 10 },
      value_schema: { enum: [null, "legacy", "dag-ml", "dual"], type: ["string", "null"] },
    },
    {
      aliases: [],
      canonical_term: "optimizer_storage_uri",
      changes: ["optimizer_state"],
      docs_anchor: "planned-full-dag-tuning",
      engine_support: { "dag-ml": "partial", n4m: "unsupported", optuna: "supported" },
      id: "run.tuning.storage",
      invalidates_calibration: "not_applicable",
      lifecycle_stage: "storage",
      path: "run.tuning.storage",
      reads: ["optimizer_state"],
      scope: "optimizer_persistence",
      status: "partial",
      summary: "Optuna optimizer-state storage URI.",
      surface: "nested_key",
      token: "storage",
      ui: { control: "text", group: "tuning", label: "Optuna storage URI", order: 254 },
      value_schema: { minLength: 1, pattern: "^[A-Za-z][A-Za-z0-9+.-]*://", type: "string" },
    },
    {
      aliases: [],
      canonical_term: "optimizer_study_name",
      changes: ["optimizer_state"],
      docs_anchor: "planned-full-dag-tuning",
      engine_support: { "dag-ml": "partial", n4m: "unsupported", optuna: "supported" },
      id: "run.tuning.study_name",
      invalidates_calibration: "not_applicable",
      lifecycle_stage: "storage",
      path: "run.tuning.study_name",
      reads: ["optimizer_state"],
      scope: "optimizer_persistence",
      status: "partial",
      summary: "Optuna study name.",
      surface: "nested_key",
      token: "study_name",
      ui: { control: "text", group: "tuning", label: "Optuna study name", order: 255 },
      value_schema: { minLength: 1, pattern: "^[^\\u0000]+$", type: "string" },
    },
  ],
  registry_version: "1.0.0",
  schema_id: "https://nirs4all.org/schemas/keyword-effects/v1",
  schema_version: 1,
  scope: "lifecycle-v1",
});

if (keywordRegistry.createKeywordRegistryFieldViews(registry)[0]?.id !== "run.engine") {
  throw new Error("nirs4all-ui/keywordRegistry field projection smoke failed");
}

if (keywordRegistry.resolveKeywordRegistryEntry(registry, { alias: "backend" })?.id !== "run.engine") {
  throw new Error("nirs4all-ui/keywordRegistry alias resolution smoke failed");
}

if (keywordRegistry.createKeywordRegistryFormSections(registry)[0]?.group !== "execution") {
  throw new Error("nirs4all-ui/keywordRegistry form section smoke failed");
}

if (keywordRegistry.getKeywordRegistryValueOptions(registry.entries[0]).map((option) => option.value).join("|") !== "|legacy|dag-ml|dual") {
  throw new Error("nirs4all-ui/keywordRegistry value options smoke failed");
}

if (keywordRegistry.findKeywordRegistryEntriesByScope(registry, "optimizer_persistence").map((entry) => entry.id).join("|") !== "run.tuning.storage|run.tuning.study_name") {
  throw new Error("nirs4all-ui/keywordRegistry scope filter smoke failed");
}

if (keywordRegistry.createKeywordRegistryOptimizerPersistenceFields(registry).map((field) => field.id).join("|") !== "run.tuning.storage|run.tuning.study_name") {
  throw new Error("nirs4all-ui/keywordRegistry optimizer persistence fields smoke failed");
}

const tuningArtifact = tuning.parseTuningResultArtifact({
  best_params: { alpha: 0.2 },
  best_value: 0.12,
  fingerprint: "tcv1-demo-tune",
  optimizer: "optuna",
  trials: [
    {
      diagnostics: { metric: "rmse" },
      number: 0,
      params: { alpha: 0.9 },
      state: "PRUNED",
      value: null,
    },
    {
      diagnostics: { metric: "rmse" },
      number: 1,
      params: { alpha: 0.2 },
      state: "COMPLETE",
      value: 0.12,
    },
  ],
  tuning: {
    direction: "minimize",
    engine: "optuna",
    metric: "rmse",
    n_trials: 2,
    pruner: "median",
    resume: false,
    sampler: "tpe",
    seed: 42,
    space: { alpha: [0.2, 0.9] },
    storage: null,
    study_name: "studio-tune",
  },
});

if (tuning.createTuningStudySummary(tuningArtifact).completeTrials !== 1) {
  throw new Error("nirs4all-ui/tuning study summary smoke failed");
}

if (tuning.createTuningTrialRows(tuningArtifact)[1]?.isBest !== true) {
  throw new Error("nirs4all-ui/tuning trial rows smoke failed");
}

const tuningSummaryArtifact = tuning.parseTuningSummaryArtifact({
  best_params: { alpha: 0.2 },
  best_value: 0.12,
  direction: "minimize",
  engine: "optuna",
  fingerprint: "tcv1-demo-tune",
  format: "nirs4all.tuning.summary",
  metric: "rmse",
  n_trials: 2,
  optimizer: "optuna",
  schema_version: 1,
  trial_states: { COMPLETE: 1, PRUNED: 1 },
  trials: [
    { number: 0, state: "PRUNED", value: null },
    { number: 1, state: "COMPLETE", value: 0.12 },
  ],
  version: 1,
});

if (tuning.createTuningSummaryCard(tuningSummaryArtifact).completeTrials !== 1) {
  throw new Error("nirs4all-ui/tuning summary artifact card smoke failed");
}

if (tuning.createTuningSummaryTrialRows(tuningSummaryArtifact)[1]?.status !== "complete") {
  throw new Error("nirs4all-ui/tuning summary artifact rows smoke failed");
}

const orderedSearchSpaceArtifact = tuning.parseOrderedTuningSearchSpaceArtifact({
  fingerprint: "ad5d4673e67321692f1635e3d8ed74efd3dbd26ad6ec236429d08c18f3466f5d",
  force_params: [
    {
      path: "model.n_components",
      segments: ["model", "n_components"],
      value: 6,
    },
    {
      path: "train.batch_size",
      segments: ["train", "batch_size"],
      value: 32,
    },
  ],
  format: "nirs4all.tuning.ordered_search_space",
  parameters: [
    {
      index: 0,
      path: "model.alpha",
      segments: ["model", "alpha"],
      spec: { high: 1, log: true, low: 0.0001, type: "log_float" },
    },
    {
      index: 1,
      path: "model.n_components",
      segments: ["model", "n_components"],
      spec: { high: 12, low: 2, step: 1, type: "int" },
    },
    {
      index: 2,
      path: "train.batch_size",
      segments: ["train", "batch_size"],
      spec: [16, 32, 64],
    },
  ],
  schema_version: 1,
  tuning_fingerprint: "97695b1bd406085eb72fbd254a7e1f348616729acfedf802099b0abb028da9ec",
});

const orderedSearchSpacePreview = tuning.createTuningSearchSpacePreview(orderedSearchSpaceArtifact);

if (
  orderedSearchSpacePreview.fingerprint !== "ad5d4673e67321692f1635e3d8ed74efd3dbd26ad6ec236429d08c18f3466f5d" ||
  orderedSearchSpacePreview.tuningFingerprint !== "97695b1bd406085eb72fbd254a7e1f348616729acfedf802099b0abb028da9ec"
) {
  throw new Error("nirs4all-ui/tuning ordered search-space Python fixture fingerprint smoke failed");
}

if (orderedSearchSpacePreview.parameterCount !== 3 || orderedSearchSpacePreview.forceParamCount !== 2) {
  throw new Error("nirs4all-ui/tuning ordered search-space preview smoke failed");
}

if (orderedSearchSpacePreview.parameters[1]?.forcedValueLabel !== "6" || orderedSearchSpacePreview.parameters[2]?.forcedValueLabel !== "32") {
  throw new Error("nirs4all-ui/tuning ordered search-space force-param label smoke failed");
}

if (tuning.isOrderedTuningSearchSpaceArtifact({ ...orderedSearchSpaceArtifact, force_params: [{ path: "missing.alpha", segments: ["missing", "alpha"], value: 1 }] })) {
  throw new Error("nirs4all-ui/tuning ordered search-space subset guard smoke failed");
}

console.log("nirs4all-ui package smoke passed");
