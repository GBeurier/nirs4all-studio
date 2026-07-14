import { describe, expect, it } from "vitest";
import {
  buildResultArtifactSummary,
  buildResultConformalSummary,
  buildResultExecutionTimeRows,
  buildResultHeaderStatus,
  buildResultLogRows,
  buildResultMetricCards,
  buildResultNativeResultsSummary,
  buildResultPipelineJson,
  buildResultPipelineJsonPayload,
  buildResultQuickFacts,
  buildResultRelatedLinks,
  buildResultRobustnessLaunchPlan,
  buildResultRobustnessSummary,
  buildResultScoreMetricCards,
  buildResultTuningSummary,
  getResultEmptyMetricsMessage,
  getResultExportModelDescription,
  getResultExportModelLabel,
  getResultExecutionLogs,
  getResultLogLineTone,
  hasResultMetrics,
} from "./resultDetailData";
import type { PipelineRun } from "@/types/runs";

function pipeline(overrides: Partial<PipelineRun> = {}): PipelineRun {
  return {
    id: "run-pipeline",
    pipeline_id: "pipe",
    pipeline_name: "PLS baseline",
    model: "PLS",
    preprocessing: "SNV",
    split_strategy: "KFold",
    status: "completed",
    progress: 100,
    metrics: { r2: 0.91, rmse: 0.12 },
    val_score: 0.13,
    test_score: 0.12,
    has_refit: true,
    is_final_model: true,
    started_at: "2026-06-28T10:00:00Z",
    completed_at: "2026-06-28T10:05:00Z",
    ...overrides,
  };
}

function conformalGuaranteeStatus(overrides: Record<string, unknown> = {}) {
  return {
    artifact_fingerprint: "robustness-artifact-fp",
    calibrated_coverages: [0.8, 0.95],
    calibration_data_fingerprint: "calibration-data-fp",
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
    ...overrides,
  };
}

