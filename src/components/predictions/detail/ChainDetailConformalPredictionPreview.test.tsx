/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { ChainDetailConformalPredictionPreview } from "./ChainDetailConformalPredictionPreview";
import type { ChainDetailConformalSummary } from "./useChainDetailPanelState";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function renderNode(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(node);
  });

  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function summary(): ChainDetailConformalSummary {
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
        selected: true,
        tone: "selected",
      },
      {
        calibrated: true,
        coverage: 0.95,
        coverageLabel: "95%",
        materialized: true,
        meanWidthLabel: "2.0000",
        positionPercent: 100,
        qhatLabel: "1.0000",
        selected: false,
        tone: "materialized",
      },
    ],
    coverages: [
      {
        calibrated: true,
        coverage: 0.8,
        disabled: false,
        label: "80%",
        materialized: true,
        selected: true,
      },
      {
        calibrated: true,
        coverage: 0.9,
        disabled: true,
        label: "90%",
        materialized: false,
        selected: false,
      },
      {
        calibrated: true,
        coverage: 0.95,
        disabled: false,
        label: "95%",
        materialized: true,
        selected: false,
      },
    ],
    fingerprint: "calibrated-result:chain",
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
      effectiveEngine: "nirs4all.conformal.v1",
      invalidationReasons: [],
      label: "Active conformal guarantee",
      limitations: [],
      method: "split_absolute_residual",
      requestedEngine: "nirs4all.conformal.v1",
      scope: "finite_sample_marginal_exchangeability",
      status: "active",
      tone: "success",
      tuningCalibrationLabel: "tuning winner; score_data ranked trials only",
      tuningCalibrationSource: {
        score_data_role: "hpo_objective_only",
        score_data_used: false,
        source: "tuning.winner",
      },
      unit: "physical_sample",
    },
    intervals: [],
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
    rows: [
      {
        index: 0,
        intervals: [
          {
            coverage: 0.8,
            coverageLabel: "80%",
            lower: 0,
            lowerLabel: "0.0000",
            upper: 1,
            upperLabel: "1.0000",
            width: 1,
            widthLabel: "1.0000",
          },
          {
            coverage: 0.95,
            coverageLabel: "95%",
            lower: -0.5,
            lowerLabel: "-0.5000",
            upper: 1.5,
            upperLabel: "1.5000",
            width: 2,
            widthLabel: "2.0000",
          },
        ],
        sampleId: "pred-a",
        yPred: 0.5,
        yPredLabel: "0.5000",
      },
      {
        index: 1,
        intervals: [
          {
            coverage: 0.8,
            coverageLabel: "80%",
            lower: 1,
            lowerLabel: "1.0000",
            upper: 2,
            upperLabel: "2.0000",
            width: 1,
            widthLabel: "1.0000",
          },
          {
            coverage: 0.95,
            coverageLabel: "95%",
            lower: 0.5,
            lowerLabel: "0.5000",
            upper: 2.5,
            upperLabel: "2.5000",
            width: 2,
            widthLabel: "2.0000",
          },
        ],
        sampleId: "pred-b",
        yPred: 1.5,
        yPredLabel: "1.5000",
      },
    ],
    unit: "physical_sample",
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ChainDetailConformalPredictionPreview", () => {
  it("filters materialized prediction intervals by selected coverage", async () => {
    const mounted = await renderNode(<ChainDetailConformalPredictionPreview summary={summary()} />);

    expect(mounted.container.textContent).toContain("80% interval");
    expect(mounted.container.textContent).toContain("Active conformal guarantee");
    expect(mounted.container.textContent).toContain("tuning calibration: tuning winner; score_data ranked trials only");
    expect(mounted.container.textContent).toContain("80%: 0.0000–1.0000");
    expect(mounted.container.textContent).not.toContain("95%: -0.5000–1.5000");

    const buttons = Array.from(mounted.container.querySelectorAll("button"));
    expect(buttons.map(button => button.textContent)).toEqual(["80%", "90%", "95%"]);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      buttons[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mounted.container.textContent).toContain("95% interval");
    expect(mounted.container.textContent).toContain("95%: -0.5000–1.5000");
    expect(mounted.container.textContent).not.toContain("80%: 0.0000–1.0000");

    await mounted.unmount();
  });
});
