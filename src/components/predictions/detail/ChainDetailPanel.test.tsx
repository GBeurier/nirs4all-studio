/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ChainDetailResponse,
  ChainSummary,
  PartitionPrediction,
  PredictionArraysResponse,
} from "@/types/aggregated-predictions";

const apiMocks = vi.hoisted(() => ({
  getChainDetail: vi.fn(),
  getChainPartitionDetail: vi.fn(),
  getChainPipelineSteps: vi.fn(),
  getPredictionArrays: vi.fn(),
  getPredictionRobustnessEvidence: vi.fn(),
  computePredictionRobustnessReport: vi.fn(),
  exportWorkspaceRobustnessReport: vi.fn(),
}));

vi.mock("@/api/aggregatedPredictions", () => ({
  getChainDetail: apiMocks.getChainDetail,
  getChainPartitionDetail: apiMocks.getChainPartitionDetail,
  getChainPipelineSteps: apiMocks.getChainPipelineSteps,
  getPredictionArrays: apiMocks.getPredictionArrays,
  getPredictionRobustnessEvidence: apiMocks.getPredictionRobustnessEvidence,
  computePredictionRobustnessReport: apiMocks.computePredictionRobustnessReport,
  exportWorkspaceRobustnessReport: apiMocks.exportWorkspaceRobustnessReport,
}));

vi.mock("./ChainDetailChartBody", () => ({
  ChainDetailChartBody: () => <div data-testid="chain-detail-chart-body" />,
}));

vi.mock("@/hooks/useKeywordRegistry", () => ({
  useKeywordRegistry: () => ({
    data: null,
    error: null,
    isError: false,
    isLoading: false,
  }),
}));

import { ChainDetailPanel } from "./ChainDetailPanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const createObjectURLMock = vi.fn(() => "blob:robustness-report");
const revokeObjectURLMock = vi.fn();
Object.defineProperty(URL, "createObjectURL", {
  configurable: true,
  value: createObjectURLMock,
});
Object.defineProperty(URL, "revokeObjectURL", {
  configurable: true,
  value: revokeObjectURLMock,
});
const anchorClickMock = vi
  .spyOn(HTMLAnchorElement.prototype, "click")
  .mockImplementation(() => undefined);

let mountedRoots: Root[] = [];
let mountedContainers: HTMLDivElement[] = [];

async function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountedContainers.push(container);
  const root = createRoot(container);
  mountedRoots.push(root);

  await act(async () => {
    root.render(node);
  });

  return { container, root };
}

async function waitFor(assertion: () => void, timeoutMs: number = 1000): Promise<void> {
  const start = Date.now();
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start >= timeoutMs) {
        throw error;
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }
}

function changeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function summary(overrides: Partial<ChainSummary> = {}): ChainSummary {
  return {
    run_id: "run",
    pipeline_id: "pipe",
    chain_id: "chain",
    model_name: "Loaded model",
    model_class: "LoadedModel",
    preprocessings: "SNV",
    branch_path: null,
    source_index: null,
    model_step_idx: 0,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "Loaded dataset",
    best_params: null,
    cv_val_score: 0.2,
    cv_test_score: 0.3,
    cv_train_score: 0.1,
    cv_fold_count: 1,
    cv_scores: null,
    final_test_score: null,
    final_train_score: null,
    final_scores: null,
    pipeline_status: "completed",
    fold_artifacts: null,
    ...overrides,
  };
}

function predictionRow(overrides: Partial<PartitionPrediction> = {}): PartitionPrediction {
  return {
    prediction_id: "p-test",
    pipeline_id: "pipe",
    chain_id: "chain",
    dataset_name: "Loaded dataset",
    model_name: "Loaded model",
    model_class: "LoadedModel",
    fold_id: "1",
    partition: "test",
    val_score: null,
    test_score: 0.3,
    train_score: null,
    scores: { rmse: 0.3 },
    best_params: null,
    metric: "rmse",
    task_type: "regression",
    n_samples: 2,
    n_features: 3,
    preprocessings: "SNV",
    ...overrides,
  };
}

function arrays(predictionId: string): PredictionArraysResponse {
  return {
    prediction_id: predictionId,
    y_true: [1, 2],
    y_pred: [1.1, 1.9],
    y_proba: null,
    sample_indices: [0, 1],
    weights: null,
    n_samples: 2,
    sample_metadata: null,
  };
}

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
    fingerprint: "calibrated-result:chain-detail",
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

function conformalMetricSet() {
  return {
    coverage: 0.8,
    coverage_gap: -0.05,
    fingerprint: "conformal-metric:chain-detail",
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
  };
}

