/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { Tabs } from "@/components/ui/tabs";
import type { PipelineRun } from "@/types/runs";
import { ResultDetailMetricsTab } from "./ResultDetailMetricsTab";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let mountedContainers: HTMLDivElement[] = [];

async function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountedContainers.push(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(node);
  });

  return { container, root };
}

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

function calibratedResultArtifact() {
  return {
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
        conformal_metrics: [{
          coverage: 0.8,
          coverage_gap: -0.05,
          fingerprint: "conformal-metric:abcdef1234567890",
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
        tuning_calibration_source: {
          score_data_role: "hpo_objective_only",
          score_data_used: false,
        source: "tuning.winner",
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
}

function tuningResultArtifact() {
  return {
    best_params: { n_components: 8 },
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
    ],
    tuning: {
      direction: "minimize",
      engine: "optuna",
      metric: "rmse",
      n_trials: 2,
      pruner: null,
      resume: false,
      sampler: "tpe",
      seed: 42,
      space: { n_components: { high: 16, low: 2 } },
      storage: null,
      study_name: "pls-native",
    },
  };
}

function robustnessSummaryArtifact() {
  return {
    fingerprint: "robustness:abcdef1234567890",
    format: "nirs4all.robustness.summary",
    mode: "clean_frozen",
    report_version: 1,
    schema_version: 1,
    slice_by: ["batch"],
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
      scenario: { kind: "detector_drift" },
      scenario_index: 1,
      scenario_label: "detector drift",
      severity: 0.4,
      worst_slice_key: { batch: "A" },
      worst_slice_label: "batch=A",
      worst_slice_metric: "rmse",
      worst_slice_value: 0.18,
    }],
  };
}

function nativePipeline(): PipelineRun {
  return {
    completed_at: "2026-06-28T10:05:00Z",
    has_refit: true,
    id: "run-native",
    is_final_model: true,
    metrics: { r2: 0.91, rmse: 0.12 },
    model: "PLS",
    pipeline_id: "pipe-native",
    pipeline_name: "Native PLS",
    preprocessing: "SNV",
    progress: 100,
    robustness_plan: {
      mode: "clean_frozen",
      scenarios: [
        { distribution: "normal", kind: "prediction_noise", severity: 0.2 },
        { kind: "spectral_shift", severity: 0.4 },
      ],
      slice_by: ["batch"],
    },
    robustness_execution: {
      blockers: [],
      message: "A nirs4all RobustnessReport artifact is attached.",
      requires_X: true,
      requires_predictions: true,
      requires_predictor: true,
      requires_y_true: true,
      status: "reported",
    },
    split_strategy: "KFold",
    started_at: "2026-06-28T10:00:00Z",
    status: "completed",
    test_score: 0.12,
    val_score: 0.13,
    artifact_refs: [
      {
        format: "json",
        id: "tuning-result",
        kind: "repository_entry",
        label: "Native tuning result",
        metadata: { tuning_result: tuningResultArtifact() },
        role: "tuning-result",
        scope: "pipeline",
        source: "result-repository",
        status: "available",
      },
      {
        format: "json",
        id: "conformal-result",
        kind: "repository_entry",
        label: "Conformal calibrated result",
        metadata: { conformal_calibrated_result: calibratedResultArtifact() },
        role: "conformal-calibrated-result",
        scope: "pipeline",
        source: "result-repository",
        status: "available",
      },
      {
        format: "json",
        id: "robustness-summary",
        kind: "repository_entry",
        label: "Robustness summary",
        metadata: { robustness_summary_artifact: robustnessSummaryArtifact() },
        role: "robustness-summary",
        scope: "pipeline",
        source: "result-repository",
        status: "available",
      },
    ],
  };
}

describe("ResultDetailMetricsTab", () => {
  it("renders native tuning, conformal, and robustness artifacts together", async () => {
    const { container, root } = await render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Tabs value="results">
          <ResultDetailMetricsTab pipeline={nativePipeline()} datasetName="Maize" hasMetrics />
        </Tabs>
      </MemoryRouter>,
    );

    expect(container.textContent).toContain("Native tuning");
    expect(container.textContent).toContain("optuna · minimize rmse · 2 trials");
    expect(container.textContent).toContain("Trials CSV");
    expect(container.textContent).toContain("Conformal prediction");
    expect(container.textContent).toContain("Active conformal guarantee");
    expect(container.textContent).toContain("calibration replay: dataset predictor bundle via nirs4all.predict");
    expect(container.textContent).toContain("tuning calibration: tuning winner; score_data ranked trials only");
    expect(container.textContent).toContain("80% · selected, calibrated, materialized");
    expect(container.textContent).toContain("Coverage metrics");
    expect(container.textContent).toContain("Metrics CSV");
    expect(container.textContent).toContain("Attached conformal metric sets; Studio displays them without recomputing observed coverage or interval scores.");
    expect(container.textContent).toContain("75%");
    expect(container.textContent).toContain("-0.0500");
    expect(container.textContent).toContain("Robustness summary");
    expect(container.textContent).toContain("Robustness launch plan");
    expect(container.textContent).toContain("reported");
    expect(container.textContent).toContain("A nirs4all RobustnessReport artifact is attached.");
    expect(container.textContent).toContain("Required evidence: y_true, PredictResult/CalibratedRunResult, X spectra, frozen predictor");
    expect(container.textContent).toContain("prediction noise");
    expect(container.textContent).toContain("prediction replay");
    expect(container.textContent).toContain("spectral replay");
    expect(container.textContent).toContain("Requires row-aligned X spectra and frozen predictor replay");
    expect(container.textContent).toContain("clean frozen · report v1 · slices: batch");
    expect(container.textContent).toContain("Scenarios CSV");
    expect(container.textContent).toContain("Metadata-only view from summary rows; Studio does not recompute robustness metrics.");
    expect(container.textContent).toContain("Summary-row view of nirs4all slice diagnostics; Studio does not recompute slice metrics.");
    expect(container.textContent).toContain("Coverage warning");
    expect(container.textContent).toContain("Export Final Model (.n4a)");

    await act(async () => {
      root.unmount();
    });
  });
});