describe("resultDetailData", () => {
  it("builds the JSON payload used by the detail sheet", () => {
    expect(buildResultPipelineJsonPayload(pipeline())).toEqual({
      name: "PLS baseline",
      model: "PLS",
      preprocessing: "SNV",
      split_strategy: "KFold",
      status: "completed",
      metrics: { r2: 0.91, rmse: 0.12 },
      val_score: 0.13,
      test_score: 0.12,
      has_refit: true,
      is_final_model: true,
      started_at: "2026-06-28T10:00:00Z",
      completed_at: "2026-06-28T10:05:00Z",
      artifact_refs: [{
        id: "pipeline-run:run-pipeline:metrics",
        kind: "metric_table",
        role: "primary-metrics",
        label: "Primary metrics",
        source: "pipeline-run",
        scope: "pipeline",
        status: "virtual",
        runId: "run-pipeline",
        pipelineId: "pipe",
        metric: null,
        format: "json",
        metadata: {
          metricKeys: ["r2", "rmse"],
          hasCvScore: true,
          hasTestScore: true,
        },
      }],
    });

    expect(JSON.parse(buildResultPipelineJson(pipeline()))).toMatchObject({
      name: "PLS baseline",
      status: "completed",
      metrics: { r2: 0.91 },
      artifact_refs: [
        expect.objectContaining({ kind: "metric_table", role: "primary-metrics" }),
      ],
    });
  });

  it("detects metrics and resolves empty-state copy", () => {
    expect(hasResultMetrics(pipeline({ metrics: undefined, score: null, val_score: null, test_score: null }))).toBe(false);
    expect(hasResultMetrics(pipeline({ metrics: undefined, score: 0.7, val_score: null, test_score: null }))).toBe(true);
    expect(getResultEmptyMetricsMessage("running")).toBe("Results will appear when training completes");
    expect(getResultEmptyMetricsMessage("queued")).toBe("Waiting to start...");
    expect(getResultEmptyMetricsMessage("failed")).toBe("No results available");
  });

  it("builds header status and quick facts", () => {
    expect(buildResultHeaderStatus(pipeline())).toEqual({
      label: "Completed",
      colorClass: "text-chart-1",
      bgClass: "bg-chart-1/10",
      iconClass: "",
      badgeVariant: "default",
      progress: null,
    });
    expect(buildResultHeaderStatus(pipeline({ status: "running", progress: 42 }))).toEqual({
      label: "Running",
      colorClass: "text-chart-2",
      bgClass: "bg-chart-2/10",
      iconClass: "animate-spin",
      badgeVariant: "secondary",
      progress: 42,
    });
    expect(buildResultQuickFacts(pipeline())).toEqual([
      { id: "model", label: "Model", value: "PLS", icon: "model" },
      { id: "preprocessing", label: "Preprocessing", value: "SNV", icon: "preprocessing" },
      { id: "split", label: "Split", value: "KFold", icon: "split" },
    ]);
  });

  it("builds metric cards for the result detail metrics tab", () => {
    expect(buildResultScoreMetricCards(pipeline())).toEqual([
      {
        id: "cv_score",
        label: "CV Score",
        value: 0.13,
        format: 4,
        icon: "target",
        variant: "secondary",
      },
      {
        id: "final_score",
        label: "Final Score",
        value: 0.12,
        format: 4,
        icon: "trophy",
        variant: "primary",
      },
    ]);

    expect(buildResultMetricCards(pipeline({
      metrics: { r2: 0.91, rmse: 0.12, mae: 0.08, rpd: 2.4, nrmse: 0.03 },
    }))).toEqual([
      { id: "r2", label: "R² Score", value: 0.91, format: 4, icon: "target", variant: "primary" },
      { id: "rmse", label: "RMSE", value: 0.12, format: 4, icon: "trending", variant: "secondary" },
      { id: "mae", label: "MAE", value: 0.08, format: 4, icon: "bar", variant: "default" },
      { id: "rpd", label: "RPD", value: 2.4, format: 2, icon: "trending", variant: "default" },
      { id: "nrmse", label: "nRMSE", value: 0.03, format: 4, icon: "bar", variant: "default" },
    ]);
  });

  it("builds legacy score cards when no CV score is present", () => {
    expect(buildResultMetricCards(pipeline({
      metrics: undefined,
      score: 0.77,
      score_metric: "accuracy",
      val_score: null,
    }))).toEqual([
      { id: "score", label: "ACCURACY", value: 0.77, format: 4, icon: "target", variant: "primary" },
    ]);
  });

  it("builds execution time rows and export copy", () => {
    expect(buildResultExecutionTimeRows(pipeline())).toEqual([
      { id: "started", label: "Started", value: "2026-06-28T10:00:00Z" },
      { id: "completed", label: "Completed", value: "2026-06-28T10:05:00Z" },
    ]);
    expect(buildResultExecutionTimeRows(pipeline({ started_at: undefined, completed_at: undefined }))).toEqual([]);
    expect(getResultExportModelLabel(true)).toBe("Export Final Model (.n4a)");
    expect(getResultExportModelLabel(false)).toBe("Export Model (.n4a)");
    expect(getResultExportModelDescription(true)).toBe("Exports the refit model trained on the full dataset");
    expect(getResultExportModelDescription(false)).toBeNull();
  });

  it("builds related links with encoded prediction targets", () => {
    expect(buildResultRelatedLinks(pipeline({ pipeline_name: "PLS & SNV" }), "Maize lot #1")).toEqual([
      {
        id: "predictions",
        label: "Predictions",
        to: "/predictions?dataset=Maize%20lot%20%231&config=PLS%20%26%20SNV",
        icon: "predictions",
      },
      {
        id: "runs",
        label: "Runs",
        to: "/runs",
        icon: "runs",
      },
    ]);
  });

  it("builds artifact summaries for result detail metrics", () => {
    expect(buildResultArtifactSummary(pipeline({
      config: { steps: [{ name: "SNV" }] },
      logs: ["[INFO] complete"],
      refit_model_id: "artifact-refit",
    }))).toEqual({
      totalCount: 4,
      totalCountLabel: "4 artifacts",
      kindItems: [
        { id: "kind:model", label: "Model", artifactCountLabel: "1 artifact" },
        { id: "kind:pipeline_config", label: "Pipeline configuration", artifactCountLabel: "1 artifact" },
        { id: "kind:metric_table", label: "Metric table", artifactCountLabel: "1 artifact" },
        { id: "kind:execution_log", label: "Execution log", artifactCountLabel: "1 artifact" },
      ],
      statusItems: [
        { id: "status:available", label: "Available", artifactCountLabel: "1 artifact" },
        { id: "status:virtual", label: "Virtual", artifactCountLabel: "3 artifacts" },
      ],
      groups: [{
        id: "source-scope:pipeline-run:pipeline",
        label: "Pipeline run / Pipeline",
        sourceLabel: "Pipeline run",
        scopeLabel: "Pipeline",
        artifactCountLabel: "4 artifacts",
        artifactLabels: [
          "Refit model",
          "Pipeline configuration",
          "Primary metrics",
          "Execution log",
        ],
      }],
      repositoryItems: [],
    });
  });

  it("includes repository provenance in artifact summaries", () => {
    const pipelineWithRepositoryArtifact = {
      ...pipeline({
        metrics: undefined,
        val_score: null,
        test_score: null,
        score: null,
      }),
      artifact_refs: [{
        id: "repo-entry",
        kind: "repository_entry",
        role: "manifest-entry",
        label: "Repository result manifest",
        source: "result-repository",
        scope: "campaign",
        status: "available",
        contentAddress: "sha256:1234567890abcdef1234567890abcdef",
        metadata: {
          repository_id: "repo-1",
          source_ref: "manifests/result.json",
        },
      }],
    } as PipelineRun & { artifact_refs: unknown[] };

    expect(buildResultArtifactSummary(pipelineWithRepositoryArtifact)).toEqual({
      totalCount: 1,
      totalCountLabel: "1 artifact",
      kindItems: [
        { id: "kind:repository_entry", label: "Repository entry", artifactCountLabel: "1 artifact" },
      ],
      statusItems: [
        { id: "status:available", label: "Available", artifactCountLabel: "1 artifact" },
      ],
      groups: [{
        id: "source-scope:result-repository:campaign",
        label: "Result repository / Campaign",
        sourceLabel: "Result repository",
        scopeLabel: "Campaign",
        artifactCountLabel: "1 artifact",
        artifactLabels: ["Repository result manifest"],
      }],
      repositoryItems: [{
        id: "repository-provenance:repo-entry",
        label: "Repository result manifest",
        sourceLabel: "Result repository",
        contentAddressLabel: "sha256:1234567890ab...abcdef",
        detailLabels: [
          "Content sha256:1234567890ab...abcdef",
          "Repository repo-1",
        "Source manifests/result.json",
      ],
    }],
    });

    expect(buildResultNativeResultsSummary(pipelineWithRepositoryArtifact)).toEqual({
      artifactCount: 1,
      artifactCountLabel: "1 artifact",
      hasNativeResults: true,
    });
  });

  it("builds robustness summary cards from an attached native summary artifact", () => {
    const robustnessSummary = {
      format: "nirs4all.robustness.summary",
      schema_version: 1,
      fingerprint: "robustness:abcdef1234567890",
      mode: "clean_frozen",
      report_version: 1,
      slice_by: ["batch"],
      conformal_guarantee_status: conformalGuaranteeStatus({
        status: "invalidated",
        invalidation_reasons: ["prediction fingerprint changed"],
      }),
      spectral_replay: {
        all_predictions: false,
        predictor_bundle: "models/spectral-model.n4a",
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
        execution_scope: "spectral_replay",
        mae: 0.11,
        mae_ratio: 1.2,
        max_abs_error: 0.42,
        n_samples: 24,
        requires_spectral_replay: true,
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
    };

    expect(buildResultRobustnessSummary(pipeline({
      artifact_refs: [{
        id: "robustness-summary",
        kind: "repository_entry",
        role: "robustness-summary",
        label: "Robustness summary",
        source: "result-repository",
        scope: "pipeline",
        status: "available",
        format: "json",
        metadata: {
          robustness_summary_artifact: robustnessSummary,
        },
      }],
    }))).toMatchObject({
      fingerprint: "robustness:abcdef1234567890",
      guarantee: {
        coverageLabel: "80%",
        effectiveEngine: "nirs4all.conformal.v1",
        invalidationReasons: ["prediction fingerprint changed"],
        label: "Invalidated conformal guarantee",
        status: "invalidated",
        tone: "error",
      },
      mode: "clean_frozen",
      reportVersion: 1,
      sliceBy: ["batch"],
      spectralReplay: {
        all_predictions: false,
        predictor_bundle: "models/spectral-model.n4a",
        route: "nirs4all.predict",
        sample_ids_forwarded: true,
        source: "predictor_bundle",
      },
      cards: [{
        distribution: "uniform",
        executionScope: "spectral_replay",
        requiresSpectralReplay: true,
        scenario: { distribution: "uniform", kind: "prediction_noise" },
        scenarioLabel: "prediction noise (distribution=uniform)",
        status: "warning",
        coverage: {
          minObserved: 0.85,
          maxAbsGap: 0.12,
        },
      }],
    });
  });

  it("builds robustness launch plan data without treating it as a computed report", () => {
    const launchPlan = buildResultRobustnessLaunchPlan(pipeline({
      metrics: undefined,
      score: null,
      test_score: null,
      val_score: null,
      robustness_plan: {
        mode: "clean_frozen",
        scenarios: [
          { distribution: "normal", kind: "prediction_noise", severity: 0.2 },
          { kind: "spectral_shift", severity: 1 },
        ],
        slice_by: ["batch"],
      },
    }));

    expect(launchPlan).toEqual({
      execution: null,
      mode: "clean_frozen",
      scenarioCount: 2,
      scenarios: [
        {
          distribution: "normal",
          executionScope: "prediction_replay",
          kind: "prediction_noise",
          label: "prediction noise",
          requiresSpectralReplay: false,
          severity: 0.2,
        },
        {
          distribution: null,
          executionScope: "spectral_replay",
          kind: "spectral_shift",
          label: "spectral shift",
          requiresSpectralReplay: true,
          severity: 1,
        },
      ],
      sliceBy: ["batch"],
    });
    expect(buildResultRobustnessSummary(pipeline({ robustness_plan: launchPlan }))).toBeNull();
    expect(hasResultMetrics(pipeline({
      metrics: undefined,
      score: null,
      test_score: null,
      val_score: null,
      robustness_plan: launchPlan,
    }))).toBe(true);
  });

  it("threads robustness execution diagnostics into the launch plan", () => {
    const launchPlan = buildResultRobustnessLaunchPlan(pipeline({
      robustness_plan: {
        mode: "clean_frozen",
        scenarios: [
          { kind: "spectral_shift", severity: 1 },
        ],
      },
      robustness_execution: {
        status: "needs_spectral_replay_evidence",
        message: "Robustness plan is transported, but no nirs4all RobustnessReport has been computed yet.",
        requires_y_true: true,
        requires_predictions: true,
        requires_X: true,
        requires_predictor: true,
        blockers: [
          "Studio has not yet materialized a row-aligned PredictResult or CalibratedRunResult plus y_true for this pipeline.",
          "At least one spectral scenario requires the original X matrix and a frozen predictor replay surface.",
        ],
      },
    }));

    expect(launchPlan?.execution).toEqual({
      blockers: [
        "Studio has not yet materialized a row-aligned PredictResult or CalibratedRunResult plus y_true for this pipeline.",
        "At least one spectral scenario requires the original X matrix and a frozen predictor replay surface.",
      ],
      message: "Robustness plan is transported, but no nirs4all RobustnessReport has been computed yet.",
      requiresPredictor: true,
      requiresPredictions: true,
      requiresSpectra: true,
      requiresTruth: true,
      status: "needs_spectral_replay_evidence",
    });
  });

  it("builds conformal summary data from an attached calibrated result artifact", () => {
    const calibratedResult = {
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
      fingerprint: "calibrated-result:abcdef1234567890",
      metadata: {
        conformal_guarantee_status: {
          artifact_fingerprint: "artifact-fp",
          calibrated_coverages: [0.8],
          calibration_data_fingerprint: "calibration-data-fp",
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
        calibration_replay_source: {
          dataset_backed: true,
          kind: "dataset_predictor_bundle",
          predictor_bundle: "model.n4a",
          requires_model_replay: true,
          route: "nirs4all.predict",
          version: 1,
        },
        tuning_calibration_source: {
          score_data_role: "hpo_objective_only",
          score_data_used: false,
          source: "tuning.winner",
        },
        conformal_metrics: [{
          coverage: 0.8,
          coverage_gap: -0.05,
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
        }],
      },
      prediction: {
        intervals: [{ coverage: 0.8, lower: [0, 1], qhat: 0.5, upper: [1, 2] }],
        method: "split_absolute_residual",
        unit: "physical_sample",
        y_pred: [0.5, 1.5],
      },
      sample_ids: ["pred-a", "pred-b"],
      version: 1,
    };

    const pipelineWithConformalOnly = pipeline({
      metrics: undefined,
      score: null,
      val_score: null,
      test_score: null,
      artifact_refs: [{
        id: "conformal-result",
        kind: "repository_entry",
        role: "conformal-calibrated-result",
        label: "Conformal calibrated result",
        source: "result-repository",
        scope: "pipeline",
        status: "available",
        format: "json",
        metadata: {
          conformal_calibrated_result: calibratedResult,
        },
      }],
    });

    expect(hasResultMetrics(pipelineWithConformalOnly)).toBe(true);
    expect(buildResultConformalSummary(pipelineWithConformalOnly)).toMatchObject({
      fingerprint: "calibrated-result:abcdef1234567890",
      guarantee: {
        calibrationReplayLabel: "dataset predictor bundle via nirs4all.predict",
        calibrationReplaySource: {
          dataset_backed: true,
          kind: "dataset_predictor_bundle",
          predictor_bundle: "model.n4a",
          requires_model_replay: true,
          route: "nirs4all.predict",
          version: 1,
        },
        tuningCalibrationLabel: "tuning winner; score_data ranked trials only",
        tuningCalibrationSource: {
          score_data_role: "hpo_objective_only",
          score_data_used: false,
          source: "tuning.winner",
        },
        coverageLabel: "80%",
        label: "Active conformal guarantee",
        status: "active",
        tone: "success",
      },
      coverages: [{
        calibrated: true,
        coverage: 0.8,
        disabled: false,
        label: "80%",
        materialized: true,
        selected: true,
      }],
      coverageStrip: [{
        coverage: 0.8,
        coverageLabel: "80%",
        meanWidthLabel: "1.0000",
        qhatLabel: "0.5000",
        selected: true,
        tone: "selected",
      }],
      intervals: [{
        coverage: 0.8,
        coverageLabel: "80%",
        meanWidth: 1,
        nSamples: 2,
        qhat: 0.5,
      }],
      metrics: [{
        coverage: 0.8,
        coverageGap: -0.05,
        coverageGapDirection: "under",
        coverageLabel: "80%",
        meanIntervalScore: 1.5,
        meanWidth: 1.25,
        missedAbove: 0,
        missedBelow: 1,
        nCovered: 3,
        nSamples: 4,
        observedCoverage: 0.75,
        observedCoverageLabel: "75%",
      }],
      method: "split_absolute_residual",
      nPredictions: 2,
      unit: "physical_sample",
    });
  });

  it("builds conformal summary data from a metadata-level replay source fallback", () => {
    const calibratedResult = {
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
      fingerprint: "calibrated-result:metadata-source",
      metadata: {
        conformal_guarantee_status: {
          artifact_fingerprint: "artifact-fp",
          calibrated_coverages: [0.8],
          calibration_data_fingerprint: "calibration-data-fp",
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
        calibration_replay_source: {
          dataset_backed: false,
          kind: "predict_result",
          requires_model_replay: false,
          route: "PredictResult",
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
    };

    const pipelineWithConformalOnly = pipeline({
      metrics: undefined,
      score: null,
      val_score: null,
      test_score: null,
      artifact_refs: [{
        id: "conformal-result",
        kind: "repository_entry",
        role: "conformal-calibrated-result",
        label: "Conformal calibrated result",
        source: "result-repository",
        scope: "pipeline",
        status: "available",
        format: "json",
        metadata: {
          conformal_calibrated_result: calibratedResult,
        },
      }],
    });

    expect(hasResultMetrics(pipelineWithConformalOnly)).toBe(true);
    expect(buildResultConformalSummary(pipelineWithConformalOnly)).toMatchObject({
      fingerprint: "calibrated-result:metadata-source",
      guarantee: {
        calibrationReplayLabel: "PredictResult",
        calibrationReplaySource: {
          dataset_backed: false,
          kind: "predict_result",
          requires_model_replay: false,
          route: "PredictResult",
          version: 1,
        },
        coverageLabel: "80%",
        label: "Active conformal guarantee",
        status: "active",
        tone: "success",
      },
      coverages: [{
        calibrated: true,
        coverage: 0.8,
        disabled: false,
        label: "80%",
        materialized: true,
        selected: true,
      }],
      intervals: [{
        coverage: 0.8,
        coverageLabel: "80%",
        meanWidth: 1,
        nSamples: 2,
        qhat: 0.5,
      }],
      method: "split_absolute_residual",
      nPredictions: 2,
      unit: "physical_sample",
    });
  });

  it("builds tuning summary data from an attached native tuning result artifact", () => {
    const tuningResult = {
      best_params: {
        n_components: 8,
      },
      best_value: 0.1234,
      fingerprint: "tuning-result:abcdef1234567890",
      optimizer: "optuna",
      trials: [
        {
          diagnostics: {},
          number: 1,
          params: { n_components: 4 },
          state: "COMPLETE",
          value: 0.2,
        },
        {
          diagnostics: { reason: "winner" },
          number: 2,
          params: { n_components: 8 },
          state: "COMPLETE",
          value: 0.1234,
        },
        {
          diagnostics: { error: "invalid candidate" },
          number: 3,
          params: { n_components: 16 },
          state: "FAILED",
          value: null,
        },
      ],
      tuning: {
        direction: "minimize",
        engine: "optuna",
        metric: "rmse",
        n_trials: 3,
        pruner: null,
        resume: false,
        sampler: "tpe",
        seed: 42,
        space: {
          n_components: { low: 2, high: 16 },
        },
        storage: null,
        study_name: "pls-native",
      },
    };

    const pipelineWithTuningOnly = pipeline({
      metrics: undefined,
      score: null,
      val_score: null,
      test_score: null,
      artifact_refs: [{
        id: "tuning-result",
        kind: "repository_entry",
        role: "tuning-result",
        label: "Native tuning result",
        source: "result-repository",
        scope: "pipeline",
        status: "available",
        format: "json",
        metadata: {
          tuning_result: tuningResult,
        },
      }],
    });

    expect(hasResultMetrics(pipelineWithTuningOnly)).toBe(true);
    expect(buildResultTuningSummary(pipelineWithTuningOnly)).toMatchObject({
      persistence: {
        optimizerStateResumeSupported: true,
        resume: false,
        storageConfigured: false,
        studyName: "pls-native",
      },
      study: {
        bestParams: { n_components: 8 },
        bestValue: 0.1234,
        bestValueLabel: "0.123",
        completeTrials: 2,
        direction: "minimize",
        failedTrials: 1,
        fingerprint: "tuning-result:abcdef1234567890",
        metric: "rmse",
        nTrials: 3,
        optimizer: "optuna",
        pruner: null,
        sampler: "tpe",
        searchSpaceSize: 1,
        seed: 42,
        studyName: "pls-native",
      },
      trials: [
        expect.objectContaining({
          isBest: false,
          number: 1,
          status: "complete",
          valueLabel: "0.200",
        }),
        expect.objectContaining({
          isBest: true,
          number: 2,
          paramsLabel: "n_components=8",
          status: "complete",
          valueLabel: "0.123",
        }),
        expect.objectContaining({
          number: 3,
          status: "failed",
          valueLabel: "—",
        }),
      ],
    });
  });

  it("builds tuning summary data from a lightweight tuning summary artifact", () => {
    const tuningSummary = {
      best_params: { n_components: 8 },
      best_value: 0.1234,
      direction: "minimize",
      engine: "optuna",
      fingerprint: "tuning-summary:abcdef1234567890",
      format: "nirs4all.tuning.summary",
      metric: "rmse",
      n_trials: 3,
      optimizer: "optuna",
      persistence: {
        optimizer_state_resume_supported: true,
        resume: true,
        storage_configured: true,
        study_name: "pls-summary",
      },
      pruner: "median",
      sampler: "grid",
      schema_version: 1,
      seed: 42,
      trial_states: { COMPLETE: 2, FAILED: 1 },
      trials: [
        { number: 1, state: "COMPLETE", value: 0.2 },
        { number: 2, state: "COMPLETE", value: 0.1234, diagnostics: { score_family: "objective" } },
        { number: 3, state: "FAILED", value: null, diagnostics: { error_type: "RuntimeError" } },
      ],
      version: 1,
    };

    const pipelineWithTuningSummaryOnly = pipeline({
      metrics: undefined,
      score: null,
      val_score: null,
      test_score: null,
      artifact_refs: [{
        id: "tuning-summary",
        kind: "repository_entry",
        role: "tuning-summary",
        label: "Native tuning summary",
        source: "result-repository",
        scope: "pipeline",
        status: "available",
        format: "nirs4all.tuning.summary",
        metadata: {
          tuning_summary: tuningSummary,
        },
      }],
    });

    expect(hasResultMetrics(pipelineWithTuningSummaryOnly)).toBe(true);
    expect(buildResultTuningSummary(pipelineWithTuningSummaryOnly)).toMatchObject({
      persistence: {
        optimizerStateResumeSupported: true,
        resume: true,
        storageConfigured: true,
        studyName: "pls-summary",
      },
      study: {
        bestParams: { n_components: 8 },
        bestValue: 0.1234,
        bestValueLabel: "0.123",
        completeTrials: 2,
        direction: "minimize",
        failedTrials: 1,
        fingerprint: "tuning-summary:abcdef1234567890",
        metric: "rmse",
        nTrials: 3,
        optimizer: "optuna",
        pruner: "median",
        sampler: "grid",
        searchSpaceSize: 1,
        seed: 42,
        studyName: "pls-summary",
      },
      trials: [
        expect.objectContaining({
          isBest: false,
          number: 1,
          paramsLabel: "summary artifact",
          status: "complete",
          valueLabel: "0.200",
        }),
        expect.objectContaining({
          diagnostics: { score_family: "objective" },
          isBest: true,
          number: 2,
          params: {},
          status: "complete",
          valueLabel: "0.123",
        }),
        expect.objectContaining({
          diagnostics: { error_type: "RuntimeError" },
          number: 3,
          status: "failed",
          valueLabel: "—",
        }),
      ],
    });
  });

  it("prefers real logs and falls back to status-specific generated logs", () => {
    expect(getResultExecutionLogs(pipeline({ logs: ["actual log"] }))).toEqual(["actual log"]);
    expect(getResultExecutionLogs(pipeline({ status: "queued", logs: [] }))).toEqual(["[INFO] Waiting in queue..."]);
    expect(getResultExecutionLogs(pipeline({ status: "failed" })).some((line) => line.includes("[ERROR]"))).toBe(true);
    expect(getResultExecutionLogs(pipeline({ status: "running", progress: 42 })).at(-1)).toBe(
      "[INFO] Cross-validation in progress... 42%",
    );
  });

  it("classifies result log rows for presentation", () => {
    expect(getResultLogLineTone("[ERROR] Broken")).toBe("error");
    expect(getResultLogLineTone("[INFO] Ready")).toBe("info");
    expect(getResultLogLineTone("raw log")).toBe("default");
    expect(buildResultLogRows(["[INFO] Ready", "[ERROR] Broken", "raw log"])).toEqual([
      { id: "0-[INFO] Ready", text: "[INFO] Ready", tone: "info" },
      { id: "1-[ERROR] Broken", text: "[ERROR] Broken", tone: "error" },
      { id: "2-raw log", text: "raw log", tone: "default" },
    ]);
  });
});