function tuningResultArtifact() {
  return {
    best_params: { n_components: 8 },
    best_value: 0.1234,
    fingerprint: "tuning-result:chain-detail",
    optimizer: "optuna",
    trials: [
      {
        diagnostics: {},
        number: 1,
        params: { n_components: 8 },
        state: "COMPLETE",
        value: 0.1234,
      },
    ],
    tuning: {
      direction: "minimize",
      engine: "optuna",
      metric: "rmse",
      n_trials: 1,
      pruner: null,
      resume: false,
      sampler: "tpe",
      seed: 42,
      space: { n_components: { high: 16, low: 2 } },
      storage: null,
      study_name: "chain-native",
    },
  };
}

function robustnessEvidence(predictionId: string, spectralReady: boolean = false) {
  return {
    prediction_id: predictionId,
    run_id: "run",
    pipeline_id: "pipe",
    chain_id: "chain",
    stored_prediction_scenarios: ["observed", "prediction_bias", "prediction_noise"],
    spectral_scenarios: ["spectral_noise", "spectral_offset", "spectral_scale", "spectral_shift", "spectral_slope"],
    can_compute_stored_prediction_report: true,
    can_compute_spectral_report: spectralReady,
    status: spectralReady ? "ready_for_spectral_replay" : "ready_for_prediction_space_only",
    requirements: [
      {
        id: "y_true",
        label: "Stored truth labels",
        present: true,
        source: "prediction_arrays.y_true",
        detail: "Required for observed and prediction-space robustness metrics.",
      },
      {
        id: "y_pred",
        label: "Stored predictions",
        present: true,
        source: "prediction_arrays.y_pred",
        detail: "Required for observed, prediction_bias and prediction_noise reports.",
      },
      {
        id: "spectra",
        label: "Row-aligned spectra / X matrix",
        present: spectralReady,
        source: spectralReady ? "prediction_arrays.X" : null,
        detail: "Required before Studio can replay spectral/OOD perturbations.",
      },
      {
        id: "frozen_predictor",
        label: "Frozen predictor replay surface",
        present: spectralReady,
        source: spectralReady ? "prediction_arrays.predictor_bundle" : null,
        detail: "Required before Studio can score perturbed spectra with the exact stored predictor.",
      },
    ],
    blockers: spectralReady
      ? []
      : [
        "Spectral/OOD scenarios require a row-aligned X/spectra matrix for the selected prediction.",
        "Spectral/OOD scenarios require an explicit frozen predictor replay surface.",
      ],
  };
}

function robustnessSummaryArtifact() {
  return {
    conformal_guarantee_status: {
      artifact_fingerprint: "robustness-artifact-fp",
      calibrated_coverages: [0.8, 0.95],
      calibration_data_fingerprint: "calibration-data-fp",
      coverage: [0.8],
      effective_engine: "nirs4all.conformal.v1",
      guarantee: "split_conformal_marginal_coverage",
      invalidation_reasons: ["prediction fingerprint changed"],
      limitations: ["finite-sample marginal coverage requires exchangeable calibration and prediction samples"],
      method: "split_absolute_residual",
      multi_target: "marginal",
      predictor_fingerprint: null,
      requested_engine: "nirs4all.conformal.v1",
      scope: "finite_sample_marginal_exchangeability",
      source_calibrated_result_fingerprint: null,
      status: "invalidated",
      unit: "physical_sample",
      version: 1,
    },
    fingerprint: "robustness:generated",
    format: "nirs4all.robustness.summary",
    mode: "clean_frozen",
    report_version: 1,
    schema_version: 1,
    slice_by: [],
    summary: [{
      bias: 0,
      conformal_max_abs_coverage_gap: null,
      conformal_mean_width_mean: null,
      conformal_min_observed_coverage: null,
      delta_bias: 0,
      delta_mae: 0,
      delta_max_abs_error: 0,
      delta_rmse: 0,
      mae: 0.1,
      mae_ratio: 1,
      max_abs_error: 0.2,
      n_samples: 2,
      rmse: 0.14,
      rmse_ratio: 1,
      scenario: { kind: "prediction_noise" },
      scenario_index: 0,
      scenario_label: "prediction_noise",
      severity: 0.25,
      worst_slice_key: null,
      worst_slice_label: null,
      worst_slice_metric: "rmse",
      worst_slice_value: null,
    }],
  };
}

afterEach(async () => {
  for (const root of mountedRoots) {
    await act(async () => {
      root.unmount();
    });
  }
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedRoots = [];
  mountedContainers = [];
  vi.clearAllMocks();
  localStorage.clear();
});

