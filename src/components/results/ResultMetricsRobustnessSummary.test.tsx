/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildRobustnessScenarioCsvFilename,
  buildRobustnessScenarioCsvRows,
  ResultMetricsRobustnessSummary,
  ROBUSTNESS_SCENARIO_CSV_COLUMNS,
} from "./ResultMetricsRobustnessSummary";
import type { ResultRobustnessSummaryData } from "./resultDetailData";

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

function summary(): ResultRobustnessSummaryData {
  return {
    cards: [{
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
      scenario: { distribution: "uniform", kind: "prediction_noise", severity: 0.4 },
      scenarioIndex: 1,
      scenarioLabel: "prediction noise (distribution=uniform)",
      executionScope: "spectral_replay",
      requiresSpectralReplay: true,
      severity: 0.4,
      status: "warning",
      worstSlice: {
        key: { batch: "A" },
        label: "batch=A",
        metric: "rmse",
        value: 0.18,
      },
    }],
    fingerprint: "robustness:abcdef1234567890",
    guarantee: {
      calibrationReplayLabel: "unknown replay source",
      calibrationReplaySource: null,
      coverageLabel: "80%",
      effectiveEngine: "nirs4all.conformal.v1",
      invalidationReasons: ["prediction fingerprint changed"],
      label: "Invalidated conformal guarantee",
      limitations: [],
      method: "split_absolute_residual",
      requestedEngine: "nirs4all.conformal.v1",
      scope: "finite_sample_marginal_exchangeability",
      status: "invalidated",
      tone: "error",
      tuningCalibrationLabel: "unknown tuning calibration source",
      tuningCalibrationSource: null,
      unit: "physical_sample",
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
  };
}

describe("ResultMetricsRobustnessSummary", () => {
  it("renders robustness summary and scenario export action", async () => {
    const { container, root } = await render(<ResultMetricsRobustnessSummary summary={summary()} />);

    expect(container.textContent).toContain("Robustness summary");
    expect(container.textContent).toContain("clean frozen · report v1 · slices: batch");
    expect(container.textContent).toContain("Invalidated conformal guarantee");
    expect(container.textContent).toContain("80%");
    expect(container.textContent).toContain("nirs4all.conformal.v1");
    expect(container.textContent).toContain("Invalidated: prediction fingerprint changed");
    expect(container.textContent).toContain("Spectral replay provenance");
    expect(container.textContent).toContain("saved bundle · route nirs4all.predict · sample ids forwarded");
    expect(container.textContent).toContain("bundle models/spectral-model.n4a");
    expect(container.textContent).toContain("Scenarios CSV");
    expect(container.textContent).toContain("Degradation heatmap");
    expect(container.textContent).toContain("Visual projection of summary rows");
    expect(container.textContent).toContain("Coverage gap");
    expect(container.textContent).toContain("Degradation matrix");
    expect(container.textContent).toContain("Metadata-only view from summary rows");
    expect(container.textContent).toContain("RMSE Δ");
    expect(container.textContent).toContain("+0.04");
    expect(container.textContent).toContain("MAE Δ");
    expect(container.textContent).toContain("+0.03");
    expect(container.textContent).toContain("Worst slices");
    expect(container.textContent).toContain("Summary-row view of nirs4all slice diagnostics");
    expect(container.textContent).toContain("batch=A");
    expect(container.textContent).toContain("rmse");
    expect(container.textContent).toContain("prediction noise (distribution=uniform)");
    expect(container.textContent).toContain("distribution uniform");
    expect(container.textContent).toContain("spectral/OOD replay");
    expect(container.textContent).toContain("spectral/OOD replay evidence");
    expect(container.textContent).toContain("Coverage warning");
    expect(container.textContent).toContain("Worst slice: batch=A");

    await act(async () => {
      root.unmount();
    });
  });

  it("builds stable CSV rows for robustness scenarios", () => {
    expect(ROBUSTNESS_SCENARIO_CSV_COLUMNS).toEqual([
      "scenario_index",
      "scenario_label",
      "severity",
      "distribution",
      "n_samples",
      "rmse",
      "rmse_delta",
      "mae",
      "mae_delta",
      "bias",
      "max_abs_error",
      "coverage_status",
      "execution_scope",
      "requires_spectral_replay",
      "coverage_min_observed",
      "coverage_max_abs_gap",
      "coverage_mean_width",
      "worst_slice_label",
      "worst_slice_metric",
      "worst_slice_value",
      "worst_slice_json",
    ]);
    expect(buildRobustnessScenarioCsvFilename(summary())).toBe("robustness_robustness_abcdef1234567890_scenarios.csv");
    expect(buildRobustnessScenarioCsvRows(summary())).toEqual([{
      bias: 0.01,
      coverage_max_abs_gap: 0.12,
      coverage_mean_width: 0.31,
      coverage_min_observed: 0.85,
      coverage_status: "warning",
      distribution: "uniform",
      execution_scope: "spectral_replay",
      mae: 0.11,
      mae_delta: 0.03,
      max_abs_error: 0.42,
      n_samples: 24,
      requires_spectral_replay: true,
      rmse: 0.18,
      rmse_delta: 0.04,
      scenario_index: 1,
      scenario_label: "prediction noise (distribution=uniform)",
      severity: 0.4,
      worst_slice_json: "{\"batch\":\"A\"}",
      worst_slice_label: "batch=A",
      worst_slice_metric: "rmse",
      worst_slice_value: 0.18,
    }]);
  });
});
