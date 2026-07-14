/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildTuningTrialCsvFilename,
  buildTuningTrialCsvRows,
  ResultMetricsTuningSummary,
  TUNING_TRIAL_CSV_COLUMNS,
} from "./ResultMetricsTuningSummary";
import type { ResultTuningSummaryData } from "./resultDetailData";

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

function summary(): ResultTuningSummaryData {
  return {
    persistence: {
      optimizerStateResumeSupported: true,
      resume: true,
      storageConfigured: true,
      studyName: "pls-native",
    },
    study: {
      bestParams: { n_components: 8 },
      bestValue: 0.1234,
      bestValueLabel: "0.1234",
      completeTrials: 2,
      direction: "minimize",
      failedTrials: 1,
      fingerprint: "tuning-result:abcdef1234567890",
      metric: "rmse",
      nTrials: 3,
      optimizer: "optuna",
      pruner: "median",
      prunedTrials: 0,
      runningTrials: 0,
      sampler: "tpe",
      searchSpaceSize: 1,
      seed: 42,
      studyName: "pls-native",
    },
    trials: [
      {
        diagnostics: {},
        isBest: false,
        number: 1,
        params: { n_components: 4 },
        paramsLabel: "n_components=4",
        status: "complete",
        statusLabel: "Complete",
        tone: "success",
        value: 0.2,
        valueLabel: "0.2000",
      },
      {
        diagnostics: { reason: "winner" },
        isBest: true,
        number: 2,
        params: { n_components: 8 },
        paramsLabel: "n_components=8",
        status: "complete",
        statusLabel: "Complete",
        tone: "success",
        value: 0.1234,
        valueLabel: "0.1234",
      },
      {
        diagnostics: { error: "invalid candidate" },
        isBest: false,
        number: 3,
        params: { n_components: 16 },
        paramsLabel: "n_components=16",
        status: "failed",
        statusLabel: "Failed",
        tone: "error",
        value: null,
        valueLabel: "—",
      },
    ],
  };
}

describe("ResultMetricsTuningSummary", () => {
  it("renders native tuning study and trial rows", async () => {
    const { container, root } = await render(<ResultMetricsTuningSummary summary={summary()} />);

    expect(container.textContent).toContain("Native tuning");
    expect(container.textContent).toContain("optuna · minimize rmse · 3 trials");
    expect(container.textContent).toContain("Trials CSV");
    expect(container.textContent).toContain("Best value");
    expect(container.textContent).toContain("0.1234");
    expect(container.textContent).toContain("Sampler");
    expect(container.textContent).toContain("tpe");
    expect(container.textContent).toContain("Pruner");
    expect(container.textContent).toContain("median");
    expect(container.textContent).toContain("Seed");
    expect(container.textContent).toContain("42");
    expect(container.textContent).toContain("Resume");
    expect(container.textContent).toContain("requested");
    expect(container.textContent).toContain("Storage");
    expect(container.textContent).toContain("configured");
    expect(container.textContent).toContain("Optimizer resume");
    expect(container.textContent).toContain("supported");
    expect(container.textContent).toContain("Study");
    expect(container.textContent).toContain("pls-native");
    expect(container.textContent).toContain("Trial status timeline");
    expect(container.textContent).toContain("Best Trial #2");
    expect(container.textContent).toContain("2 complete");
    expect(container.textContent).toContain("1 failed");
    expect(container.textContent).toContain("n_components=8");
    expect(container.textContent).toContain("Trial #2");
    expect(container.textContent).toContain("best");
    expect(container.textContent).toContain("Failed");

    await act(async () => {
      root.unmount();
    });
  });

  it("builds stable CSV rows for native tuning trials", () => {
    expect(TUNING_TRIAL_CSV_COLUMNS).toEqual([
      "trial_number",
      "status",
      "value",
      "is_best",
      "params_json",
      "diagnostics_json",
    ]);
    expect(buildTuningTrialCsvFilename(summary())).toBe("native_tuning_pls-native_trials.csv");
    expect(buildTuningTrialCsvRows(summary())).toEqual([
      {
        diagnostics_json: "{}",
        is_best: false,
        params_json: "{\"n_components\":4}",
        status: "complete",
        trial_number: 1,
        value: 0.2,
      },
      {
        diagnostics_json: "{\"reason\":\"winner\"}",
        is_best: true,
        params_json: "{\"n_components\":8}",
        status: "complete",
        trial_number: 2,
        value: 0.1234,
      },
      {
        diagnostics_json: "{\"error\":\"invalid candidate\"}",
        is_best: false,
        params_json: "{\"n_components\":16}",
        status: "failed",
        trial_number: 3,
        value: null,
      },
    ]);
  });
});