describe("ChainDetailPanel", () => {
  it("renders native tuning, conformal metrics, and robustness summary in chain detail without local recomputation", async () => {
    apiMocks.getChainDetail.mockResolvedValue({
      chain_id: "chain",
      summary: summary({
        conformal_calibrated_result: calibratedResultArtifact(),
        conformal_metrics: [conformalMetricSet()],
        robustness_summary: robustnessSummaryArtifact(),
        tuning_result: tuningResultArtifact(),
      } as Partial<ChainSummary>),
      predictions: [],
      pipeline: null,
    } satisfies ChainDetailResponse);
    apiMocks.getChainPartitionDetail.mockResolvedValue({
      chain_id: "chain",
      predictions: [predictionRow()],
      total: 1,
      partition: null,
      fold_id: null,
    });
    apiMocks.getChainPipelineSteps.mockResolvedValue({ pipeline: [] });
    apiMocks.getPredictionArrays.mockImplementation(async (predictionId: string) => arrays(predictionId));
    apiMocks.getPredictionRobustnessEvidence.mockImplementation(async (predictionId: string) => robustnessEvidence(predictionId));

    const { container } = await render(<ChainDetailPanel chainId="chain" metric="rmse" />);

    await waitFor(() => {
      expect(container.textContent).toContain("Native tuning");
      expect(container.textContent).toContain("optuna · minimize rmse · 1 trial");
      expect(container.textContent).toContain("Conformal prediction");
      expect(container.textContent).toContain("Active conformal guarantee");
      expect(container.textContent).toContain("80% · selected, calibrated, materialized");
      expect(container.textContent).toContain("Coverage metrics");
      expect(container.textContent).toContain("Metrics CSV");
      expect(container.textContent).toContain("Attached conformal metric sets; Studio displays them without recomputing observed coverage or interval scores.");
      expect(container.textContent).toContain("Materialized prediction intervals from the attached calibrated result. Studio displays these bounds as produced by nirs4all and does not recompute coverage.");
      expect(container.textContent).toContain("Robustness summary");
      expect(container.textContent).toContain("Metadata-only view from summary rows; Studio does not recompute robustness metrics.");
      expect(container.textContent).toContain("Invalidated conformal guarantee");
      expect(container.textContent).toContain("Invalidated: prediction fingerprint changed");
      expect(container.textContent).toContain("Native robustness report");
    });
  });

  it("renders the native robustness scenario form and submits prediction noise reports", async () => {
    apiMocks.getChainDetail.mockResolvedValue({
      chain_id: "chain",
      summary: summary(),
      predictions: [],
      pipeline: null,
    } satisfies ChainDetailResponse);
    apiMocks.getChainPartitionDetail.mockResolvedValue({
      chain_id: "chain",
      predictions: [predictionRow()],
      total: 1,
      partition: null,
      fold_id: null,
    });
    apiMocks.getChainPipelineSteps.mockResolvedValue({ pipeline: [] });
    apiMocks.getPredictionArrays.mockImplementation(async (predictionId: string) => arrays(predictionId));
    apiMocks.getPredictionRobustnessEvidence.mockImplementation(async (predictionId: string) => robustnessEvidence(predictionId));
    apiMocks.computePredictionRobustnessReport.mockResolvedValue({
      robustness_id: "rob-noise",
      prediction_id: "p-test",
      run_id: "run",
      pipeline_id: "pipe",
      chain_id: "chain",
      summary_artifact: robustnessSummaryArtifact(),
      report_fingerprint: "robustness:generated",
    });

    const { container } = await render(<ChainDetailPanel chainId="chain" metric="rmse" />);

    await waitFor(() => {
      expect(container.textContent).toContain("Native robustness report");
      expect(container.textContent).toContain("Compute report");
      expect(container.textContent).toContain("Unavailable from stored predictions (5)");
      expect(container.textContent).toContain("spectral noise");
      expect(container.textContent).toContain("Requires explicit spectra and a frozen predictor replay surface.");
      expect(container.textContent).toContain("Spectral/OOD replay preflight: blocked");
      expect(container.textContent).toContain("Prediction-space ready");
      expect(container.textContent).toContain("Spectral/OOD blocked");
      expect(container.textContent).toContain("Evidence present 2/4");
      expect(container.textContent).toContain("ready for prediction space only");
      expect(container.textContent).toContain("Stored-prediction scenarios");
      expect(container.textContent).toContain("observed, prediction_bias, prediction_noise");
      expect(container.textContent).toContain("Spectral/OOD scenarios");
      expect(container.textContent).toContain("spectral_noise, spectral_offset, spectral_scale, spectral_shift, spectral_slope");
      expect(container.textContent).toContain("Row-aligned spectra / X matrix");
      expect(container.textContent).toContain("prediction_arrays.y_true");
      expect(container.textContent).toContain("Spectral/OOD scenarios require an explicit frozen predictor replay surface.");
      expect((container.querySelector("button:last-of-type") as HTMLButtonElement | null)?.disabled).toBe(false);
    });

    const scenarioSelect = container.querySelector("select") as HTMLSelectElement;
    const severityInput = container.querySelector("input[type='number']") as HTMLInputElement;
    const computeButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Compute report") as HTMLButtonElement;

    expect(Array.from(scenarioSelect.options).map((option) => option.value)).toEqual([
      "observed",
      "prediction_bias",
      "prediction_noise",
    ]);
    expect(severityInput.disabled).toBe(true);
    expect(severityInput.value).toBe("0");

    await act(async () => {
      scenarioSelect.value = "prediction_noise";
      scenarioSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    let activeSeverityInput = container.querySelector("input[type='number']") as HTMLInputElement;
    const distributionSelect = Array.from(container.querySelectorAll("select"))[1] as HTMLSelectElement;
    expect(distributionSelect).toBeTruthy();
    expect(Array.from(distributionSelect.options).map((option) => option.value)).toEqual(["normal", "uniform"]);
    expect(activeSeverityInput.disabled).toBe(false);

    await act(async () => {
      changeInputValue(activeSeverityInput, "-0.1");
    });
    await waitFor(() => {
      expect(container.textContent).toContain("Prediction noise severity must be non-negative.");
      expect(computeButton.disabled).toBe(true);
    });

    await act(async () => {
      activeSeverityInput = container.querySelector("input[type='number']") as HTMLInputElement;
      changeInputValue(activeSeverityInput, "0.25");
      distributionSelect.value = "uniform";
      distributionSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitFor(() => {
      expect(computeButton.disabled).toBe(false);
      expect(container.textContent).toContain("Uniform uses bounded centered noise in [-severity, +severity].");
    });

    await act(async () => {
      computeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() => {
      expect(apiMocks.computePredictionRobustnessReport).toHaveBeenCalledWith("p-test", {
        robustness: {
          mode: "clean_frozen",
          scenarios: [{ kind: "prediction_noise", severity: 0.25, distribution: "uniform" }],
        },
        name: "Studio Prediction noise robustness report",
      });
      expect(container.textContent).toContain("Report persisted:");
      expect(container.textContent).toContain("rob-noise");
      expect(container.textContent).toContain("prediction_noise");
      expect(container.textContent).toContain("Invalidated conformal guarantee");
      expect(container.textContent).toContain("80%");
      expect(container.textContent).toContain("Invalidated: prediction fingerprint changed");
      expect(container.textContent).toContain("Export JSON");
      expect(container.textContent).toContain("Export Markdown");
      expect(container.textContent).toContain("Export HTML");
    });

    const markdownBlob = new Blob(["# Robustness\n"], { type: "text/markdown" });
    apiMocks.exportWorkspaceRobustnessReport.mockResolvedValue(markdownBlob);
    const markdownButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Export Markdown") as HTMLButtonElement;

    await act(async () => {
      markdownButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() => {
      expect(apiMocks.exportWorkspaceRobustnessReport).toHaveBeenCalledWith("rob-noise", "markdown");
      expect(createObjectURLMock).toHaveBeenCalledWith(markdownBlob);
      expect(anchorClickMock).toHaveBeenCalled();
      expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:robustness-report");
    });
  });

  it("exposes spectral robustness scenarios when evidence preflight is ready", async () => {
    apiMocks.getChainDetail.mockResolvedValue({
      chain_id: "chain",
      summary: summary(),
      predictions: [],
      pipeline: null,
    } satisfies ChainDetailResponse);
    apiMocks.getChainPartitionDetail.mockResolvedValue({
      chain_id: "chain",
      predictions: [predictionRow()],
      total: 1,
      partition: null,
      fold_id: null,
    });
    apiMocks.getChainPipelineSteps.mockResolvedValue({ pipeline: [] });
    apiMocks.getPredictionArrays.mockImplementation(async (predictionId: string) => arrays(predictionId));
    apiMocks.getPredictionRobustnessEvidence.mockImplementation(async (predictionId: string) => (
      robustnessEvidence(predictionId, true)
    ));

    const { container } = await render(<ChainDetailPanel chainId="chain" metric="rmse" />);

    await waitFor(() => {
      expect(container.textContent).toContain("Spectral/OOD ready");
      expect(container.textContent).toContain("Evidence present 4/4");
    });

    const scenarioSelect = container.querySelector("select") as HTMLSelectElement;
    expect(Array.from(scenarioSelect.options).map((option) => option.value)).toEqual([
      "observed",
      "prediction_bias",
      "prediction_noise",
      "spectral_noise",
      "spectral_offset",
      "spectral_scale",
      "spectral_slope",
      "spectral_shift",
    ]);
    expect(container.textContent).not.toContain("Unavailable from stored predictions");

    await act(async () => {
      scenarioSelect.value = "spectral_shift";
      scenarioSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await waitFor(() => {
      expect(container.textContent).toContain("This scenario is available because the selected prediction evidence includes row-aligned X/spectra and a saved predictor bundle/path.");
    });
  });
});
