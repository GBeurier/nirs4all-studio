/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildConformalMetricCsvFilename,
  buildConformalMetricCsvRows,
  CONFORMAL_METRIC_CSV_COLUMNS,
  ResultMetricsConformalSummary,
} from "./ResultMetricsConformalSummary";
import type { ResultConformalSummaryData } from "./resultDetailData";

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

function summary(): ResultConformalSummaryData {
  return {
    coverageStrip: [
      {
        calibrated: true,
        coverage: 0.8,
        coverageLabel: "80%",
        materialized: true,
        meanWidthLabel: "1.0000",
        positionPercent: 0,
        qhatLabel: "0.5000",
        selected: false,
        tone: "materialized",
      },
      {
        calibrated: true,
        coverage: 0.9,
        coverageLabel: "90%",
        materialized: false,
        meanWidthLabel: null,
        positionPercent: 50,
        qhatLabel: null,
        selected: false,
        tone: "calibrated",
      },
      {
        calibrated: true,
        coverage: 0.95,
        coverageLabel: "95%",
        materialized: true,
        meanWidthLabel: "2.0000",
        positionPercent: 100,
        qhatLabel: "1.0000",
        selected: true,
        tone: "selected",
      },
    ],
    coverages: [
      { calibrated: true, coverage: 0.8, disabled: false, label: "80%", materialized: true, selected: false },
      { calibrated: true, coverage: 0.9, disabled: true, label: "90%", materialized: false, selected: false },
      { calibrated: true, coverage: 0.95, disabled: false, label: "95%", materialized: true, selected: true },
    ],
    fingerprint: "conformal:abcdef1234567890",
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
      coverageLabel: "95%",
      effectiveEngine: "nirs4all.conformal.v1",
      invalidationReasons: [],
      label: "Active conformal guarantee",
      limitations: ["finite-sample marginal coverage requires exchangeable calibration and prediction samples"],
      method: "split_absolute_residual",
      requestedEngine: "nirs4all.conformal.v1",
      scope: "finite_sample_marginal_exchangeability",
      status: "active",
      tone: "success",
      tuningCalibrationLabel: "unknown tuning calibration source",
      tuningCalibrationSource: null,
      unit: "physical_sample",
    },
    intervals: [
      { coverage: 0.8, coverageLabel: "80%", meanWidth: 1, meanWidthLabel: "1.0000", nSamples: 2, qhat: 0.5, qhatLabel: "0.5000" },
      { coverage: 0.95, coverageLabel: "95%", meanWidth: 2, meanWidthLabel: "2.0000", nSamples: 2, qhat: 1, qhatLabel: "1.0000" },
    ],
    metrics: [
      {
        coverage: 0.8,
        coverageGap: -0.05,
        coverageGapDirection: "under",
        coverageGapLabel: "-0.0500",
        coverageLabel: "80%",
        meanIntervalScore: 1.5,
        meanIntervalScoreLabel: "1.5000",
        meanWidth: 1.25,
        meanWidthLabel: "1.2500",
        medianWidth: 1,
        medianWidthLabel: "1.0000",
        missedAbove: 0,
        missedBelow: 1,
        nCovered: 3,
        nSamples: 4,
        observedCoverage: 0.75,
        observedCoverageLabel: "75%",
        unit: "physical_sample",
      },
    ],
    method: "split_absolute_residual",
    nPredictions: 2,
    unit: "physical_sample",
  };
}

describe("ResultMetricsConformalSummary", () => {
  it("renders conformal guarantee and coverage strip from shared view-models", async () => {
    const { container, root } = await render(<ResultMetricsConformalSummary summary={summary()} />);

    expect(container.textContent).toContain("Conformal prediction");
    expect(container.textContent).toContain("split_absolute_residual · physical_sample · 2 predictions");
    expect(container.textContent).toContain("Active conformal guarantee");
    expect(container.textContent).toContain("95%");
    expect(container.textContent).toContain("nirs4all.conformal.v1");
    expect(container.textContent).toContain("Metrics CSV");
    expect(container.textContent).toContain("Coverage strip");
    expect(container.textContent).toContain("Visual projection of calibrated, selected, and materialized coverages.");
    expect(container.textContent).toContain("Coverage metrics");
    expect(container.textContent).toContain("Attached conformal metric sets");
    expect(container.textContent).toContain("75%");
    expect(container.textContent).toContain("-0.0500");
    expect(container.textContent).toContain("1 below · 0 above · 3/4 covered");
    expect(container.textContent).toContain("80%");
    expect(container.textContent).toContain("90%");
    expect(container.textContent).toContain("95%");
    expect(container.textContent).toContain("qhat 1.0000 · mean width 2.0000");
    expect(container.textContent).toContain("calibration replay: dataset predictor bundle via nirs4all.predict");
    expect(container.textContent).toContain("Limitations: finite-sample marginal coverage requires exchangeable calibration and prediction samples");

    await act(async () => {
      root.unmount();
    });
  });

  it("builds stable CSV rows for conformal coverage metrics", () => {
    expect(CONFORMAL_METRIC_CSV_COLUMNS).toEqual([
      "coverage",
      "observed_coverage",
      "coverage_gap",
      "coverage_gap_direction",
      "mean_width",
      "median_width",
      "mean_interval_score",
      "n_covered",
      "n_samples",
      "n_missed_below",
      "n_missed_above",
      "unit",
    ]);
    expect(buildConformalMetricCsvFilename(summary())).toBe("conformal_conformal_abcdef1234567890_coverage_metrics.csv");
    expect(buildConformalMetricCsvRows(summary())).toEqual([{
      coverage: 0.8,
      coverage_gap: -0.05,
      coverage_gap_direction: "under",
      mean_interval_score: 1.5,
      mean_width: 1.25,
      median_width: 1,
      n_covered: 3,
      n_missed_above: 0,
      n_missed_below: 1,
      n_samples: 4,
      observed_coverage: 0.75,
      unit: "physical_sample",
    }]);
  });
});
